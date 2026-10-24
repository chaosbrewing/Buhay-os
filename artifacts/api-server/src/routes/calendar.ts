import { randomBytes } from "node:crypto";
import { getAuth } from "@clerk/express";
import {
  DeleteGoogleCalendarEventHeader,
  DeleteGoogleCalendarEventParams,
  GetGoogleCalendarConnectionResponse,
  GoogleCalendarCallbackQueryParams,
} from "@workspace/api-zod";
import {
  db,
  googleCalendarConnectionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import {
  conditionalGoogleWrite,
  completeGoogleCalendarOAuthCallback,
  disconnectCalendarConnection,
  decryptStoredTokens,
  encryptStoredTokens,
  GoogleCalendarAccessUpdateRequired,
  GoogleCalendarReauthorizationRequired,
  GoogleCalendarTemporaryError,
  refreshStoredTokens,
  reconnectTokenUpdate,
  revokeGoogleTokenBestEffort,
  signOAuthState,
  type StoredTokens,
} from "../lib/calendarCore";
import {
  createCalendarSelectionRouter,
  listGoogleCalendars,
  listGoogleCalendarEvents,
  isValidDateOnly,
  serializeGoogleCalendarEvent,
} from "./calendarSelection";
import { createCalendarEventWriteRouter } from "./calendarEventWrites";

const router: IRouter = Router();
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const OAUTH_COOKIE = "daybook_google_oauth_nonce";
const OAUTH_COOKIE_AGE_SECONDS = 600;
const CALENDAR_SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

const authSecret = () => process.env.SESSION_SECRET;
const oauthClientId = () => process.env.GOOGLE_CALENDAR_CLIENT_ID;
const oauthClientSecret = () => process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

const userIdFromResponse = (res: Response): string => String(res.locals.userId);

const requireCalendarAuth: RequestHandler = (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign-in is required" });
    return;
  }
  res.locals.userId = userId;
  next();
};

function getPublicOrigin(req: Request): string | null {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host");
  if (!host || !["http", "https"].includes(protocol)) return null;
  return `${protocol}://${host}`;
}

function getRedirectUri(req: Request): string | null {
  const configured = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (configured) return configured;
  const origin = getPublicOrigin(req);
  return origin ? `${origin}/api/planner/calendar/google/callback` : null;
}

function setOAuthCookie(res: Response, nonce: string, secure: boolean): void {
  res.cookie(OAUTH_COOKIE, nonce, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/planner/calendar/google/callback",
    maxAge: OAUTH_COOKIE_AGE_SECONDS * 1000,
  });
}

function readCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie ?? "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function clearOAuthCookie(res: Response, secure: boolean): void {
  res.clearCookie(OAUTH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/planner/calendar/google/callback",
  });
}

function encryptTokens(tokens: StoredTokens): string {
  return encryptStoredTokens(tokens, authSecret());
}

function decryptTokens(encrypted: string): StoredTokens {
  return decryptStoredTokens(encrypted, authSecret());
}

function mapGoogleEvent(value: any, calendarId = "primary", accessRole = "reader") {
  const startDate = value.start?.date;
  const endDate = value.end?.date;
  if (startDate != null && !isValidDateOnly(startDate)) {
    throw Object.assign(new Error("Google Calendar returned a malformed all-day date."), {
      status: 502,
      code: "GOOGLE_INVALID_RESPONSE",
    });
  }
  if (endDate != null && !isValidDateOnly(endDate)) {
    throw Object.assign(new Error("Google Calendar returned a malformed all-day date."), {
      status: 502,
      code: "GOOGLE_INVALID_RESPONSE",
    });
  }
  const conferenceUrl = value.conferenceData?.entryPoints?.find(
    (entry: any) => entry?.entryPointType === "video" && typeof entry.uri === "string",
  )?.uri ?? value.hangoutLink ?? null;
  return {
    id: value.id,
    calendarId,
    accessRole,
    title: value.summary ?? "(No title)",
    description: value.description ?? null,
    location: value.location ?? null,
    start: {
      dateTime: value.start?.dateTime ?? null,
      date: value.start?.date ?? null,
      timeZone: value.start?.timeZone ?? null,
    },
    end: {
      dateTime: value.end?.dateTime ?? null,
      date: value.end?.date ?? null,
      timeZone: value.end?.timeZone ?? null,
    },
    etag: value.etag,
    updatedAt: value.updated ?? null,
    htmlLink: value.htmlLink ?? null,
    conferenceUrl,
  };
}

