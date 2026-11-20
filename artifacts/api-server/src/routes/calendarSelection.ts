import {
  ListGoogleCalendarEventsResponseItem,
  ListGoogleCalendarsResponse,
  ListGoogleCalendarEventsQueryParams,
  ListGoogleCalendarEventsResponse,
  UpdateGoogleCalendarSelectionBody,
  UpdateGoogleCalendarSelectionResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Response } from "express";

type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: unknown;
    summary?: unknown;
    primary?: unknown;
    accessRole?: unknown;
  }>;
  nextPageToken?: unknown;
};

type GoogleCalendarEventsPage = {
  items?: unknown[];
  nextPageToken?: unknown;
};

type GoogleCalendarPageResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type GoogleCalendarPageRequest = (
  accessToken: string,
  path: string,
) => Promise<GoogleCalendarPageResponse>;

const repeatedPageTokenMessage = "Google Calendar returned a repeated page token.";
const invalidGoogleResponseMessage = "Google Calendar returned an invalid response. Please try again.";
// Both pagination paths fail closed at this ceiling rather than returning partial results.
const GOOGLE_CALENDAR_PAGE_LIMIT = 20;
const GOOGLE_PAGE_TOKEN_MAX_LENGTH = 4096;

function validPageToken(token: unknown): token is string {
  return typeof token === "string"
    && token.length > 0
    && token.length <= GOOGLE_PAGE_TOKEN_MAX_LENGTH
    && token.trim() === token
    && !/[\u0000-\u001f\u007f]/.test(token);
}

function invalidResponseError(message = invalidGoogleResponseMessage) {
  return Object.assign(new Error(message), {
    status: 502,
    code: "GOOGLE_INVALID_RESPONSE",
  });
}

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function pageTokenError() {
  return Object.assign(new Error(repeatedPageTokenMessage), {
    status: 502,
    code: "GOOGLE_PAGINATION_ERROR",
  });
}

export async function listGoogleCalendars(
  accessToken: string,
  request: GoogleCalendarPageRequest,
): Promise<{
  calendars: GoogleCalendarSummary[];
  errorStatus?: number;
  errorMessage?: string;
  errorCode?: string;
}> {
  const calendars = new Map<string, GoogleCalendarSummary>();
  const requestedPageTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_CALENDAR_PAGE_LIMIT; page += 1) {
    if (pageToken) requestedPageTokens.add(pageToken);
    const query = new URLSearchParams({ maxResults: "250" });
    if (pageToken) query.set("pageToken", pageToken);
    let response: GoogleCalendarPageResponse;
    try {
      response = await request(accessToken, `/users/me/calendarList?${query.toString()}`);
    } catch {
      return {
        calendars: [],
        errorStatus: 502,
        errorMessage: "Google Calendar could not load calendars. Please try again.",
        errorCode: "GOOGLE_TEMPORARY_ERROR",
      };
    }
    if (!response.ok) return { calendars: [], errorStatus: response.status };

    let result: GoogleCalendarListResponse;
    try {
      const json = await response.json();
      if (!json || typeof json !== "object" || Array.isArray(json)) throw invalidResponseError();
      result = json as GoogleCalendarListResponse;
      if (
        (result.items !== undefined && !Array.isArray(result.items))
        || (result.nextPageToken !== undefined && !validPageToken(result.nextPageToken))
      ) throw invalidResponseError();
      for (const item of result.items ?? []) {
        if (
          !item || typeof item !== "object"
          || typeof item.id !== "string" || !item.id.trim()
          || (item.summary !== undefined && typeof item.summary !== "string")
          || (item.primary !== undefined && typeof item.primary !== "boolean")
          || (item.accessRole !== undefined && typeof item.accessRole !== "string")
        ) throw invalidResponseError();
        if (calendars.has(item.id)) continue;
        calendars.set(item.id, {
          id: item.id,
          summary: typeof item.summary === "string" ? item.summary : item.id,
          primary: item.primary === true,
          accessRole: typeof item.accessRole === "string" ? item.accessRole : "reader",
        });
      }
    } catch {
      return {
        calendars: [],
        errorStatus: 502,
        errorMessage: invalidResponseError().message,
        errorCode: "GOOGLE_INVALID_RESPONSE",
      };
    }
    if (typeof result.nextPageToken !== "string") return { calendars: [...calendars.values()] };
    if (requestedPageTokens.has(result.nextPageToken)) {
      return { calendars: [], errorStatus: 502, errorMessage: repeatedPageTokenMessage, errorCode: "GOOGLE_PAGINATION_ERROR" };
    }
    pageToken = result.nextPageToken;
  }

  return pageToken
    ? { calendars: [], errorStatus: 502, errorMessage: `Google Calendar exceeded the ${GOOGLE_CALENDAR_PAGE_LIMIT}-page calendar limit. Please try again.`, errorCode: "GOOGLE_PAGINATION_ERROR" }
    : { calendars: [...calendars.values()] };
}

