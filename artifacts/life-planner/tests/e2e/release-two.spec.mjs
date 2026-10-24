import assert from 'node:assert/strict';
import { test, expect } from '@playwright/test';

const harnessPath = '/tests/e2e/release-two-harness.html';

async function preparePlanner(page, query = '') {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__release_two_e2e_started')) return;
    localStorage.clear();
    sessionStorage.setItem('__release_two_e2e_started', 'true');
  });
  await page.route('**/api/planner/calendar/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/google/connection')) {
      await route.fulfill({ json: { connected: true, reauthorizationRequired: false } });
      return;
    }
    if (url.pathname.endsWith('/calendar/events')) {
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await route.fulfill({
        json: [{
          id: 'selected-calendar-event',
          calendarId: 'selected-calendar',
          accessRole: 'reader',
          title: 'Authorized selected-calendar event',
          description: null,
          location: null,
          start: { date, dateTime: null, timeZone: null },
          end: { date, dateTime: null, timeZone: null },
          etag: '"event-v1"',
          updatedAt: new Date().toISOString(),
          htmlLink: null,
          conferenceUrl: null,
        }],
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: 'Unexpected calendar test request' } });
  });
  await page.goto(`${harnessPath}${query}`);
  await expect(page.getByTestId('text-test-account')).toHaveText('account-a');
}