async function googleRequest(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<globalThis.Response> {
  try {
    return await fetch(`${GOOGLE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GoogleCalendarTemporaryError();
  }
}

async function getAccessToken(userId: string): Promise<string | null> {
  const [connection] = await db
    .select()
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.userId, userId))
    .limit(1);
  if (!connection) return null;

  const tokens = decryptTokens(connection.encryptedTokens);
  const updated = await refreshStoredTokens(tokens, {
    clientId: oauthClientId(),
    clientSecret: oauthClientSecret(),
    now: Date.now(),
    fetcher: fetch,
  });
  if (!updated) return null;
  if (updated === tokens) return tokens.accessToken;
  await db
    .update(googleCalendarConnectionsTable)
    .set({ encryptedTokens: encryptTokens(updated) })
    .where(eq(googleCalendarConnectionsTable.userId, userId));
  return updated.accessToken;
}

async function readConflictEvent(accessToken: string, calendarId: string, eventId: string) {
  const response = await googleRequest(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  if (response.status === 401) throw new GoogleCalendarReauthorizationRequired();
  if (response.status === 403) throw new GoogleCalendarAccessUpdateRequired();
  if (!response.ok) return null;
  return mapGoogleEvent(await response.json(), calendarId);
}

type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

async function getAvailableCalendars(accessToken: string): Promise<{
  calendars: GoogleCalendarSummary[];
  errorStatus?: number;
  errorMessage?: string;
  errorCode?: string;
}> {
  return listGoogleCalendars(accessToken, googleRequest);
}

router.get(
  "/planner/calendar/google/callback",
  async (req, res): Promise<void> => {
    const secure = (req.get("x-forwarded-proto") ?? req.protocol).startsWith("https");
    const query = GoogleCalendarCallbackQueryParams.safeParse(req.query);
    const stateValue = typeof req.query.state === "string" ? req.query.state : null;
    const nonce = readCookie(req, OAUTH_COOKIE);
    clearOAuthCookie(res, secure);
    const result = await completeGoogleCalendarOAuthCallback({
      stateValue,
      callbackValid: query.success,
      code: query.success ? query.data.code : undefined,
      nonce,
      userId: getAuth(req).userId,
      secret: authSecret(),
      clientId: oauthClientId(),
      clientSecret: oauthClientSecret(),
      redirectUri: getRedirectUri(req),
      now: Date.now(),
      fetcher: fetch,
      getExistingEncryptedTokens: async (userId) => {
        const [existing] = await db
          .select({ encryptedTokens: googleCalendarConnectionsTable.encryptedTokens })
          .from(googleCalendarConnectionsTable)
          .where(eq(googleCalendarConnectionsTable.userId, userId))
          .limit(1);
        return existing?.encryptedTokens ?? null;
      },
      saveEncryptedTokens: async (userId, encryptedTokens) => {
        await db
          .insert(googleCalendarConnectionsTable)
          .values({ userId, encryptedTokens })
          .onConflictDoUpdate({
            target: googleCalendarConnectionsTable.userId,
            set: reconnectTokenUpdate(encryptedTokens),
          });
      },
    });
    res.redirect(302, result.redirectTo);
  },
);

router.use(requireCalendarAuth);
router.use(createCalendarSelectionRouter({
  getAccessToken,
  getAvailableCalendars,
  getSelectedCalendarIds: async (userId) => {
    const [connection] = await db
      .select({ selectedCalendarIds: googleCalendarConnectionsTable.selectedCalendarIds })
      .from(googleCalendarConnectionsTable)
      .where(eq(googleCalendarConnectionsTable.userId, userId))
      .limit(1);
    return connection?.selectedCalendarIds ?? null;
  },
  saveSelectedCalendarIds: async (userId, selectedCalendarIds) => {
    await db
      .update(googleCalendarConnectionsTable)
      .set({ selectedCalendarIds })
      .where(eq(googleCalendarConnectionsTable.userId, userId));
  },
  listCalendarEvents: (accessToken, calendarId, timeMin, timeMax) =>
    listGoogleCalendarEvents(accessToken, calendarId, timeMin, timeMax, googleRequest),
  mapEvent: mapGoogleEvent,
  serializeEvent: serializeGoogleCalendarEvent,
}));

router.use(createCalendarEventWriteRouter({
  getAccessToken,
  googleRequest,
  readConflictEvent,
  mapEvent: mapGoogleEvent,
  serializeEvent: serializeGoogleCalendarEvent,
}));

router.get("/planner/calendar/google/authorize", async (req, res): Promise<void> => {
  const clientId = oauthClientId();
  const redirectUri = getRedirectUri(req);
  if (!clientId || !oauthClientSecret() || !redirectUri || !authSecret()) {
    res.status(503).json({ error: "Google Calendar is not configured" });
    return;
  }
  const nonce = randomBytes(32).toString("base64url");
  const returnTo = req.query.returnTo === "/planner/calendar" ? "/planner/calendar" : "/planner/settings";
  const state = signOAuthState({
    userId: userIdFromResponse(res),
    nonce,
    expiresAt: Date.now() + OAUTH_COOKIE_AGE_SECONDS * 1000,
    returnTo,
  }, authSecret());
  const secure = (req.get("x-forwarded-proto") ?? req.protocol).startsWith("https");
  setOAuthCookie(res, nonce, secure);
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  res.redirect(302, url.toString());
});

router.get("/planner/calendar/google/connection", async (_req, res): Promise<void> => {
  const [connection] = await db
    .select({ userId: googleCalendarConnectionsTable.userId })
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.userId, userIdFromResponse(res)))
    .limit(1);
  if (!connection) {
    res.json(GetGoogleCalendarConnectionResponse.parse({
      connected: false,
      reauthorizationRequired: false,
    }));
    return;
  }
  try {
    await getAccessToken(userIdFromResponse(res));
    res.json(GetGoogleCalendarConnectionResponse.parse({
      connected: true,
      reauthorizationRequired: false,
    }));
  } catch (error) {
    if (!(error instanceof GoogleCalendarReauthorizationRequired)) throw error;
    res.json(GetGoogleCalendarConnectionResponse.parse({
      connected: true,
      reauthorizationRequired: true,
    }));
  }
});

router.delete("/planner/calendar/google/connection", async (_req, res): Promise<void> => {
  const [connection] = await db
    .select()
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.userId, userIdFromResponse(res)))
    .limit(1);
  await disconnectCalendarConnection(
    async () => {
      if (!connection) return;
      const tokens = decryptTokens(connection.encryptedTokens);
      const token = tokens.refreshToken || tokens.accessToken;
      await revokeGoogleTokenBestEffort(token, fetch);
    },
    async () => {
      await db
        .delete(googleCalendarConnectionsTable)
        .where(eq(googleCalendarConnectionsTable.userId, userIdFromResponse(res)));
    },
  );
  res.sendStatus(204);
});

router.delete("/planner/calendar/events/:calendarId/:eventId", async (req, res): Promise<void> => {
  const params = DeleteGoogleCalendarEventParams.safeParse(req.params);
  const header = DeleteGoogleCalendarEventHeader.safeParse({ "If-Match": req.get("If-Match") });
  if (!params.success || !header.success) {
    res.status(400).json({ error: "A valid event ID and If-Match version are required" });
    return;
  }
  const accessToken = await getAccessToken(userIdFromResponse(res));
  if (!accessToken) {
    res.status(401).json({ error: "Connect Google Calendar to continue", code: "GOOGLE_NOT_CONNECTED" });
    return;
  }
  const writeResult = await conditionalGoogleWrite(
    () => googleRequest(
      accessToken,
      `/calendars/${encodeURIComponent(params.data.calendarId)}/events/${encodeURIComponent(params.data.eventId)}`,
      { method: "DELETE", headers: { "If-Match": header.data["If-Match"] } },
    ),
    () => readConflictEvent(accessToken, params.data.calendarId, params.data.eventId),
  );
  if (writeResult.kind === "conflict") {
    const current = writeResult.current;
    if (current) {
      res.status(409).json(
        {
          error: "This event changed in Google Calendar. Review its latest version before deleting.",
          current: serializeGoogleCalendarEvent(current),
        },
      );
      return;
    }
    res.status(409).json({
      error: "This event changed or was removed in Google Calendar. Refresh the list.",
      current: null,
    });
    return;
  }
  const response = writeResult.response;
  if (!response.ok && response.status !== 204) {
    const status = response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : 502;
    res.status(status).json({
      error: status === 401
        ? "Reconnect Google Calendar to continue. Your Daybook data is safe."
        : status === 403
          ? "Update Google Calendar access to delete events."
          : "Google Calendar could not delete this event",
      ...(status === 401
        ? { code: "GOOGLE_REAUTH_REQUIRED" }
        : status === 403
          ? { code: "GOOGLE_ACCESS_UPDATE_REQUIRED" }
          : status === 502
            ? { code: "GOOGLE_TEMPORARY_ERROR" }
            : {}),
    });
    return;
  }
  res.sendStatus(204);
});

router.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
  if (error instanceof GoogleCalendarReauthorizationRequired) {
    res.status(401).json({
      error: "Reconnect Google Calendar to continue. Your Daybook data and calendar selection are safe.",
      code: "GOOGLE_REAUTH_REQUIRED",
    });
    return;
  }
  if (error instanceof GoogleCalendarAccessUpdateRequired) {
    res.status(403).json({
      error: "Update Google Calendar access to continue. Your Daybook data is safe.",
      code: "GOOGLE_ACCESS_UPDATE_REQUIRED",
    });
    return;
  }
  if (error instanceof GoogleCalendarTemporaryError) {
    res.status(502).json({
      error: "Google Calendar is temporarily unavailable. Please try again.",
      code: "GOOGLE_TEMPORARY_ERROR",
    });
    return;
  }
  if (error && typeof error === "object" && "code" in error
    && (error as { code?: string }).code === "GOOGLE_INVALID_RESPONSE") {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Google Calendar returned an invalid response. Please try again.",
      code: "GOOGLE_INVALID_RESPONSE",
    });
    return;
  }
  next(error);
});

export default router;
