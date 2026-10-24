import assert from 'node:assert/strict';
import { test, expect } from '@playwright/test';

const harnessPath = '/tests/e2e/calendar-recovery-harness.html';
const storageKey = 'buhay-os-calendar-event-draft:calendar-test-account';
const selectedCalendarIds = ['primary-calendar'];
const calendars = [
  { id: 'primary-calendar', summary: 'Personal', primary: true, accessRole: 'owner' },
  { id: 'team-calendar', summary: 'Team', primary: false, accessRole: 'writer' },
];
const existingEvent = {
  id: 'event-edit-1',
  calendarId: 'team-calendar',
  accessRole: 'owner',
  title: 'Planning session',
  description: 'Original description',
  location: 'Meeting room',
  start: { dateTime: '2026-10-20T16:00:00.000Z', date: null, timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-10-20T17:00:00.000Z', date: null, timeZone: 'America/Los_Angeles' },
  etag: '"event-v1"',
  updatedAt: '2026-10-13T10:00:00.000Z',
  htmlLink: null,
  conferenceUrl: null,
};

async function prepareBrowser(page, { oauthResult = 'connected' } = {}) {
  let selectedIds = [...selectedCalendarIds];
  let events = [existingEvent];
  let createShouldReauth = true;
  let updateShouldReauth = true;
  let savedEvent;
  let selectionWrites = 0;
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('__calendar_e2e_started')) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('__calendar_e2e_started', 'true');
  });
  await page.route('**/api/planner/calendar/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/google/connection') && request.method() === 'GET') {
      await route.fulfill({ json: { connected: true, reauthorizationRequired: false } });
      return;
    }
    if (path.endsWith('/google/calendars') && request.method() === 'GET') {
      await route.fulfill({
        json: { calendars, selectedCalendarIds: selectedIds },
      });
      return;
    }
    if (path.endsWith('/calendar/events') && request.method() === 'GET') {
      await route.fulfill({ json: events });
      return;
    }
    if (path.endsWith('/google/calendars/selection') && request.method() === 'PUT') {
      selectionWrites += 1;
      selectedIds = (await request.postDataJSON()).calendarIds;
      await route.fulfill({ json: { selectedCalendarIds: selectedIds } });
      return;
    }
    if (path.endsWith('/calendar/events') && request.method() === 'POST') {
      if (createShouldReauth) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Reconnect Google Calendar to continue.',
            code: 'GOOGLE_REAUTH_REQUIRED',
          }),
        });
        return;
      }
      const body = await request.postDataJSON();
      savedEvent = {
        ...existingEvent,
        ...body,
        id: 'event-created-1',
        title: body.title,
      };
      events = [...events, savedEvent];
      await route.fulfill({ json: savedEvent });
      return;
    }
    if (path.includes('/calendar/events/') && request.method() === 'PATCH') {
      if (updateShouldReauth) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Reconnect Google Calendar to continue.',
            code: 'GOOGLE_REAUTH_REQUIRED',
          }),
        });
        return;
      }
      const body = await request.postDataJSON();
      savedEvent = { ...existingEvent, ...body, title: body.title };
      events = events.map((item) => item.id === existingEvent.id ? savedEvent : item);
      await route.fulfill({ json: savedEvent });
      return;
    }
    if (path.endsWith('/google/authorize')) {
      const callback = `${harnessPath}?calendar=${oauthResult}`;
      await route.fulfill({ status: 302, headers: { location: callback } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unexpected test request: ${request.method()} ${path}` } });
  });
  await page.goto(harnessPath);
  return {
    setOauthResult(value) { oauthResult = value; },
    allowCreate() { createShouldReauth = false; },
    allowUpdate() { updateShouldReauth = false; },
    savedEvent: () => savedEvent,
    selectedIds: () => selectedIds,
    selectionWrites: () => selectionWrites,
  };
}

async function fillCreateDraft(page, title) {
  await page.getByTestId('button-new-calendar-event').click();
  await page.getByTestId('input-calendar-event-title').fill(title);
  await page.getByTestId('input-calendar-event-start').fill('2026-10-20T09:00');
  await page.getByTestId('input-calendar-event-end').fill('2026-10-20T10:00');
  await page.getByTestId('input-calendar-event-location').fill('Quiet room');
  await page.getByTestId('input-calendar-event-description').fill('Draft stays on this device');
  await expect.poll(() => page.evaluate((key) => {
    const stored = sessionStorage.getItem(key);
    return stored ? JSON.parse(stored).draft.title : null;
  }, storageKey)).toBe(title);
}

test('create draft survives refresh and successful reconnect, then clears after save without changing calendar selection', async ({ page }) => {
  const api = await prepareBrowser(page);
  const title = 'Create draft after reconnect';
  await fillCreateDraft(page, title);

  await page.getByTestId('button-save-calendar-event').click();
  await expect(page.getByTestId('error-calendar-event-form')).toContainText('access needs renewal');
  await page.reload();
  await expect(page.getByTestId('dialog-calendar-event')).toBeVisible();
  await expect(page.getByTestId('input-calendar-event-title')).toHaveValue(title);
  await expect(page.getByTestId('button-reconnect-google-calendar')).toBeVisible();
  assert.deepEqual(api.selectedIds(), selectedCalendarIds);

  await page.getByTestId('button-reconnect-google-calendar').click();
  await expect(page.getByTestId('dialog-calendar-event')).toBeVisible();
  await expect(page.getByTestId('error-calendar-event-form')).toContainText('Google Calendar reconnected');
  await expect(page.getByTestId('input-calendar-event-title')).toHaveValue(title);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), storageKey)).not.toBeNull();
  await page.reload();
  await expect(page.getByTestId('dialog-calendar-event')).toBeVisible();
  await expect(page.getByTestId('input-calendar-event-title')).toHaveValue(title);

  api.allowCreate();
  await page.getByTestId('button-save-calendar-event').click();
  await expect(page.getByTestId('status-calendar-action')).toContainText('Event created.');
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  assert.equal(api.savedEvent()?.title, title);
  assert.deepEqual(api.selectedIds(), selectedCalendarIds);
  assert.equal(api.selectionWrites(), 0, 'OAuth recovery must not rewrite the saved calendar selection.');
});

test('edited draft survives a denied reconnect callback and explicit discard clears it', async ({ page }) => {
  const api = await prepareBrowser(page, { oauthResult: 'error' });
  await page.getByRole('button', { name: 'Edit Planning session' }).click();
  await page.getByTestId('input-calendar-event-title').fill('Edited draft kept after denial');
  await page.getByTestId('input-calendar-event-description').fill('Unfinished edit');
  await expect.poll(() => page.evaluate((key) => {
    const stored = sessionStorage.getItem(key);
    return stored ? JSON.parse(stored).draft.title : null;
  }, storageKey)).toBe('Edited draft kept after denial');

  await page.getByTestId('button-save-calendar-event').click();
  await expect(page.getByTestId('error-calendar-event-form')).toContainText('access needs renewal');
  await page.getByTestId('button-reconnect-google-calendar').click();
  await expect(page.getByTestId('dialog-calendar-event')).toBeVisible();
  await expect(page.getByTestId('error-calendar-event-form')).toContainText('could not reconnect');
  await expect(page.getByTestId('input-calendar-event-title')).toHaveValue('Edited draft kept after denial');
  await page.reload();
  await expect(page.getByTestId('dialog-calendar-event')).toBeVisible();
  await expect(page.getByTestId('input-calendar-event-title')).toHaveValue('Edited draft kept after denial');
  await expect(page.getByTestId('button-reconnect-google-calendar')).toBeVisible();
  assert.deepEqual(api.selectedIds(), selectedCalendarIds);

  await page.getByTestId('button-discard-calendar-event-draft').click();
  await expect(page.getByTestId('dialog-calendar-event')).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  assert.deepEqual(api.selectedIds(), selectedCalendarIds);
  assert.equal(api.selectionWrites(), 0);
});