async function createGoal(page, title) {
  await page.getByTestId('button-create-goal').click();
  await page.getByTestId('input-release-two-title').fill(title);
  await page.getByTestId('input-release-two-description').fill('A browser-tested direction.');
  await page.getByTestId('button-save-release-two').click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

test('creates, edits, archives, links, repairs, and opens Release 2 records', async ({ page }) => {
  await preparePlanner(page);
  await createGoal(page, 'Build a calmer week');
  const goalId = 'e2e-1';
  await page.getByTestId(`button-edit-goal-${goalId}`).click();
  await page.getByTestId('input-release-two-title').fill('Build a calmer, clearer week');
  await page.getByTestId('button-save-release-two').click();
  await expect(page.getByTestId(`text-goal-title-${goalId}`)).toHaveText('Build a calmer, clearer week');

  await page.getByTestId(`button-add-milestone-${goalId}`).click();
  await page.getByTestId('input-release-two-title').fill('Protect a quiet morning');
  await page.getByTestId('button-save-release-two').click();
  await expect(page.getByText('Protect a quiet morning', { exact: true })).toBeVisible();

  await page.getByTestId(`button-toggle-goal-status-${goalId}`).click();
  await page.getByTestId('tab-goals-archived').click();
  await expect(page.getByTestId(`card-goal-${goalId}`)).toBeVisible();
  await page.getByTestId(`button-toggle-goal-status-${goalId}`).click();
  await page.getByTestId('tab-goals-active').click();

  await page.getByTestId('button-test-section-lifeAreas').click();
  await page.getByTestId(`button-add-link-lifeArea-area-seed`).click();
  await page.getByTestId('select-link-choose-a-record').selectOption(`goal:${goalId}`);
  await page.getByTestId('button-confirm-record-link').click();
  await expect(page.getByTestId(`button-open-linked-goal-${goalId}`)).toBeVisible();
  await page.getByTestId(`button-open-linked-goal-${goalId}`).click();
  await expect(page.getByTestId('status-opened-record')).toHaveText(`goal:${goalId}`);
  await expect(page.getByTestId(`card-goal-${goalId}`)).toBeVisible();

  await page.getByTestId('row-broken-link-link-broken-seed').getByTestId('button-repair-link-link-broken-seed').click();
  await page.getByTestId('select-link-first-record').selectOption(`goal:${goalId}`);
  await page.getByTestId('select-link-second-record').selectOption('task:task-seed');
  await page.getByTestId('button-save-repaired-link').click();
  await expect(page.getByTestId('list-broken-links')).toHaveCount(0);
});

test('Reviews and local Search continue to work after reload and switching signed-in accounts', async ({ page }) => {
  await preparePlanner(page);
  await page.getByTestId('button-test-section-reviews').click();
  await page.getByTestId('button-create-review').click();
  const reviewInput = page.getByTestId('input-review-reflection-e2e-1');
  await reviewInput.fill('I made space for the important work.');
  await reviewInput.blur();
  await expect(page.getByTestId('text-test-snapshot')).toContainText('I made space for the important work.');
  await page.reload();
  await page.getByTestId('button-test-section-reviews').click();
  await expect(page.getByTestId('row-review-e2e-1')).toContainText('I made space for the important work.');

  await page.getByTestId('button-test-section-search').click();
  await page.getByTestId('input-planner-search').fill('thoughtful launch');
  await expect(page.getByTestId('search-result-task-task-seed')).toBeVisible();
  await page.getByTestId('button-open-search-result-task-task-seed').click();
  await expect(page.getByTestId('status-opened-record')).toHaveText('task:task-seed');

  await page.getByTestId('button-test-switch-account').click();
  await expect(page.getByTestId('text-test-account')).toHaveText('account-b');
  await page.getByTestId('button-test-section-reviews').click();
  await expect(page.getByText('I made space for the important work.')).toHaveCount(0);
  await page.getByTestId('button-create-review').click();
  await page.getByTestId('input-review-reflection-e2e-1').fill('A fresh reflection for this account.');
  await page.getByTestId('input-review-reflection-e2e-1').blur();
  await page.getByTestId('button-test-section-search').click();
  await page.getByTestId('input-planner-search').fill('Second account planning');
  await expect(page.getByTestId('search-result-task-task-b')).toBeVisible();
  await page.reload();
  await page.getByTestId('button-test-section-reviews').click();
  await expect(page.getByTestId('row-review-e2e-1')).toContainText('A fresh reflection for this account.');
});

test('JSON backup import/export and version restore preserve optional Release 2 and unknown fields', async ({ page }) => {
  await preparePlanner(page);
  await page.getByTestId('button-test-save-version').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-test-export-backup').click();
  const download = await downloadPromise;
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
  assert.equal(exported.goals[0].unknownGoalField.retain, 'goal-extension');
  assert.equal(exported.links[0].unknownLinkField, 'link-extension');
  assert.equal(exported.unknownFutureField.retained, 'future-extension');
  assert.equal(exported.reviews.length, 0);

  const replacement = {
    settings: { theme: 'light', accentHex: '#3b765e' },
    tasks: [],
    notes: [],
    goals: [{ id: 'goal-imported', title: 'Imported goal', status: 'active', futureGoalField: { keep: true } }],
    milestones: [{ id: 'milestone-imported', goalId: 'goal-imported', title: 'Imported marker', status: 'active' }],
    lifeAreas: [{ id: 'area-imported', title: 'Imported area', status: 'active' }],
    links: [],
    reviews: [{ id: 'review-imported', period: 'month', startDate: '2026-10-01', endDate: '2026-10-31', reflection: 'Imported reflection', createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z' }],
    schemaVersion: 2,
    futureSnapshotField: { preserve: 'yes' },
  };
  await page.getByTestId('input-test-import-backup').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await expect(page.getByTestId('text-test-snapshot')).toContainText('futureSnapshotField');
  await expect(page.getByTestId('text-test-snapshot')).toContainText('Imported reflection');
  await expect(page.getByTestId('text-test-snapshot')).toContainText('"keep": true');

  await page.getByTestId('select-test-version').selectOption('0');
  await page.getByTestId('button-test-restore-version').click();
  const restored = JSON.parse(await page.getByTestId('text-test-snapshot').textContent());
  assert.equal(restored.goals[0].unknownGoalField.retain, 'goal-extension');
  assert.equal(restored.unknownFutureField.retained, 'future-extension');
  assert.equal(restored.goals.some((goal) => goal.id === 'goal-imported'), false);
});

test('authorized calendar events appear in Timeline but never enter the planner snapshot', async ({ page }) => {
  await preparePlanner(page);
  await page.getByTestId('button-test-section-timeline').click();
  await expect(page.getByTestId('calendar-event-selected-calendar-event')).toContainText('Authorized selected-calendar event');
  await expect(page.getByTestId('status-google-calendar')).toContainText('not copied into your planner');
  const snapshot = JSON.parse(await page.getByTestId('text-test-snapshot').textContent());
  assert.equal(JSON.stringify(snapshot).includes('Authorized selected-calendar event'), false);
  assert.equal(JSON.stringify(snapshot).includes('selected-calendar-event'), false);
});

test('disabled Release 2 routes show a clear state and leave saved data unchanged', async ({ page }) => {
  await preparePlanner(page, '?disabled=true');
  const original = await page.getByTestId('text-test-snapshot').textContent();
  for (const section of ['goals', 'lifeAreas', 'timeline', 'reviews', 'search']) {
    await page.getByTestId(`button-test-section-${section}`).click();
    await expect(page.getByRole('status')).toContainText('This Release 2 area is not enabled');
    await expect(page.getByText('Your planner data remains unchanged.')).toBeVisible();
  }
  expect(await page.getByTestId('text-test-snapshot').textContent()).toBe(original);
});
