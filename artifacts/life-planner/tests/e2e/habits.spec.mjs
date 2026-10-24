import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test, expect } from '@playwright/test';

const passphrase = process.env.E2E_PLANNER_PASSPHRASE;

async function decryptSnapshot(payload) {
  const material = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: Buffer.from(payload.salt, 'base64'),
      iterations: 310_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(payload.iv, 'base64') },
    key,
    Buffer.from(payload.ciphertext, 'base64'),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function signIn(page) {
  await page.goto('/sign-in');
  const identifier = page.locator('input[name="identifier"]');
  await expect(identifier).toBeVisible();
  await identifier.fill(process.env.E2E_USER_EMAIL);
  await page.getByRole('button', { name: /continue/i }).click();
  const password = page.locator('input[name="password"]');
  await expect(password).toBeVisible();
  await password.fill(process.env.E2E_USER_PASSWORD);
  await page.getByRole('button', { name: /continue|sign in/i }).click();
  await expect(page.getByTestId('input-encryption-passphrase')).toBeVisible({ timeout: 60_000 });
}

async function createHabit(page, { title, measurable = false }) {
  await page.getByTestId('button-create-habits').click();
  await page.getByTestId('input-habit-title').fill(title);
  await page.getByTestId('input-habit-description').fill('A browser-tested habit.');
  if (measurable) {
    await page.getByTestId('button-habit-type-measurable').click();
    await page.getByTestId('input-habit-goal').fill('4');
    await page.getByTestId('input-habit-unit').fill('pages');
  }
  await page.getByTestId('button-save-habit').click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  const card = page.locator('[data-testid^="card-habit-"]').filter({ hasText: title });
  const testId = await card.getAttribute('data-testid');
  assert.ok(testId, `Expected a rendered habit card for ${title}`);
  return { card, id: testId.slice('card-habit-'.length) };
}

test('signed-in web user creates and edits binary and measurable habits and syncs only ciphertext', async ({ page }) => {
  test.setTimeout(120_000);
  const marker = `Habit web E2E ${Date.now()}`;
  let revision = 0;
  let savedPayload = null;
  const payloadWrites = [];

  await page.addInitScript(() => {
    localStorage.removeItem('daybook.local.v1');
    localStorage.removeItem('daybook.encrypted-cache.v1');
  });
  await page.route('**/api/planner/state', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: { exists: revision > 0, revision, updatedAt: null, payload: savedPayload },
      });
      return;
    }
    assert.equal(route.request().method(), 'PUT');
    const body = route.request().postDataJSON();
    assert.deepEqual(Object.keys(body).sort(), ['expectedRevision', 'payload']);
    assert.deepEqual(Object.keys(body.payload).sort(), ['ciphertext', 'cryptoVersion', 'iv', 'kdf', 'salt']);
    assert.equal(body.payload.cryptoVersion, 1);
    assert.equal(body.payload.kdf, 'PBKDF2-SHA256');
    payloadWrites.push(body);
    revision += 1;
    savedPayload = body.payload;
    await route.fulfill({
      json: { revision, updatedAt: new Date().toISOString(), payload: savedPayload },
    });
  });
  await page.route('**/api/planner/versions**', (route) => route.fulfill({ json: [] }));

  await signIn(page);
  await page.getByTestId('input-encryption-passphrase').fill(passphrase);
  await page.getByTestId('input-encryption-passphrase-confirm').fill(passphrase);
  await page.getByRole('button', { name: /set up and continue/i }).click();
  await expect(page.getByRole('link', { name: 'Habits', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Habits', exact: true }).click();

  const binaryTitle = `${marker} binary`;
  const binary = await createHabit(page, { title: binaryTitle });
  await binary.card.getByRole('button', { name: `Edit ${binaryTitle}` }).click();
  await page.getByTestId('input-habit-title').fill(`${binaryTitle} edited`);
  await page.getByTestId('button-save-habit').click();
  await expect(page.getByText(`${binaryTitle} edited`, { exact: true })).toBeVisible();

  const measurableTitle = `${marker} measurable`;
  const measurable = await createHabit(page, { title: measurableTitle, measurable: true });
  await measurable.card.getByRole('button', { name: `Edit ${measurableTitle}` }).click();
  await page.getByTestId('input-habit-title').fill(`${measurableTitle} edited`);
  await page.getByTestId('input-habit-goal').fill('6');
  await page.getByTestId('input-habit-unit').fill('minutes');
  await page.getByTestId('button-save-habit').click();
  await expect(page.getByText(`${measurableTitle} edited`, { exact: true })).toBeVisible();

  const binaryCard = page.locator(`[data-testid="card-habit-${binary.id}"]`);
  await binaryCard.getByTestId(`button-toggle-habit-${binary.id}`).click();
  await expect(binaryCard.getByTestId(`button-toggle-habit-${binary.id}`)).toHaveAttribute('aria-pressed', 'true');

  const measurableCard = page.locator(`[data-testid="card-habit-${measurable.id}"]`);
  const progress = measurableCard.getByTestId(`input-habit-progress-${measurable.id}`);
  await progress.fill('3');
  await expect(progress).toHaveValue('3');

  await page.getByTestId('button-habit-history-previous').click();
  await expect(page.getByText('History · 1 week ago')).toBeVisible();
  const earlierSunday = await page.evaluate(() => {
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset - 7, 12);
    monday.setDate(monday.getDate() + 6);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  });
  await binaryCard.getByTestId(`button-habit-history-date-${binary.id}-${earlierSunday}`).click();
  await expect(binaryCard.getByTestId(`selected-habit-date-${binary.id}`)).toContainText(earlierSunday);
  await binaryCard.getByTestId(`button-habit-skip-${binary.id}`).click();
  await expect(binaryCard.getByTestId(`button-habit-skip-${binary.id}`)).toContainText('Undo skip');

  await page.getByTestId('button-habit-history-next').click();
  await binaryCard.getByTestId(`button-habit-pause-${binary.id}`).click();
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await binaryCard.locator('input[type="date"]').first().fill(yesterday);
  await binaryCard.getByTestId(`button-habit-pause-save-${binary.id}`).click();
  await binaryCard.getByTestId(`button-habit-resume-${binary.id}`).click();
  await binaryCard.getByTestId(`button-habit-pause-${binary.id}`).waitFor();

  await expect.poll(async () => {
    if (!savedPayload) return false;
    const data = await decryptSnapshot(savedPayload);
    return data.habits?.some((habit) => habit.title === `${binaryTitle} edited`)
      && data.habits?.some((habit) => habit.title === `${measurableTitle} edited`);
  }).toBe(true);

  assert.ok(payloadWrites.length >= 4, 'Habit edits and check-ins should result in encrypted snapshot saves.');
  const storedText = JSON.stringify(savedPayload);
  assert.equal(storedText.includes(marker), false, 'Habit titles must not appear in the server payload.');
  const saved = await decryptSnapshot(savedPayload);
  const savedBinary = saved.habits.find((habit) => habit.id === binary.id);
  const savedMeasurable = saved.habits.find((habit) => habit.id === measurable.id);
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  assert.ok(savedBinary?.completedDates.includes(today));
  assert.ok(savedBinary?.skipEntries?.some((entry) => entry.date === earlierSunday && entry.skipped));
  assert.ok(savedBinary?.pausedRanges?.some((range) => range.startDate === yesterday && range.endDate === yesterday));
  assert.equal(savedMeasurable?.measurement.goal, 6);
  assert.equal(savedMeasurable?.measurement.unit, 'minutes');
  assert.ok(savedMeasurable?.progressEntries?.some((entry) => entry.value === 3));
});
