import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import {
  createCalendarSelectionRouter,
  listGoogleCalendars,
  listGoogleCalendarEvents,
  serializeGoogleCalendarEvent,
} from "./calendarSelection.ts";
import { createCalendarEventWriteRouter } from "./calendarEventWrites.ts";

const availableCalendars = [
  { id: "primary", summary: "Personal", primary: true, accessRole: "owner" },
  { id: "team", summary: "Team", primary: false, accessRole: "writer" },
  { id: "private-other-user", summary: "Private", primary: false, accessRole: "reader" },
];

function createHarness(t, overrides = {}) {
  const selections = new Map([
    ["user-1", ["primary"]],
    ["user-2", ["private-other-user"]],
  ]);
  const eventCalls = [];
  const writeCalls = [];
  const selectionWrites = [];
  const snapshotWrites = [];
  let calendarErrorStatus;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userId = req.header("x-test-user");
    if (!userId) {
      res.status(401).json({ error: "Sign-in is required" });
      return;
    }
    res.locals.userId = userId;
    next();
  });
  app.use(createCalendarSelectionRouter({
    getAccessToken: async (userId) => `access-${userId}`,
    getAvailableCalendars: overrides.getAvailableCalendars ?? (async () => ({
      calendars: availableCalendars,
      ...(calendarErrorStatus ? { errorStatus: calendarErrorStatus } : {}),
    })),
    getSelectedCalendarIds: async (userId) => selections.get(userId) ?? null,
    saveSelectedCalendarIds: async (userId, calendarIds) => {
      selections.set(userId, calendarIds);
      selectionWrites.push({ userId, calendarIds });
    },
    listCalendarEvents: overrides.listCalendarEvents ?? (async (token, calendarId, timeMin, timeMax) => {
      eventCalls.push({ token, calendarId, timeMin, timeMax });
      if (overrides.eventErrorStatus) {
        const error = new Error("Google Calendar permission denied");
        error.status = overrides.eventErrorStatus;
        throw error;
      }
      return [{
        id: `event-${calendarId}`,
        summary: `Details from ${calendarId}`,
        description: "Private event details",
        location: "Somewhere",
        start: { dateTime: "2026-10-12T09:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2026-10-12T10:00:00Z", timeZone: "UTC" },
        etag: '"event-version"',
        updated: "2026-10-01T12:00:00Z",
        htmlLink: "https://calendar.google.com/calendar/event?eid=test",
      }];
    }),
    mapEvent: (event, calendarId, accessRole) => ({
      id: event.id,
      calendarId,
      accessRole,
      title: event.summary,
      description: event.description ?? null,
      location: event.location ?? null,
      start: {
        dateTime: event.start.dateTime ?? null,
        date: event.start.date ?? null,
        timeZone: event.start.timeZone ?? null,
      },
      end: {
        dateTime: event.end.dateTime ?? null,
        date: event.end.date ?? null,
        timeZone: event.end.timeZone ?? null,
      },
      etag: event.etag,
      updatedAt: event.updated,
      htmlLink: event.htmlLink,
      conferenceUrl: event.conferenceUrl ?? null,
    }),
    serializeEvent: serializeGoogleCalendarEvent,
  }));
  app.use(createCalendarEventWriteRouter({
    getAccessToken: async (userId) => `access-${userId}`,
    getAvailableCalendars: overrides.getAvailableCalendars ?? (async () => ({
      calendars: availableCalendars,
      ...(calendarErrorStatus ? { errorStatus: calendarErrorStatus } : {}),
    })),
    googleRequest: async (token, path, init) => {
      writeCalls.push({ token, path, init });
      return overrides.googleRequest
        ? overrides.googleRequest(token, path, init)
        : new Response(null, { status: 500 });
    },
    readConflictEvent: overrides.readConflictEvent ?? (async () => null),
    mapEvent: (value, calendarId = "primary", accessRole = "reader") => ({
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
      conferenceUrl: value.conferenceUrl ?? null,
    }),
    serializeEvent: serializeGoogleCalendarEvent,
  }));

  const server = createServer(app);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not bind to a TCP port"));
        return;
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      resolve({
        baseUrl,
        selections,
        eventCalls,
        selectionWrites,
        snapshotWrites,
        writeCalls,
        setCalendarError(status) {
          calendarErrorStatus = status;
        },
      });
    });
  });
}

