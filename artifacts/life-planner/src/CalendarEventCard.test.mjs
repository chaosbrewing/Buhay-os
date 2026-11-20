import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

process.env.PORT ??= "4179";
process.env.BASE_PATH ??= "/";

let vite;
let CalendarEventCard;

test.before(async () => {
  vite = await createServer({
    configFile: "./vite.config.ts",
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  ({ CalendarEventCard } = await vite.ssrLoadModule("/src/CalendarEventCard.tsx"));
});

test.after(async () => {
  await vite?.close();
});

const eventForRole = (accessRole) => ({
  id: `event-${accessRole}`,
  calendarId: "shared-calendar",
  accessRole,
  title: `Team sync (${accessRole})`,
  description: null,
  location: null,
  start: { date: "2026-10-20", dateTime: null, timeZone: null },
  end: { date: "2026-10-21", dateTime: null, timeZone: null },
  etag: "etag",
  updatedAt: null,
  htmlLink: null,
  conferenceUrl: null,
});

function renderCard(accessRole) {
  const event = eventForRole(accessRole);
  return renderToStaticMarkup(React.createElement(CalendarEventCard, {
    event,
    calendarName: "Shared calendar",
    deletePending: false,
    onEdit: () => {},
    onDelete: () => {},
  }));
}

test("reader events stay visible without edit or delete controls", () => {
  const html = renderCard("reader");

  assert.match(html, /<article[^>]*data-testid="card-calendar-event-shared-calendar%3Aevent-reader"/);
  assert.match(html, /Team sync \(reader\)/);
  assert.match(html, /Shared calendar/);
  assert.match(html, /View only/);
  assert.doesNotMatch(html, /button-edit-calendar-event|button-delete-calendar-event/);
});

for (const role of ["owner", "writer"]) {
  test(`${role} events keep edit and delete controls`, () => {
    const html = renderCard(role);
    const eventTestId = `shared-calendar%3Aevent-${role}`;

    assert.match(html, /<article[^>]*data-testid="card-calendar-event-/);
    assert.match(html, new RegExp(`button-edit-calendar-event-${eventTestId}`));
    assert.match(html, new RegExp(`button-delete-calendar-event-${eventTestId}`));
  });
}

for (const role of ["reader", "freeBusyReader"]) {
  test(`${role} events never expose edit or delete controls`, () => {
    const html = renderCard(role);
    assert.match(html, /View only/);
    assert.doesNotMatch(html, /button-edit-calendar-event|button-delete-calendar-event/);
  });
}

test("event cards expose only validated calendar and supported conference links", () => {
  const event = {
    ...eventForRole("writer"),
    htmlLink: "https://calendar.google.com/calendar/event?eid=event-1",
    conferenceUrl: "https://meet.google.com/abc-defg-hij",
  };
  const html = renderToStaticMarkup(React.createElement(CalendarEventCard, {
    event,
    calendarName: "Shared calendar",
    deletePending: false,
    onEdit: () => {},
    onDelete: () => {},
  }));
  assert.match(html, /href="https:\/\/calendar\.google\.com\/calendar\/event\?eid=event-1"/);
  assert.match(html, /href="https:\/\/meet\.google\.com\/abc-defg-hij"/);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length, 2);

  const unsafeEvent = {
    ...event,
    htmlLink: "https://calendar.google.com.evil.test/calendar/event?eid=bad",
    conferenceUrl: "javascript:alert(1)",
  };
  const unsafeHtml = renderToStaticMarkup(React.createElement(CalendarEventCard, {
    event: unsafeEvent,
    calendarName: "Shared calendar",
    deletePending: false,
    onEdit: () => {},
    onDelete: () => {},
  }));
  assert.doesNotMatch(unsafeHtml, /link-google-calendar-event|link-calendar-event-conference/);
});

test("delete controls are disabled while a delete is pending", () => {
  const event = eventForRole("writer");
  const html = renderToStaticMarkup(React.createElement(CalendarEventCard, {
    event,
    calendarName: "Shared calendar",
    deletePending: true,
    onEdit: () => {},
    onDelete: () => {},
  }));
  assert.match(html, /disabled=""[^>]*data-testid="button-delete-calendar-event/);
});