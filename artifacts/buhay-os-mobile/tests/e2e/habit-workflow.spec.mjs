import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { decryptPlannerPayload, derivePlannerKey, encryptPlannerData } from '../../lib/crypto.ts';
import { test, expect } from '@playwright/test';

const apiBaseUrl = process.env.E2E_API_BASE_URL;
const plannerPassphrase = process.env.E2E_PLANNER_PASSPHRASE;

function stateUrl() {
  return new URL('/api/planner/state', apiBaseUrl).toString();
}

async function getState(request, token) {
  const response = await request.get(stateUrl(), {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status(), 200, 'The authenticated planner state request should succeed.');
  return response.json();
}

async function saveState(request, token, expectedRevision, payload) {
  return request.put(stateUrl(), {
    headers: { authorization: `Bearer ${token}` },
    data: { expectedRevision, payload },
  });
}

async function signIn(page) {
  await page.goto('/');
  await page.getByTestId('auth-email').fill(process.env.E2E_USER_EMAIL);
  await page.getByTestId('auth-password').fill(process.env.E2E_USER_PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('planner-unlock')).toBeVisible({ timeout: 90_000 });
}

async function unlockPlanner(page) {
  await page.getByTestId('planner-passphrase').fill(plannerPassphrase);
  const confirmation = page.getByTestId('planner-passphrase-confirm');
  if (await confirmation.count()) await confirmation.fill(plannerPassphrase);
  await page.getByTestId('planner-unlock').click();
  await expect(page.getByTestId('today-capture-button')).toBeVisible({ timeout: 30_000 });
}

async function createHabit(page, title, { measurable = false } = {}) {
  const create = page.getByTestId('mobile-habit-create');
  if (await create.count()) await create.click();
  await page.getByTestId('mobile-habit-title').fill(title);
  await page.getByTestId('mobile-habit-description').fill('A mobile-tested habit.');
  if (measurable) {
    await page.getByRole('button', { name: 'Measurable goal', exact: true }).click();
    await page.getByTestId('mobile-habit-goal').fill('4');
    await page.getByTestId('mobile-habit-unit').fill('pages');
  }
  await page.getByTestId('mobile-habit-save').click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

function getHabit(data, title) {
  return (data.habits ?? []).find((habit) => habit.title === title);
}

async function waitForHabit(request, token, title) {
  let current;
  await expect.poll(async () => {
    current = await getState(request, token);
    if (!current.payload) return false;
    return Boolean(getHabit(decryptPlannerPayload(current.payload, plannerPassphrase), title));
  }, { timeout: 45_000 }).toBe(true);
  return getHabit(decryptPlannerPayload(current.payload, plannerPassphrase), title);
}

async function cleanHabitTestData(request, token, marker) {
  const state = await getState(request, token);
  if (!state.payload) return;
  const data = decryptPlannerPayload(state.payload, plannerPassphrase);
  const habits = data.habits ?? [];
  const remaining = habits.filter((habit) => !habit.title.includes(marker));
  if (habits.length === remaining.length) return;
  const cleaned = { ...data, habits: remaining };
  const salt = Buffer.from(state.payload.salt, 'base64');
  const key = derivePlannerKey(plannerPassphrase, salt);
  const payload = encryptPlannerData(cleaned, key, salt, randomBytes(12));
  const response = await saveState(request, token, state.revision, payload);
  assert.equal(response.status(), 200, 'Test-created habits should be removed from the disposable account.');
}

test('signed-in mobile user creates and edits both habit types and syncs only encrypted history', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const marker = `Habit mobile E2E ${randomUUID()}`;
  const binaryTitle = `${marker} binary`;
  const measurableTitle = `${marker} measurable`;
  const contexts = [];
  const payloadWrites = [];
  let token;
  let unlocked = false;

  try {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    page.on('request', (apiRequest) => {
      if (new URL(apiRequest.url()).pathname !== '/api/planner/state' || apiRequest.method() !== 'PUT') return;
      payloadWrites.push(apiRequest.postDataJSON());
      void apiRequest.allHeaders().then((headers) => {
        token ??= headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      });
    });
    page.on('request', (apiRequest) => {
      if (new URL(apiRequest.url()).pathname !== '/api/planner/state') return;
      void apiRequest.allHeaders().then((headers) => {
        token ??= headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      });
    });

    await signIn(page);
    await expect.poll(() => token, { timeout: 30_000 }).toBeTruthy();
    await unlockPlanner(page);
    unlocked = true;
    await page.getByRole('tab', { name: 'Space' }).click();
    await page.getByRole('tab', { name: 'Habits section' }).click();

    await createHabit(page, binaryTitle);
    await waitForHabit(request, token, binaryTitle);
    await page.getByRole('button', { name: `Edit ${binaryTitle}` }).click();
    await page.getByTestId('mobile-habit-title').fill(`${binaryTitle} edited`);
    await page.getByTestId('mobile-habit-save').click();
    await expect(page.getByText(`${binaryTitle} edited`, { exact: true })).toBeVisible();
    const binary = await waitForHabit(request, token, `${binaryTitle} edited`);

    await createHabit(page, measurableTitle, { measurable: true });
    await waitForHabit(request, token, measurableTitle);
    await page.getByRole('button', { name: `Edit ${measurableTitle}` }).click();
    await page.getByTestId('mobile-habit-title').fill(`${measurableTitle} edited`);
    await page.getByTestId('mobile-habit-goal').fill('6');
    await page.getByTestId('mobile-habit-unit').fill('minutes');
    await page.getByTestId('mobile-habit-save').click();
    await expect(page.getByText(`${measurableTitle} edited`, { exact: true })).toBeVisible();
    const measurable = await waitForHabit(request, token, `${measurableTitle} edited`);

    const currentDate = await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    await page.getByTestId(`mobile-toggle-habit-${binary.id}`).click();
    await expect(page.getByText('Kept today', { exact: true })).toBeVisible();

    const progress = page.getByTestId(`mobile-habit-progress-${measurable.id}`);
    await progress.fill('3');
    await expect(progress).toHaveValue('3');

    await page.getByTestId('mobile-habit-history-previous').click();
    await expect(page.getByText('History · 1 week ago')).toBeVisible();
    const earlierSunday = await page.evaluate(() => {
      const date = new Date();
      const mondayOffset = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - mondayOffset - 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    await page.getByTestId(`mobile-habit-history-date-${binary.id}-${earlierSunday}`).click();
    await expect(page.getByTestId(`mobile-selected-habit-date-${binary.id}`)).toContainText(earlierSunday);
    await page.getByTestId(`mobile-habit-skip-${binary.id}`).click();
    await expect(page.getByText(`${earlierSunday} · Skipped`, { exact: true })).toBeVisible();

    await page.getByTestId('mobile-habit-history-next').click();
    await page.getByTestId(`mobile-habit-pause-${binary.id}`).click();
    const yesterday = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    await page.getByTestId(`mobile-habit-pause-start-${binary.id}`).fill(yesterday);
    await page.getByTestId(`mobile-habit-pause-save-${binary.id}`).click();
    await page.getByTestId(`mobile-habit-resume-${binary.id}`).click();
    await page.getByTestId(`mobile-habit-pause-${binary.id}`).waitFor();

    await expect.poll(async () => {
      const state = await getState(request, token);
      if (!state.payload) return false;
      const data = decryptPlannerPayload(state.payload, plannerPassphrase);
      return Boolean(
        getHabit(data, `${binaryTitle} edited`)?.completedDates.includes(currentDate)
        && getHabit(data, `${measurableTitle} edited`)?.progressEntries?.some((entry) => entry.value === 3)
        && getHabit(data, `${binaryTitle} edited`)?.pausedRanges?.some((range) => range.startDate === yesterday && range.endDate === yesterday),
      );
    }, { timeout: 45_000 }).toBe(true);

    const finalState = await getState(request, token);
    assert.ok(finalState.payload, 'Habit changes should be saved in the encrypted planner snapshot.');
    assert.ok(payloadWrites.length >= 4, 'Habit changes should send encrypted planner saves.');
    for (const body of payloadWrites) {
      assert.deepEqual(Object.keys(body).sort(), ['expectedRevision', 'payload']);
      assert.deepEqual(Object.keys(body.payload).sort(), ['ciphertext', 'cryptoVersion', 'iv', 'kdf', 'salt']);
      assert.equal(body.payload.cryptoVersion, 1);
      assert.equal(body.payload.kdf, 'PBKDF2-SHA256');
    }
    assert.equal(JSON.stringify(finalState.payload).includes(marker), false);

    const saved = decryptPlannerPayload(finalState.payload, plannerPassphrase);
    const savedBinary = getHabit(saved, `${binaryTitle} edited`);
    const savedMeasurable = getHabit(saved, `${measurableTitle} edited`);
    assert.ok(savedBinary?.completedDates.includes(currentDate));
    assert.ok(savedBinary?.skipEntries?.some((entry) => entry.date === earlierSunday && entry.skipped));
    assert.ok(savedBinary?.pausedRanges?.some((range) => range.startDate === yesterday && range.endDate === yesterday));
    assert.equal(savedMeasurable?.measurement.goal, 6);
    assert.equal(savedMeasurable?.measurement.unit, 'minutes');
    assert.ok(savedMeasurable?.progressEntries?.some((entry) => entry.value === 3));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (unlocked && token) await cleanHabitTestData(request, token, marker);
  }
});