function request(harness, path, userId, init = {}) {
  return fetch(`${harness.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "x-test-user": userId,
      ...(init.headers ?? {}),
    },
  });
}

const allDayWriteBody = {
  title: "All-day trip",
  start: { date: "2026-10-12", dateTime: null, timeZone: null },
  end: { date: "2026-10-13", dateTime: null, timeZone: null },
};
const timedWriteBody = {
  title: "A focused block",
  start: { dateTime: "2026-10-12T09:00:00Z", date: null, timeZone: "UTC" },
  end: { dateTime: "2026-10-12T09:30:00Z", date: null, timeZone: "UTC" },
};

function googleEvent(start, end) {
  return {
    id: "write-event",
    summary: "All-day trip",
    start,
    end,
    etag: '"write-event-version"',
    updated: "2026-10-01T12:00:00Z",
    htmlLink: "https://calendar.google.com/calendar/event?eid=write-event",
  };
}

test("create returns Google's all-day start and exclusive end as date-only values", async (t) => {
  const harness = await createHarness(t, {
    googleRequest: async () => new Response(JSON.stringify(googleEvent(
      { date: "2026-10-12" },
      { date: "2026-10-13" },
    )), { status: 200 }),
  });

  const response = await request(harness, "/planner/calendar/events", "user-1", {
    method: "POST",
    body: JSON.stringify(allDayWriteBody),
  });
  assert.equal(response.status, 201);
  const event = await response.json();
  assert.deepEqual(
    [event.start.date, event.end.date, event.start.dateTime, event.end.dateTime],
    ["2026-10-12", "2026-10-13", null, null],
  );
  assert.deepEqual(JSON.parse(harness.writeCalls[0].init.body).start, { date: "2026-10-12" });
  assert.deepEqual(JSON.parse(harness.writeCalls[0].init.body).end, { date: "2026-10-13" });
  assert.equal(harness.writeCalls[0].path, "/calendars/primary/events");
  assert.equal(event.calendarId, "primary");
});

test("create uses the requested writable calendar and returns its calendar role", async (t) => {
  const harness = await createHarness(t, {
    googleRequest: async () => new Response(JSON.stringify(googleEvent(
      { date: "2026-10-12" },
      { date: "2026-10-13" },
    )), { status: 200 }),
  });

  const response = await request(harness, "/planner/calendar/events", "user-1", {
    method: "POST",
    body: JSON.stringify({ ...allDayWriteBody, calendarId: "team" }),
  });

  assert.equal(response.status, 201);
  const event = await response.json();
  assert.equal(harness.writeCalls[0].path, "/calendars/team/events");
  assert.equal(event.calendarId, "team");
  assert.equal(event.accessRole, "writer");
});

test("task event retries recover the original Google event instead of creating duplicates", async (t) => {
  let createdEvent;
  const harness = await createHarness(t, {
    googleRequest: async (_token, path, init) => {
      if (init?.method === "POST") {
        const payload = JSON.parse(init.body);
        createdEvent = {
          ...googleEvent({ dateTime: "2026-10-15T09:00:00Z", timeZone: "UTC" }, { dateTime: "2026-10-15T09:30:00Z", timeZone: "UTC" }),
          id: "task-event-1",
          extendedProperties: payload.extendedProperties,
        };
        return new Response(JSON.stringify(createdEvent), { status: 200 });
      }
      return new Response(JSON.stringify({ items: createdEvent ? [createdEvent] : [] }), { status: 200 });
    },
  });
  const body = JSON.stringify({
    ...timedWriteBody,
    calendarId: "team",
    idempotencyKey: "stable-task-request-0123456789",
  });
  const first = await request(harness, "/planner/calendar/events", "user-1", { method: "POST", body });
  const retry = await request(harness, "/planner/calendar/events", "user-1", { method: "POST", body });

  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal((await first.json()).id, "task-event-1");
  assert.equal((await retry.json()).id, "task-event-1");
  const inserts = harness.writeCalls.filter((call) => call.init?.method === "POST");
  assert.equal(inserts.length, 1);
  const insertedBody = JSON.parse(inserts[0].init.body);
  assert.deepEqual(insertedBody.extendedProperties.private, { buhayOsRequestKey: "stable-task-request-0123456789" });
  assert.equal("idempotencyKey" in insertedBody, false);
});

test("task event writes require an authenticated planner account", async (t) => {
  let googleCalls = 0;
  const harness = await createHarness(t, {
    googleRequest: async () => {
      googleCalls += 1;
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });
  const response = await fetch(`${harness.baseUrl}/planner/calendar/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...timedWriteBody, idempotencyKey: "stable-task-request-0123456789" }),
  });
  assert.equal(response.status, 401);
  assert.equal(googleCalls, 0);
});

