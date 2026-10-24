import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  dateInputValue,
  dateOnlyLabel,
  eventDraft,
  eventWhen,
  clearCalendarDraft,
  preserveCalendarDraftForReconnect,
  restoreCalendarDraftAfterReconnect,
  saveCalendarDraft,
  toInput,
  wallTimeToIso,
} from "./calendarDate.ts";

test("all-day input stays date-only and displays the exclusive end as the last included day", () => {
  const event = {
    title: "Long weekend",
    description: null,
    location: null,
    start: { date: "2026-03-07", dateTime: null, timeZone: null },
    end: { date: "2026-03-10", dateTime: null, timeZone: null },
  };
  assert.equal(dateInputValue(event, "start"), "2026-03-07");
  assert.equal(dateInputValue(event, "end"), "2026-03-09");
  assert.deepEqual(toInput({
    title: "  Long weekend ",
    description: "",
    location: " ",
    start: "2026-03-07",
    end: "2026-03-09",
    allDay: true,
    timeZone: "America/Los_Angeles",
  }), {
    title: "Long weekend",
    description: null,
    location: null,
    start: { date: "2026-03-07", dateTime: null, timeZone: null },
    end: { date: "2026-03-10", dateTime: null, timeZone: null },
  });
  assert.match(eventWhen(event), /All day$/);
});

test("all-day labels and edit dates stay fixed across browser time zones while timed labels use the event zone", () => {
  const moduleUrl = new URL("./calendarDate.ts", import.meta.url).href;
  const script = `
    import { eventDraft, eventWhen, toInput } from ${JSON.stringify(moduleUrl)};
    const allDay = {
      title: "Long weekend",
      description: null,
      location: null,
      start: { date: "2026-03-07", dateTime: null, timeZone: null },
      end: { date: "2026-03-10", dateTime: null, timeZone: null },
    };
    const timed = {
      start: { dateTime: "2026-03-08T06:30:00.000Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-03-08T07:30:00.000Z", timeZone: "America/New_York" },
    };
    const draft = eventDraft(allDay);
    console.log(JSON.stringify({
      label: eventWhen(allDay),
      draftStart: draft.start,
      draftEnd: draft.end,
      savedStart: toInput(draft).start.date,
      savedExclusiveEnd: toInput(draft).end.date,
      timedLabel: eventWhen(timed),
    }));
  `;
  const browserZones = ["Pacific/Kiritimati", "America/Los_Angeles", "Europe/Paris"];
  let referenceLabels;

  for (const timeZone of browserZones) {
    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { encoding: "utf8", env: { ...process.env, TZ: timeZone } },
    );
    const result = JSON.parse(output);

    assert.equal(result.draftStart, "2026-03-07", `edit start in ${timeZone}`);
    assert.equal(result.draftEnd, "2026-03-09", `edit end in ${timeZone}`);
    assert.equal(result.savedStart, "2026-03-07", `saved start in ${timeZone}`);
    assert.equal(result.savedExclusiveEnd, "2026-03-10", `exclusive saved end in ${timeZone}`);
    assert.match(result.label, /March 7.*March 9.*All day/, `all-day label in ${timeZone}`);
    assert.equal(
      result.timedLabel,
      "Sunday, March 8 · 1:30 AM – 3:30 AM (America/New_York)",
      `timed label in ${timeZone}`,
    );

    const labels = { allDay: result.label, timed: result.timedLabel };
    if (referenceLabels) assert.deepEqual(labels, referenceLabels, `labels in ${timeZone}`);
    else referenceLabels = labels;
  }
});

test("valid wall times on both sides of a daylight-saving transition map to the right instants", () => {
  assert.equal(
    wallTimeToIso("2026-03-08T01:30", "America/New_York"),
    "2026-03-08T06:30:00.000Z",
  );
  assert.equal(
    wallTimeToIso("2026-03-08T03:30", "America/New_York"),
    "2026-03-08T07:30:00.000Z",
  );
});

