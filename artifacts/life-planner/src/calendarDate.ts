import type { CalendarEvent, CalendarEventInput } from "@workspace/api-client-react";

export type Draft = {
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string;
  calendarId: string;
  requestKey?: string;
};

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const RECONNECT_DRAFT_KEY = "buhay-os-calendar-event-draft";

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

export const emptyDraft = (calendarId = ""): Draft => ({
  title: "",
  description: "",
  location: "",
  start: "",
  end: "",
  allDay: false,
  timeZone: browserZone(),
  calendarId,
});

function shiftDateOnly(value: string, days: number) {
  if (!isValidDateOnly(value)) throw new Error("Invalid all-day date");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + days);
  date.setUTCHours(12, 0, 0, 0);
  const shifted = `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  if (!isValidDateOnly(shifted)) throw new Error("All-day date is outside the supported range");
  return shifted;
}

export function dateInputValue(event: CalendarEvent, edge: "start" | "end") {
  const point = event[edge];
  if (point.date) {
    if (!isValidDateOnly(point.date)) return "";
    return edge === "end" ? shiftDateOnly(point.date, -1) : point.date;
  }
  if (!point.dateTime) return "";
  const date = new Date(point.dateTime);
  const zone = point.timeZone || browserZone();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (key: string) => parts.find(part => part.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function eventDraft(event: CalendarEvent): Draft {
  const allDay = Boolean(event.start.date);
  return {
    title: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    start: dateInputValue(event, "start"),
    end: dateInputValue(event, "end"),
    allDay,
    timeZone: event.start.timeZone || browserZone(),
    calendarId: event.calendarId ?? "",
  };
}

export function wallTimeToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid local date and time");
  const desired = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = desired;
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = targetUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (key: string) => Number(parts.find(part => part.type === key)?.value);
    const representedUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    const difference = targetUtc - representedUtc;
    if (difference === 0) break;
    instant += difference;
  }
  const parts = formatter.formatToParts(new Date(instant));
  const actual = ["year", "month", "day", "hour", "minute"].map(key =>
    Number(parts.find(part => part.type === key)?.value));
  if (actual.some((value, index) => value !== desired[index])) {
    throw new Error("That local time does not exist in the selected time zone because of a clock change");
  }
  return new Date(instant).toISOString();
}

export function toInput(draft: Draft): CalendarEventInput {
  if (draft.allDay && (!isValidDateOnly(draft.start) || !isValidDateOnly(draft.end))) {
    throw new Error("Check the all-day start and end dates");
  }
  const start = draft.allDay
    ? { date: draft.start, dateTime: null, timeZone: null }
    : { date: null, dateTime: wallTimeToIso(draft.start, draft.timeZone), timeZone: draft.timeZone };
  const end = draft.allDay
    ? { date: shiftDateOnly(draft.end, 1), dateTime: null, timeZone: null }
    : { date: null, dateTime: wallTimeToIso(draft.end, draft.timeZone), timeZone: draft.timeZone };
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    location: draft.location.trim() || null,
    start,
    end,
  };
}

export function dateOnlyLabel(value: string) {
  if (!isValidDateOnly(value)) return "Date unavailable";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "long", day: "numeric", timeZone: "UTC",
  })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function eventWhen(event: CalendarEvent) {
  if (event.start.date) {
    if (!isValidDateOnly(event.start.date)) return "Date unavailable · All day";
    const start = dateOnlyLabel(event.start.date);
    if (!event.end.date) return `${start} · All day`;
    if (!isValidDateOnly(event.end.date)) return `${start} – End date unavailable · All day`;
    const end = shiftDateOnly(event.end.date, -1);
    return start === dateOnlyLabel(end) ? `${start} · All day` : `${start} – ${dateOnlyLabel(end)} · All day`;
  }
  if (!event.start.dateTime) return "Time not provided";
  const zone = event.start.timeZone || browserZone();
  const start = new Date(event.start.dateTime);
  const end = event.end.dateTime ? new Date(event.end.dateTime) : null;
  const dateText = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric", timeZone: zone,
  }).format(start);
  const timeFormat: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: zone };
  const times = new Intl.DateTimeFormat(undefined, timeFormat).format(start) +
    (end ? ` – ${new Intl.DateTimeFormat(undefined, timeFormat).format(end)}` : "");
  return `${dateText} · ${times} (${zone})`;
}

export function preserveCalendarDraftForReconnect(
  draft: Draft,
  editing: CalendarEvent | null,
  reconnectRequired = false,
  ownerId?: string,
) {
  if (!ownerId) return;
  sessionStorage.removeItem(RECONNECT_DRAFT_KEY);
  sessionStorage.setItem(`${RECONNECT_DRAFT_KEY}:${encodeURIComponent(ownerId)}`, JSON.stringify({ ownerId, draft, editing, reconnectRequired }));
}

export function saveCalendarDraft(
  draft: Draft,
  editing: CalendarEvent | null,
  reconnectRequired = false,
  ownerId?: string,
) {
  preserveCalendarDraftForReconnect(draft, editing, reconnectRequired, ownerId);
}

export function clearCalendarDraft(ownerId?: string) {
  sessionStorage.removeItem(RECONNECT_DRAFT_KEY);
  if (ownerId) { sessionStorage.removeItem(`${RECONNECT_DRAFT_KEY}:${encodeURIComponent(ownerId)}`); return; }
  const keys: string[] = [];
  for (let index = 0; index < sessionStorage.length; index++) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(`${RECONNECT_DRAFT_KEY}:`)) keys.push(key);
  }
  keys.forEach(key => sessionStorage.removeItem(key));
}

export function restoreCalendarDraftAfterReconnect(ownerId?: string): {
  draft: Draft;
  editing: CalendarEvent | null;
  reconnectRequired: boolean;
} | null {
  // Old unowned plaintext drafts cannot be safely assigned to any account.
  sessionStorage.removeItem(RECONNECT_DRAFT_KEY);
  if (!ownerId) return null;
  const stored = sessionStorage.getItem(`${RECONNECT_DRAFT_KEY}:${encodeURIComponent(ownerId)}`);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as {
      ownerId?: string;
      draft?: Partial<Draft>;
      editing?: CalendarEvent | null;
      reconnectRequired?: boolean;
    };
    if (value.ownerId !== ownerId) return null;
    const draft = value.draft;
    if (
      !draft
      || typeof draft.title !== "string"
      || typeof draft.description !== "string"
      || typeof draft.location !== "string"
      || typeof draft.start !== "string"
      || typeof draft.end !== "string"
      || typeof draft.allDay !== "boolean"
      || typeof draft.timeZone !== "string"
    ) return null;
    const editing = value.editing;
    const reconnectRequired = value.reconnectRequired;
    if (
      editing !== null
      && (!editing || typeof editing !== "object"
        || typeof editing.id !== "string"
        || typeof editing.calendarId !== "string"
        || typeof editing.etag !== "string")
    ) return null;
    if (reconnectRequired !== undefined && typeof reconnectRequired !== "boolean") return null;
    return {
      draft: { ...draft, calendarId: typeof draft.calendarId === "string" ? draft.calendarId : "" } as Draft,
      editing,
      reconnectRequired: reconnectRequired ?? false,
    };
  } catch {
    return null;
  }
}