test("matching retry keys cannot recover another signed-in user's calendar event", async (t) => {
  const eventsByToken = new Map();
  const harness = await createHarness(t, {
    googleRequest: async (token, _path, init) => {
      if (init?.method === "POST") {
        const payload = JSON.parse(init.body);
        const event = {
          ...googleEvent({ dateTime: "2026-10-15T09:00:00Z", timeZone: "UTC" }, { dateTime: "2026-10-15T09:30:00Z", timeZone: "UTC" }),
          id: `event-${token}`,
          extendedProperties: payload.extendedProperties,
        };
        eventsByToken.set(token, event);
        return new Response(JSON.stringify(event), { status: 200 });
      }
      const event = eventsByToken.get(token);
      return new Response(JSON.stringify({ items: event ? [event] : [] }), { status: 200 });
    },
  });
  const body = JSON.stringify({ ...timedWriteBody, calendarId: "team", idempotencyKey: "stable-task-request-0123456789" });
  const firstUser = await request(harness, "/planner/calendar/events", "user-1", { method: "POST", body });
  const secondUser = await request(harness, "/planner/calendar/events", "user-2", { method: "POST", body });
  assert.equal(firstUser.status, 201);
  assert.equal(secondUser.status, 201);
  assert.notEqual((await firstUser.json()).id, (await secondUser.json()).id);
  assert.equal(harness.writeCalls.filter((call) => call.init?.method === "POST").length, 2);
});