test("nonexistent daylight-saving wall times are rejected instead of silently shifted", () => {
  assert.throws(
    () => wallTimeToIso("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
});

test("ambiguous fall-back wall times remain valid and malformed times are rejected", () => {
  assert.match(
    wallTimeToIso("2026-11-01T01:30", "America/New_York"),
    /^2026-11-01T\d{2}:30:00\.000Z$/,
  );
  assert.throws(() => wallTimeToIso("not-a-time", "America/New_York"), /Invalid local date and time/);
});

test("all-day leap dates and year boundaries round-trip with exclusive end dates", () => {
  for (const sample of [
    { start: "2024-02-28", end: "2024-02-29", exclusiveEnd: "2024-03-01" },
    { start: "2026-12-31", end: "2026-12-31", exclusiveEnd: "2027-01-01" },
  ]) {
    const input = toInput({
      title: "Date boundary",
      description: "",
      location: "",
      start: sample.start,
      end: sample.end,
      allDay: true,
      timeZone: "UTC",
    });
    assert.equal(input.start.date, sample.start);
    assert.equal(input.end.date, sample.exclusiveEnd);
    assert.equal(dateInputValue({
      start: input.start,
      end: input.end,
    }, "end"), sample.end);
  }
});

test("malformed date-only values are rejected or shown with a safe fallback", () => {
  const malformed = {
    title: "Bad date",
    description: null,
    location: null,
    start: { date: "2026-02-31", dateTime: null, timeZone: null },
    end: { date: "2026-03-01", dateTime: null, timeZone: null },
  };
  assert.equal(dateInputValue(malformed, "start"), "");
  assert.equal(dateOnlyLabel("2026-02-31"), "Date unavailable");
  assert.equal(eventWhen(malformed), "Date unavailable · All day");
  assert.throws(() => toInput({
    title: "Bad date",
    description: "",
    location: "",
    start: "2026-02-31",
    end: "2026-03-01",
    allDay: true,
    timeZone: "UTC",
  }), /all-day start and end dates/);
});

test("an unfinished create draft survives restore and refresh until explicitly cleared", () => {
  const values = new Map();
  globalThis.sessionStorage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
  const draft = {
    title: "Draft after reconnect",
    description: "Keep this",
    location: "Room 2",
    start: "2026-10-12T09:00",
    end: "2026-10-12T10:00",
    allDay: false,
    timeZone: "America/Los_Angeles",
    calendarId: "team",
  };
  preserveCalendarDraftForReconnect(draft, null, false, 'account-a');
  const callbackUrl = new URL("https://daybook.example/planner/calendar?calendar=error");
  assert.equal(callbackUrl.searchParams.get("calendar"), "error");
  assert.deepEqual(restoreCalendarDraftAfterReconnect('account-a'), {
    draft,
    editing: null,
    reconnectRequired: false,
  });
  assert.deepEqual(restoreCalendarDraftAfterReconnect('account-a'), {
    draft,
    editing: null,
    reconnectRequired: false,
  });
  saveCalendarDraft({ ...draft, title: "Edited after refresh" }, null, true, 'account-a');
  assert.deepEqual(restoreCalendarDraftAfterReconnect('account-a'), {
    draft: { ...draft, title: "Edited after refresh" },
    editing: null,
    reconnectRequired: true,
  });
  assert.equal(restoreCalendarDraftAfterReconnect('account-b'), null);
  values.set('buhay-os-calendar-event-draft:account-b', values.get('buhay-os-calendar-event-draft:account-a'));
  assert.equal(restoreCalendarDraftAfterReconnect('account-b'), null, 'even a copied cache must prove matching ownership');
  values.set('buhay-os-calendar-event-draft', JSON.stringify({ draft, editing: null }));
  assert.equal(restoreCalendarDraftAfterReconnect(), null, 'legacy unowned plaintext is never restored');
  assert.equal(values.has('buhay-os-calendar-event-draft'), false);
  clearCalendarDraft('account-a');
  assert.equal(restoreCalendarDraftAfterReconnect('account-a'), null);
  delete globalThis.sessionStorage;
});

test("an unfinished edit form survives a successful OAuth callback with its event identity", () => {
  const values = new Map();
  globalThis.sessionStorage = {
    setItem: (key, value) => values.set(key, value),
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
  };
  const draft = {
    title: "Updated event title",
    description: "Keep these edits",
    location: "Room 2",
    start: "2026-10-12T09:00",
    end: "2026-10-12T10:00",
    allDay: false,
    timeZone: "America/Los_Angeles",
    calendarId: "team",
  };
  const editing = { id: "event-1", calendarId: "primary", etag: '"v1"' };
  preserveCalendarDraftForReconnect(draft, editing, false, 'account-a');
  const callbackUrl = new URL("https://daybook.example/planner/calendar?calendar=connected");
  assert.equal(callbackUrl.searchParams.get("calendar"), "connected");
  assert.deepEqual(restoreCalendarDraftAfterReconnect('account-a'), {
    draft,
    editing,
    reconnectRequired: false,
  });
  assert.deepEqual(restoreCalendarDraftAfterReconnect('account-a'), {
    draft,
    editing,
    reconnectRequired: false,
  });
  delete globalThis.sessionStorage;
});