export async function listGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  request: GoogleCalendarPageRequest,
): Promise<unknown[]> {
  const items: unknown[] = [];
  const requestedPageTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_CALENDAR_PAGE_LIMIT; page += 1) {
    if (pageToken) requestedPageTokens.add(pageToken);
    const query = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) query.set("pageToken", pageToken);
    let response: GoogleCalendarPageResponse;
    try {
      response = await request(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      );
    } catch {
      const error = new Error("Google Calendar could not load events. Please try again.") as Error & { status?: number; code?: string };
      error.status = 502;
      error.code = "GOOGLE_TEMPORARY_ERROR";
      throw error;
    }
    if (!response.ok) {
      const error = new Error("Google Calendar could not load events") as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    let result: GoogleCalendarEventsPage;
    try {
      const json = await response.json();
      if (!json || typeof json !== "object" || Array.isArray(json)) throw invalidResponseError();
      result = json as GoogleCalendarEventsPage;
      if (
        (result.items !== undefined && !Array.isArray(result.items))
        || (result.nextPageToken !== undefined && !validPageToken(result.nextPageToken))
      ) throw invalidResponseError();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;
      throw invalidResponseError();
    }
    items.push(...(result.items ?? []));
    if (typeof result.nextPageToken !== "string") return items;
    if (requestedPageTokens.has(result.nextPageToken)) throw pageTokenError();
    pageToken = result.nextPageToken;
  }
  if (pageToken) {
    throw Object.assign(
      new Error(`Google Calendar exceeded the ${GOOGLE_CALENDAR_PAGE_LIMIT}-page event limit. Please try again.`),
      { status: 502, code: "GOOGLE_PAGINATION_ERROR" },
    );
  }
  return items;
}

function serializeDateOnly(value: unknown, parsed: Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && isValidDateOnly(value)) {
    return value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  throw invalidResponseError("Google Calendar returned a malformed all-day date.");
}

export function serializeGoogleCalendarEvent(value: unknown) {
  const original = value as {
    start?: { date?: unknown };
    end?: { date?: unknown };
  };
  const startDate = serializeDateOnly(original?.start?.date, null);
  const endDate = serializeDateOnly(original?.end?.date, null);
  const event = ListGoogleCalendarEventsResponseItem.parse({
    ...(value as Record<string, unknown>),
    conferenceUrl: (value as { conferenceUrl?: unknown } | null)?.conferenceUrl ?? null,
  });
  return {
    ...event,
    start: {
      ...event.start,
      dateTime: event.start.dateTime?.toISOString() ?? null,
      date: startDate ?? (event.start.date?.toISOString().slice(0, 10) ?? null),
    },
    end: {
      ...event.end,
      dateTime: event.end.dateTime?.toISOString() ?? null,
      date: endDate ?? (event.end.date?.toISOString().slice(0, 10) ?? null),
    },
    updatedAt: event.updatedAt?.toISOString() ?? null,
  };
}

export type CalendarSelectionDependencies = {
  getAccessToken: (userId: string) => Promise<string | null>;
  getAvailableCalendars: (accessToken: string) => Promise<{
    calendars: GoogleCalendarSummary[];
    errorStatus?: number;
    errorMessage?: string;
    errorCode?: string;
  }>;
  getSelectedCalendarIds: (userId: string) => Promise<string[] | null>;
  saveSelectedCalendarIds: (userId: string, calendarIds: string[]) => Promise<void>;
  listCalendarEvents: (
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ) => Promise<unknown[]>;
  mapEvent: (value: unknown, calendarId: string, accessRole: string) => unknown;
  serializeEvent: (value: unknown) => unknown;
};

const userIdFromResponse = (res: Response): string => String(res.locals.userId);

function calendarListError(
  status: number | undefined,
  action: "load" | "save",
  errorMessage?: string,
  errorCode?: string,
) {
  if (status === 401) {
    return {
      status: 401,
      error: "Reconnect Google Calendar to continue. Your saved calendar selection is safe.",
      code: "GOOGLE_REAUTH_REQUIRED",
    };
  }
  if (status === 403) {
    return {
      status: 403,
      error: action === "load"
        ? "Update Google Calendar access to show your calendars"
        : "Update Google Calendar access to save your selection",
      code: "GOOGLE_ACCESS_UPDATE_REQUIRED",
    };
  }
  return {
    status: 502,
    error: errorMessage ?? (action === "load"
      ? "Google Calendar could not load calendars"
      : "Google Calendar could not validate calendars"),
    code: errorCode ?? (errorMessage ? "GOOGLE_PAGINATION_ERROR" : "GOOGLE_TEMPORARY_ERROR"),
  };
}