test("create rejects calendars that are missing or no longer writable", async (t) => {
  const harness = await createHarness(t);

  for (const calendarId of ["private-other-user", "removed-calendar"]) {
    const response = await request(harness, "/planner/calendar/events", "user-1", {
      method: "POST",
      body: JSON.stringify({ ...allDayWriteBody, calendarId }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "GOOGLE_CALENDAR_NOT_WRITABLE");
  }
  assert.deepEqual(harness.writeCalls, []);
});

test("create reports when a calendar loses write access or disappears after it was listed", async (t) => {
  for (const googleStatus of [403, 404]) {
    const harness = await createHarness(t, {
      googleRequest: async () => new Response(null, { status: googleStatus }),
    });

    const response = await request(harness, "/planner/calendar/events", "user-1", {
      method: "POST",
      body: JSON.stringify({ ...allDayWriteBody, calendarId: "team" }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "GOOGLE_CALENDAR_NOT_WRITABLE");
  }
});

test("event writes reject malformed date-only inputs before JavaScript can normalize them", async (t) => {
  const harness = await createHarness(t);
  const response = await request(harness, "/planner/calendar/events", "user-1", {
    method: "POST",
    body: JSON.stringify({
      ...allDayWriteBody,
      start: { date: "2026-02-31", dateTime: null, timeZone: null },
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid YYYY-MM-DD/);
  assert.deepEqual(harness.writeCalls, []);
});

test("edit returns Google's all-day start and exclusive end as date-only values", async (t) => {
  const harness = await createHarness(t, {
    googleRequest: async () => new Response(JSON.stringify(googleEvent(
      { date: "2026-10-12" },
      { date: "2026-10-13" },
    )), { status: 200 }),
  });

  const response = await request(harness, "/planner/calendar/events/team/write-event", "user-1", {
    method: "PATCH",
    headers: { "If-Match": '"previous-version"' },
    body: JSON.stringify(allDayWriteBody),
  });
  assert.equal(response.status, 200);
  const event = await response.json();
  assert.deepEqual(
    [event.start.date, event.end.date, event.start.dateTime, event.end.dateTime],
    ["2026-10-12", "2026-10-13", null, null],
  );
  assert.equal(harness.writeCalls[0].init.headers["If-Match"], '"previous-version"');
});

test("all-day edit conflicts keep the current Google dates date-only", async (t) => {
  const harness = await createHarness(t, {
    googleRequest: async () => new Response(null, { status: 412 }),
    readConflictEvent: async () => ({
      id: "write-event",
      calendarId: "team",
      accessRole: "writer",
      title: "All-day trip",
      description: null,
      location: null,
      start: { dateTime: null, date: "2026-10-12", timeZone: null },
      end: { dateTime: null, date: "2026-10-13", timeZone: null },
      etag: '"write-event-version"',
      updatedAt: "2026-10-01T12:00:00Z",
      htmlLink: "https://calendar.google.com/calendar/event?eid=write-event",
    }),
  });

  const response = await request(harness, "/planner/calendar/events/team/write-event", "user-1", {
    method: "PATCH",
    headers: { "If-Match": '"stale-version"' },
    body: JSON.stringify(allDayWriteBody),
  });
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.deepEqual(
    [
      result.current.start.date,
      result.current.end.date,
      result.current.start.dateTime,
      result.current.end.dateTime,
    ],
    ["2026-10-12", "2026-10-13", null, null],
  );
});

test("a timed create response remains a timestamp", async (t) => {
  const harness = await createHarness(t, {
    googleRequest: async () => new Response(JSON.stringify(googleEvent(
      { dateTime: "2026-10-12T09:30:00-07:00", timeZone: "America/Los_Angeles" },
      { dateTime: "2026-10-12T10:30:00-07:00", timeZone: "America/Los_Angeles" },
    )), { status: 200 }),
  });
  const body = {
    ...allDayWriteBody,
    start: { dateTime: "2026-10-12T09:30:00-07:00", date: null, timeZone: "America/Los_Angeles" },
    end: { dateTime: "2026-10-12T10:30:00-07:00", date: null, timeZone: "America/Los_Angeles" },
  };

  const response = await request(harness, "/planner/calendar/events", "user-1", {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  const event = await response.json();
  assert.deepEqual(
    [event.start.date, event.end.date, event.start.dateTime, event.end.dateTime],
    [null, null, "2026-10-12T16:30:00.000Z", "2026-10-12T17:30:00.000Z"],
  );
});

test("all-day dates stay date-only beside timed events across time zones", async (t) => {
  const harness = await createHarness(t, {
    listCalendarEvents: async (_token, calendarId) => calendarId === "primary"
      ? [{
          id: "all-day-event",
          summary: "All day",
          start: { date: "2026-10-12" },
          end: { date: "2026-10-13" },
          etag: '"all-day-version"',
          updated: "2026-10-01T12:00:00Z",
          htmlLink: "https://calendar.google.com/calendar/event?eid=all-day",
        }]
      : [{
          id: "timed-event",
          summary: "Timed",
          start: { dateTime: "2026-10-12T23:30:00-07:00", timeZone: "America/Los_Angeles" },
          end: { dateTime: "2026-10-13T00:30:00-07:00", timeZone: "America/Los_Angeles" },
          etag: '"timed-version"',
          updated: "2026-10-01T12:00:00Z",
          htmlLink: "https://calendar.google.com/calendar/event?eid=timed",
        }],
  });
  harness.selections.set("user-1", ["primary", "team"]);
  const originalTimeZone = process.env.TZ;

  try {
    for (const timeZone of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
      process.env.TZ = timeZone;
      const response = await request(
        harness,
        "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-14T00%3A00%3A00.000Z",
        "user-1",
      );
      assert.equal(response.status, 200);
      const events = await response.json();
      const allDay = events.find((event) => event.id === "all-day-event");
      const timed = events.find((event) => event.id === "timed-event");

      assert.deepEqual(
        [allDay.start.date, allDay.end.date, allDay.start.dateTime, allDay.end.dateTime],
        ["2026-10-12", "2026-10-13", null, null],
      );
      assert.deepEqual(
        [timed.start.date, timed.end.date, timed.start.dateTime, timed.end.dateTime],
        [null, null, "2026-10-13T06:30:00.000Z", "2026-10-13T07:30:00.000Z"],
      );
    }
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});

test("all-day API event serialization preserves leap-day and year-boundary dates", () => {
  for (const [start, end] of [
    ["2024-02-29", "2024-03-01"],
    ["2026-12-31", "2027-01-01"],
  ]) {
    const event = serializeGoogleCalendarEvent({
      id: "boundary-event",
      calendarId: "primary",
      accessRole: "owner",
      title: "Date boundary",
      description: null,
      location: null,
      start: { date: start, dateTime: null, timeZone: null },
      end: { date: end, dateTime: null, timeZone: null },
      etag: '"boundary"',
      updatedAt: null,
      htmlLink: null,
    });
    assert.deepEqual([event.start.date, event.end.date], [start, end]);
  }
  assert.throws(() => serializeGoogleCalendarEvent({
    id: "malformed-event",
    calendarId: "primary",
    accessRole: "owner",
    title: "Bad date",
    description: null,
    location: null,
    start: { date: "2026-02-31", dateTime: null, timeZone: null },
    end: { date: "2026-03-01", dateTime: null, timeZone: null },
    etag: '"bad"',
    updatedAt: null,
    htmlLink: null,
  }), /malformed all-day date/);
});

test("calendar selection reads and writes stay isolated to the signed-in user", async (t) => {
  const harness = await createHarness(t);
  const saved = await request(
    harness,
    "/planner/calendar/google/calendars/selection",
    "user-1",
    { method: "PUT", body: JSON.stringify({ calendarIds: ["team"] }) },
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { selectedCalendarIds: ["team"] });

  const firstUser = await request(harness, "/planner/calendar/google/calendars", "user-1");
  const secondUser = await request(harness, "/planner/calendar/google/calendars", "user-2");
  assert.deepEqual((await firstUser.json()).selectedCalendarIds, ["team"]);
  assert.deepEqual((await secondUser.json()).selectedCalendarIds, ["private-other-user"]);
  assert.deepEqual(harness.selections.get("user-1"), ["team"]);
  assert.deepEqual(harness.selections.get("user-2"), ["private-other-user"]);
  assert.deepEqual(harness.selectionWrites, [{ userId: "user-1", calendarIds: ["team"] }]);
});

test("calendar chooser follows every page token and includes each calendar once", async (t) => {
  const pageCalls = [];
  const pages = {
    null: {
      items: [
        { id: "primary", summary: "Personal", primary: true, accessRole: "owner" },
      ],
      nextPageToken: "page-2",
    },
    "page-2": {
      items: [
        { id: "team", summary: "Team", accessRole: "writer" },
        { id: "primary", summary: "Personal duplicate", primary: true, accessRole: "owner" },
      ],
      nextPageToken: "page-3",
    },
    "page-3": {
      items: [
        { id: "shared", summary: "Shared", accessRole: "reader" },
        { id: "team", summary: "Team duplicate", accessRole: "reader" },
      ],
    },
  };
  const harness = await createHarness(t, {
    getAvailableCalendars: (token) => listGoogleCalendars(token, async (requestToken, path) => {
      const url = new URL(path, "https://calendar.test");
      const pageToken = url.searchParams.get("pageToken");
      pageCalls.push({ token: requestToken, pageToken });
      return {
        ok: true,
        status: 200,
        json: async () => pages[pageToken],
      };
    }),
  });

  const response = await request(harness, "/planner/calendar/google/calendars", "user-1");

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(pageCalls, [
    { token: "access-user-1", pageToken: null },
    { token: "access-user-1", pageToken: "page-2" },
    { token: "access-user-1", pageToken: "page-3" },
  ]);
  assert.deepEqual(result.calendars.map(({ id }) => id), ["primary", "team", "shared"]);
  assert.equal(new Set(result.calendars.map(({ id }) => id)).size, 3);
  assert.deepEqual(
    result.calendars.map(({ id, summary, accessRole }) => [id, summary, accessRole]),
    [
      ["primary", "Personal", "owner"],
      ["team", "Team", "writer"],
      ["shared", "Shared", "reader"],
    ],
  );
});

test("calendar chooser stops with an explicit error when Google repeats a page token", async (t) => {
  const pageTokens = [];
  const harness = await createHarness(t, {
    getAvailableCalendars: (token) => listGoogleCalendars(token, async (_requestToken, path) => {
      const pageToken = new URL(path, "https://calendar.test").searchParams.get("pageToken");
      pageTokens.push(pageToken);
      return {
        ok: true,
        status: 200,
        json: async () => pageToken
          ? { items: [{ id: "later-calendar" }], nextPageToken: "page-2" }
          : {
              items: [{ id: "primary", summary: "Personal" }],
              nextPageToken: "page-2",
            },
      };
    }),
  });

  const response = await request(harness, "/planner/calendar/google/calendars", "user-1");

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Google Calendar returned a repeated page token.",
    code: "GOOGLE_PAGINATION_ERROR",
  });
  assert.deepEqual(pageTokens, [null, "page-2"]);
});

test("a later calendar-list page failure returns an error instead of partial calendars", async (t) => {
  const pageTokens = [];
  const harness = await createHarness(t, {
    getAvailableCalendars: (token) => listGoogleCalendars(token, async (_requestToken, path) => {
      const pageToken = new URL(path, "https://calendar.test").searchParams.get("pageToken");
      pageTokens.push(pageToken);
      return pageToken
        ? { ok: false, status: 503, json: async () => ({}) }
        : {
            ok: true,
            status: 200,
            json: async () => ({
              items: [{ id: "first-page-only", summary: "First page" }],
              nextPageToken: "page-2",
            }),
          };
    }),
  });

  const response = await request(harness, "/planner/calendar/google/calendars", "user-1");

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Google Calendar could not load calendars",
    code: "GOOGLE_TEMPORARY_ERROR",
  });
  assert.deepEqual(pageTokens, [null, "page-2"]);
});

test("calendar selection accepts a calendar found on a later page", async (t) => {
  const harness = await createHarness(t, {
    getAvailableCalendars: (token) => listGoogleCalendars(token, async (_requestToken, path) => {
      const pageToken = new URL(path, "https://calendar.test").searchParams.get("pageToken");
      return {
        ok: true,
        status: 200,
        json: async () => pageToken
          ? { items: [{ id: "later-calendar", summary: "Later calendar" }] }
          : {
              items: [{ id: "primary", summary: "Personal", primary: true, accessRole: "owner" }],
              nextPageToken: "page-2",
            },
      };
    }),
  });

  const response = await request(
    harness,
    "/planner/calendar/google/calendars/selection",
    "user-1",
    { method: "PUT", body: JSON.stringify({ calendarIds: ["later-calendar"] }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { selectedCalendarIds: ["later-calendar"] });
  assert.deepEqual(harness.selections.get("user-1"), ["later-calendar"]);
  assert.deepEqual(harness.selectionWrites, [{ userId: "user-1", calendarIds: ["later-calendar"] }]);
});

test("event listing requests only the signed-in user's selected calendars", async (t) => {
  const harness = await createHarness(t);
  harness.selections.set("user-1", ["team", "primary", "private-other-user"]);
  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 200);
  const events = await response.json();
  assert.deepEqual(events.map((event) => event.calendarId).sort(), ["primary", "private-other-user", "team"]);
  assert.deepEqual(
    events.map((event) => [event.calendarId, event.accessRole]).sort(),
    [["primary", "owner"], ["private-other-user", "reader"], ["team", "writer"]],
  );
  assert.deepEqual(
    harness.eventCalls.map(({ token, calendarId }) => [token, calendarId]).sort(),
    [["access-user-1", "primary"], ["access-user-1", "private-other-user"], ["access-user-1", "team"]],
  );
});

test("event listing follows every selected calendar's page tokens exactly once", async (t) => {
  const pageCalls = [];
  const event = (id) => ({
    id,
    summary: id,
    etag: `"${id}-version"`,
    updated: "2026-10-01T12:00:00Z",
    htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
    start: { dateTime: "2026-10-12T09:00:00Z", timeZone: "UTC" },
    end: { dateTime: "2026-10-12T10:00:00Z", timeZone: "UTC" },
  });
  const pages = {
    primary: [
      { items: [event("primary-1"), event("primary-2")], nextPageToken: "primary-page-2" },
      { items: [event("primary-3"), event("primary-4")] },
    ],
    team: [
      { items: [event("team-1"), event("team-2")], nextPageToken: "team-page-2" },
      { items: [event("team-3"), event("team-4")] },
    ],
  };
  const harness = await createHarness(t, {
    listCalendarEvents: (token, calendarId, timeMin, timeMax) =>
      listGoogleCalendarEvents(token, calendarId, timeMin, timeMax, async (requestToken, path) => {
        const url = new URL(path, "https://calendar.test");
        pageCalls.push({
          token: requestToken,
          calendarId,
          pageToken: url.searchParams.get("pageToken"),
        });
        const calendarPages = pages[calendarId];
        const pageIndex = pageCalls.filter((call) => call.calendarId === calendarId).length - 1;
        return {
          ok: true,
          status: 200,
          json: async () => calendarPages[pageIndex],
        };
      }),
  });
  harness.selections.set("user-1", ["team", "primary"]);

  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 200);
  const events = await response.json();
  assert.deepEqual(
    pageCalls.map(({ token, calendarId, pageToken }) => [token, calendarId, pageToken]).sort(),
    [
      ["access-user-1", "primary", null],
      ["access-user-1", "primary", "primary-page-2"],
      ["access-user-1", "team", null],
      ["access-user-1", "team", "team-page-2"],
    ],
  );
  assert.equal(events.length, 8);
  assert.deepEqual(
    events.map((item) => item.id).sort(),
    ["primary-1", "primary-2", "primary-3", "primary-4", "team-1", "team-2", "team-3", "team-4"],
  );
});

test("event listing stops with an explicit error when Google repeats a page token", async (t) => {
  const pageTokens = [];
  const harness = await createHarness(t, {
    listCalendarEvents: (token, calendarId, timeMin, timeMax) =>
      listGoogleCalendarEvents(token, calendarId, timeMin, timeMax, async (_requestToken, path) => {
        const pageToken = new URL(path, "https://calendar.test").searchParams.get("pageToken");
        pageTokens.push(pageToken);
        return {
          ok: true,
          status: 200,
          json: async () => pageToken
            ? { items: [], nextPageToken: "page-2" }
            : { items: [], nextPageToken: "page-2" },
        };
      }),
  });
  harness.selections.set("user-1", ["team"]);

  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Google Calendar returned a repeated page token.",
    code: "GOOGLE_PAGINATION_ERROR",
  });
  assert.deepEqual(pageTokens, [null, "page-2"]);
});

test("a later event page failure returns an error instead of partial events", async (t) => {
  const pageTokens = [];
  const harness = await createHarness(t, {
    listCalendarEvents: (token, calendarId, timeMin, timeMax) =>
      listGoogleCalendarEvents(token, calendarId, timeMin, timeMax, async (_requestToken, path) => {
        const url = new URL(path, "https://calendar.test");
        const pageToken = url.searchParams.get("pageToken");
        pageTokens.push(pageToken);
        return pageToken
          ? { ok: false, status: 503, json: async () => ({}) }
          : {
              ok: true,
              status: 200,
              json: async () => ({
                items: [{
                  id: "first-page-only",
                  summary: "First page",
                  start: { dateTime: "2026-10-12T09:00:00Z", timeZone: "UTC" },
                  end: { dateTime: "2026-10-12T10:00:00Z", timeZone: "UTC" },
                }],
                nextPageToken: "page-2",
              }),
            };
      }),
  });
  harness.selections.set("user-1", ["team"]);

  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Google Calendar could not load events. Please try again.",
    code: "GOOGLE_TEMPORARY_ERROR",
  });
  assert.deepEqual(pageTokens, [null, "page-2"]);
});

test("events remain visible but read-only when Google does not return calendar permissions", async (t) => {
  const harness = await createHarness(t);
  harness.selections.set("user-1", ["team"]);
  harness.setCalendarError(403);

  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 200);
  const events = await response.json();
  assert.equal(events.length, 1);
  assert.equal(events[0].calendarId, "team");
  assert.equal(events[0].accessRole, "reader");
});

test("unavailable calendar IDs are rejected without changing the saved selection", async (t) => {
  const harness = await createHarness(t);
  const response = await request(
    harness,
    "/planner/calendar/google/calendars/selection",
    "user-1",
    { method: "PUT", body: JSON.stringify({ calendarIds: ["private-unavailable"] }) },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(harness.selections.get("user-1"), ["primary"]);
  assert.deepEqual(harness.selectionWrites, []);
});

test("Google calendar-list permission failures are returned to both chooser routes", async (t) => {
  const harness = await createHarness(t);
  harness.setCalendarError(403);

  const listed = await request(harness, "/planner/calendar/google/calendars", "user-1");
  const saved = await request(
    harness,
    "/planner/calendar/google/calendars/selection",
    "user-1",
    { method: "PUT", body: JSON.stringify({ calendarIds: ["team"] }) },
  );
  const listedBody = await listed.json();
  const savedBody = await saved.json();
  assert.equal(listed.status, 403);
  assert.match(listedBody.error, /access/);
  assert.equal(listedBody.code, "GOOGLE_ACCESS_UPDATE_REQUIRED");
  assert.equal(saved.status, 403);
  assert.match(savedBody.error, /access/);
  assert.equal(savedBody.code, "GOOGLE_ACCESS_UPDATE_REQUIRED");
  assert.deepEqual(harness.selectionWrites, []);
});

test("event details are returned transiently without planner snapshot writes", async (t) => {
  const harness = await createHarness(t);
  harness.selections.set("user-1", ["team"]);
  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 200);
  const events = await response.json();
  assert.equal(events[0].description, "Private event details");
  assert.equal(events[0].location, "Somewhere");
  assert.equal(events[0].accessRole, "writer");
  assert.deepEqual(harness.snapshotWrites, []);
  assert.deepEqual(harness.selectionWrites, []);
});

test("Google event permission errors are surfaced", async (t) => {
  const harness = await createHarness(t, { eventErrorStatus: 403 });
  harness.selections.set("user-1", ["team"]);
  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "GOOGLE_ACCESS_UPDATE_REQUIRED");
  assert.deepEqual(harness.eventCalls.map(({ calendarId }) => calendarId), ["team"]);
  assert.deepEqual(harness.snapshotWrites, []);
});

