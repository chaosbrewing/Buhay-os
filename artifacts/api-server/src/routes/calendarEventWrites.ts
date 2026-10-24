import {
  CreateGoogleCalendarEventBody,
  CreateGoogleCalendarEventResponse,
  UpdateGoogleCalendarEventBody,
  UpdateGoogleCalendarEventHeader,
  UpdateGoogleCalendarEventParams,
  UpdateGoogleCalendarEventResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Response } from "express";
import { conditionalGoogleWrite, eventWriteBody } from "../lib/calendarCore";
import { isValidDateOnly, listGoogleCalendars, serializeGoogleCalendarEvent } from "./calendarSelection";

type GoogleResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type CalendarEventWriteDependencies = {
  getAccessToken: (userId: string) => Promise<string | null>;
  googleRequest: (
    accessToken: string,
    path: string,
    init?: RequestInit,
  ) => Promise<GoogleResponse>;
  getAvailableCalendars?: (accessToken: string) => ReturnType<typeof listGoogleCalendars>;
  readConflictEvent: (
    accessToken: string,
    calendarId: string,
    eventId: string,
  ) => Promise<unknown | null>;
  mapEvent: (value: unknown, calendarId?: string, accessRole?: string) => unknown;
  serializeEvent?: (value: unknown) => unknown;
};

const userIdFromResponse = (res: Response): string => String(res.locals.userId);

function sendCalendarCreateError(res: Response, error: unknown) {
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: number }).status
    : undefined;
  const unavailable = status === 403 || status === 404;
  res.status(status === 401 ? 401 : unavailable ? 403 : 502).json({
    error: status === 401
      ? "Reconnect Google Calendar to continue. Your Daybook data is safe."
      : unavailable
        ? "The selected Google calendar is no longer writable or available. Choose another calendar."
        : "Google Calendar could not create this event. Please try again.",
    code: status === 401
      ? "GOOGLE_REAUTH_REQUIRED"
      : unavailable
        ? "GOOGLE_CALENDAR_NOT_WRITABLE"
        : "GOOGLE_TEMPORARY_ERROR",
  });
}

function hasMalformedDateOnly(body: unknown) {
  if (!body || typeof body !== "object") return false;
  const record = body as { start?: { date?: unknown }; end?: { date?: unknown } };
  return [record.start?.date, record.end?.date]
    .some((value) => value != null && !isValidDateOnly(value));
}