export function createCalendarSelectionRouter(
  dependencies: CalendarSelectionDependencies,
): IRouter {
  const router: IRouter = Router();

  router.get("/planner/calendar/google/calendars", async (_req, res): Promise<void> => {
    const userId = userIdFromResponse(res);
    const accessToken = await dependencies.getAccessToken(userId);
    if (!accessToken) {
      res.status(401).json({ error: "Connect Google Calendar to continue", code: "GOOGLE_NOT_CONNECTED" });
      return;
    }

    const [calendars, selectedCalendarIds] = await Promise.all([
      dependencies.getAvailableCalendars(accessToken),
      dependencies.getSelectedCalendarIds(userId),
    ]);
    if (calendars.errorStatus) {
      const error = calendarListError(calendars.errorStatus, "load", calendars.errorMessage, calendars.errorCode);
      res.status(error.status).json({ error: error.error, code: error.code });
      return;
    }

    const availableIds = new Set(calendars.calendars.map((calendar) => calendar.id));
    res.json(ListGoogleCalendarsResponse.parse({
      calendars: calendars.calendars,
      selectedCalendarIds: (selectedCalendarIds ?? ["primary"])
        .filter((id) => availableIds.has(id)),
    }));
  });

  router.put("/planner/calendar/google/calendars/selection", async (req, res): Promise<void> => {
    const parsed = UpdateGoogleCalendarSelectionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const userId = userIdFromResponse(res);
    const accessToken = await dependencies.getAccessToken(userId);
    if (!accessToken) {
      res.status(401).json({ error: "Connect Google Calendar to continue", code: "GOOGLE_NOT_CONNECTED" });
      return;
    }

    const calendars = await dependencies.getAvailableCalendars(accessToken);
    if (calendars.errorStatus) {
      const error = calendarListError(calendars.errorStatus, "save", calendars.errorMessage, calendars.errorCode);
      res.status(error.status).json({ error: error.error, code: error.code });
      return;
    }

    const availableIds = new Set(calendars.calendars.map((calendar) => calendar.id));
    const selectedCalendarIds = [...new Set(parsed.data.calendarIds)];
    if (selectedCalendarIds.some((id) => !availableIds.has(id))) {
      res.status(400).json({ error: "Choose calendars available to this Google account" });
      return;
    }

    await dependencies.saveSelectedCalendarIds(userId, selectedCalendarIds);
    res.json(UpdateGoogleCalendarSelectionResponse.parse({ selectedCalendarIds }));
  });

  router.get("/planner/calendar/events", async (req, res): Promise<void> => {
    const rawMin = req.query.timeMin;
    const rawMax = req.query.timeMax;
    const params = ListGoogleCalendarEventsQueryParams.safeParse({
      timeMin: typeof rawMin === "string" ? new Date(rawMin) : new Date(Number.NaN),
      timeMax: typeof rawMax === "string" ? new Date(rawMax) : new Date(Number.NaN),
    });
    if (!params.success || params.data.timeMin >= params.data.timeMax) {
      res.status(400).json({ error: "A valid timeMin and later timeMax are required" });
      return;
    }

    const userId = userIdFromResponse(res);
    const accessToken = await dependencies.getAccessToken(userId);
    if (!accessToken) {
      res.status(401).json({ error: "Connect Google Calendar to continue", code: "GOOGLE_NOT_CONNECTED" });
      return;
    }

    const selectedCalendarIds = (await dependencies.getSelectedCalendarIds(userId)) ?? ["primary"];
    try {
      const availableCalendars = await dependencies.getAvailableCalendars(accessToken);
      const accessRoles = new Map(
        availableCalendars.errorStatus
          ? []
          : availableCalendars.calendars.map((calendar) => [calendar.id, calendar.accessRole]),
      );
      const results = await Promise.all(selectedCalendarIds.map(async (calendarId) => {
        const items = await dependencies.listCalendarEvents(
          accessToken,
          calendarId,
          params.data.timeMin,
          params.data.timeMax,
        );
        const accessRole = accessRoles.get(calendarId) ?? "reader";
        return items.map((item) => {
          try {
            return dependencies.mapEvent(item, calendarId, accessRole);
          } catch {
            throw invalidResponseError();
          }
        });
      }));
      let events;
      try {
        events = ListGoogleCalendarEventsResponse.parse(results.flat());
      } catch {
        throw invalidResponseError();
      }
      res.json(events.map(dependencies.serializeEvent));
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error
        ? (error as { status?: number }).status
        : undefined;
      const errorCode = error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      const knownError = ["GOOGLE_PAGINATION_ERROR", "GOOGLE_INVALID_RESPONSE"].includes(errorCode ?? "");
      res.status(status === 401 ? 401 : status === 403 ? 403 : 502).json({
        error: status === 401
          ? "Reconnect Google Calendar to continue. Your saved calendar selection is safe."
          : status === 403
            ? "Update Google Calendar access to continue."
            : knownError && error instanceof Error
              ? error.message
              : "Google Calendar could not load events. Please try again.",
        code: status === 401
          ? "GOOGLE_REAUTH_REQUIRED"
          : status === 403
            ? "GOOGLE_ACCESS_UPDATE_REQUIRED"
            : knownError
              ? errorCode
              : "GOOGLE_TEMPORARY_ERROR",
      });
    }
  });

  return router;
}