test("terminal Google event authorization failures are marked for reconnect", async (t) => {
  const harness = await createHarness(t, { eventErrorStatus: 401 });
  harness.selections.set("user-1", ["team"]);
  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Reconnect Google Calendar to continue. Your saved calendar selection is safe.",
    code: "GOOGLE_REAUTH_REQUIRED",
  });
  assert.deepEqual(harness.snapshotWrites, []);
});

test("calendar pagination rejects malformed tokens and malformed page bodies without partial lists", async (t) => {
  for (const malformed of [
    { items: [{ id: "valid-first-page" }], nextPageToken: "" },
    { items: "not-an-array" },
  ]) {
    const harness = await createHarness(t, {
      getAvailableCalendars: (token) => listGoogleCalendars(token, async () => ({
        ok: true,
        status: 200,
        json: async () => malformed,
      })),
    });
    const response = await request(harness, "/planner/calendar/google/calendars", "user-1");
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "GOOGLE_INVALID_RESPONSE");
    assert.deepEqual(harness.selections.get("user-1"), ["primary"]);
    assert.deepEqual(harness.selectionWrites, []);
  }
});

test("calendar pagination stops at the documented 20-page limit without exposing partial calendars", async (t) => {
  let calls = 0;
  const harness = await createHarness(t, {
    getAvailableCalendars: (token) => listGoogleCalendars(token, async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: `calendar-${calls}` }],
          nextPageToken: `token-${calls}`,
        }),
      };
    }),
  });
  const response = await request(harness, "/planner/calendar/google/calendars", "user-1");
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "GOOGLE_PAGINATION_ERROR");
  assert.match(body.error, /20-page calendar limit/);
  assert.equal(calls, 20);
  assert.deepEqual(harness.selections.get("user-1"), ["primary"]);
  assert.deepEqual(harness.selectionWrites, []);
});