export function createCalendarEventWriteRouter(
  dependencies: CalendarEventWriteDependencies,
): IRouter {
  const router: IRouter = Router();
  const serializeEvent = dependencies.serializeEvent ?? serializeGoogleCalendarEvent;
  const inFlightCreates = new Map<string, Promise<{ event: unknown; recovered: boolean }>>();

  router.post("/planner/calendar/events", async (req, res): Promise<void> => {
    if (hasMalformedDateOnly(req.body)) {
      res.status(400).json({ error: "All-day dates must be valid YYYY-MM-DD dates" });
      return;
    }
    const parsed = CreateGoogleCalendarEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    let body: ReturnType<typeof eventWriteBody>;
    try {
      body = eventWriteBody(parsed.data);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid event dates" });
      return;
    }
    const accessToken = await dependencies.getAccessToken(userIdFromResponse(res));
    if (!accessToken) {
      res.status(401).json({ error: "Connect Google Calendar to continue", code: "GOOGLE_NOT_CONNECTED" });
      return;
    }
    const getAvailableCalendars = dependencies.getAvailableCalendars
      ?? ((token: string) => listGoogleCalendars(token, dependencies.googleRequest));
    const calendarList = await getAvailableCalendars(accessToken);
    if (calendarList.errorStatus) {
      const status = calendarList.errorStatus === 401 ? 401 : calendarList.errorStatus === 403 ? 403 : 502;
      res.status(status).json({
        error: status === 401
          ? "Reconnect Google Calendar to continue. Your Daybook data is safe."
          : status === 403
            ? "Update Google Calendar access to choose a destination."
            : calendarList.errorMessage ?? "Google Calendar could not verify writable calendars.",
        code: status === 401
          ? "GOOGLE_REAUTH_REQUIRED"
          : status === 403
            ? "GOOGLE_ACCESS_UPDATE_REQUIRED"
            : calendarList.errorCode ?? "GOOGLE_TEMPORARY_ERROR",
      });
      return;
    }
    const writableCalendars = calendarList.calendars.filter(
      (calendar) => calendar.accessRole === "owner" || calendar.accessRole === "writer",
    );
    const requestedCalendarId = parsed.data.calendarId;
    const selectedCalendar = requestedCalendarId
      ? writableCalendars.find((calendar) => calendar.id === requestedCalendarId)
      : writableCalendars.find((calendar) => calendar.primary) ?? writableCalendars[0];
    if (!selectedCalendar) {
      const requestedCalendarIsUnavailable = Boolean(requestedCalendarId);
      res.status(403).json({
        error: requestedCalendarIsUnavailable
          ? "The selected Google calendar is no longer writable. Choose another calendar."
          : "No writable Google calendars are available for this account.",
        code: requestedCalendarIsUnavailable
          ? "GOOGLE_CALENDAR_NOT_WRITABLE"
          : "GOOGLE_NO_WRITABLE_CALENDARS",
      });
      return;
    }
    const idempotencyKey = parsed.data.idempotencyKey;
    const userId = userIdFromResponse(res);
    const lockKey = idempotencyKey ? `${userId}\u0000${idempotencyKey}` : "";
    const existingWrite = lockKey ? inFlightCreates.get(lockKey) : undefined;
    if (existingWrite) {
      try {
        const result = await existingWrite;
        res.status(200).json(serializeEvent(result.event));
      } catch (error) {
        sendCalendarCreateError(res, error);
      }
      return;
    }

    const createOrRecover = async (): Promise<{ event: unknown; recovered: boolean }> => {
      if (idempotencyKey) {
        const query = new URLSearchParams({
          maxResults: "1",
          privateExtendedProperty: `buhayOsRequestKey=${idempotencyKey}`,
        });
        const matches = await Promise.all(calendarList.calendars.map(async (calendar) => {
          const response = await dependencies.googleRequest(
            accessToken,
            `/calendars/${encodeURIComponent(calendar.id)}/events?${query.toString()}`,
          );
          if (!response.ok) {
            // Some listed calendars expose free/busy only. They cannot contain an
            // event writable by this connection, so they should not block a task
            // event retry on a different writable destination.
            if (response.status === 403 || response.status === 404) return null;
            throw Object.assign(new Error("Google Calendar could not verify a previous event request"), {
              status: response.status,
            });
          }
          const result = await response.json() as { items?: unknown[] };
          if (result && Array.isArray(result.items)) {
            const matching = result.items.find((item) => {
              if (!item || typeof item !== "object") return false;
              const properties = (item as { extendedProperties?: { private?: Record<string, unknown> } }).extendedProperties;
              return properties?.private?.buhayOsRequestKey === idempotencyKey;
            });
            if (matching) return { calendar, matching };
          }
          return null;
        }));
        const recovered = matches.find((match) => match !== null);
        if (recovered) {
          return {
            event: CreateGoogleCalendarEventResponse.parse(
              dependencies.mapEvent(recovered.matching, recovered.calendar.id, recovered.calendar.accessRole),
            ),
            recovered: true,
          };
        }
      }

      const googleBody = {
        ...body,
        ...(idempotencyKey
          ? { extendedProperties: { private: { buhayOsRequestKey: idempotencyKey } } }
          : {}),
      };
      const response = await dependencies.googleRequest(
        accessToken,
        `/calendars/${encodeURIComponent(selectedCalendar.id)}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(googleBody),
        },
      );
      if (!response.ok) {
        throw Object.assign(new Error("Google Calendar could not create this event"), {
          status: response.status,
        });
      }
      return {
        event: CreateGoogleCalendarEventResponse.parse(
          dependencies.mapEvent(await response.json(), selectedCalendar.id, selectedCalendar.accessRole),
        ),
        recovered: false,
      };
    };

    const writePromise = createOrRecover();
    if (lockKey) inFlightCreates.set(lockKey, writePromise);
    try {
      const result = await writePromise;
      res.status(result.recovered ? 200 : 201).json(serializeEvent(result.event));
    } catch (error) {
      sendCalendarCreateError(res, error);
    } finally {
      if (lockKey && inFlightCreates.get(lockKey) === writePromise) inFlightCreates.delete(lockKey);
    }
  });

  router.patch("/planner/calendar/events/:calendarId/:eventId", async (req, res): Promise<void> => {
    if (hasMalformedDateOnly(req.body)) {
      res.status(400).json({ error: "All-day dates must be valid YYYY-MM-DD dates" });
      return;
    }
    const params = UpdateGoogleCalendarEventParams.safeParse(req.params);
    const header = UpdateGoogleCalendarEventHeader.safeParse({ "If-Match": req.get("If-Match") });
    const parsed = UpdateGoogleCalendarEventBody.safeParse(req.body);
    if (!params.success || !header.success || !parsed.success) {
      res.status(400).json({ error: "A valid event, update body, and If-Match version are required" });
      return;
    }
    let body: ReturnType<typeof eventWriteBody>;
    try {
      body = eventWriteBody(parsed.data);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid event dates" });
      return;
    }
    const accessToken = await dependencies.getAccessToken(userIdFromResponse(res));
    if (!accessToken) {
      res.status(401).json({ error: "Connect Google Calendar to continue", code: "GOOGLE_NOT_CONNECTED" });
      return;
    }
    const writeResult = await conditionalGoogleWrite(
      () => dependencies.googleRequest(
        accessToken,
        `/calendars/${encodeURIComponent(params.data.calendarId)}/events/${encodeURIComponent(params.data.eventId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "If-Match": header.data["If-Match"],
          },
          body: JSON.stringify(body),
        },
      ),
      () => dependencies.readConflictEvent(accessToken, params.data.calendarId, params.data.eventId),
    );
    if (writeResult.kind === "conflict") {
      const current = writeResult.current;
      if (current) {
        res.status(409).json({
          error: "This event changed in Google Calendar. Review its latest version before saving.",
          current: serializeEvent(current),
        });
        return;
      }
      res.status(409).json({
        error: "This event changed or was removed in Google Calendar. Refresh the list.",
        current: null,
      });
      return;
    }
    const response = writeResult.response;
    if (!response.ok) {
      const status = response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : 502;
      res.status(status).json({
        error: status === 401
          ? "Reconnect Google Calendar to continue. Your Daybook data is safe."
          : status === 403
            ? "Update Google Calendar access to update events."
            : "Google Calendar could not update this event",
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
    const event = UpdateGoogleCalendarEventResponse.parse(
      dependencies.mapEvent(await response.json()),
    );
    res.json(serializeEvent(event));
  });

  return router;
}