test("event pagination rejects malformed pages and does not return first-page events", async (t) => {
  const harness = await createHarness(t, {
    listCalendarEvents: (token, calendarId, timeMin, timeMax) =>
      listGoogleCalendarEvents(token, calendarId, timeMin, timeMax, async (_requestToken, path) => {
        const pageToken = new URL(path, "https://calendar.test").searchParams.get("pageToken");
        return {
          ok: true,
          status: 200,
          json: async () => pageToken
            ? { items: "not-an-array" }
            : { items: [{ id: "first-page-event" }], nextPageToken: "page-2" },
        };
      }),
  });
  harness.selections.set("user-1", ["team"]);
  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Google Calendar returned an invalid response. Please try again.",
    code: "GOOGLE_INVALID_RESPONSE",
  });
});

test("event pagination stops at 20 pages without returning incomplete events", async (t) => {
  let calls = 0;
  const harness = await createHarness(t, {
    listCalendarEvents: (token, calendarId, timeMin, timeMax) =>
      listGoogleCalendarEvents(token, calendarId, timeMin, timeMax, async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            nextPageToken: `events-token-${calls}`,
          }),
        };
      }),
  });
  harness.selections.set("user-1", ["team"]);
  const response = await request(
    harness,
    "/planner/calendar/events?timeMin=2026-10-12T00%3A00%3A00.000Z&timeMax=2026-10-13T00%3A00%3A00.000Z",
    "user-1",
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "GOOGLE_PAGINATION_ERROR");
  assert.match(body.error, /20-page event limit/);
  assert.equal(calls, 20);
});
