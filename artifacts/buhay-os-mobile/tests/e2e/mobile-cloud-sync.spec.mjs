import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { decryptPlannerPayload, derivePlannerKey, encryptPlannerData } from '../../lib/crypto.ts';
import { test, expect } from '@playwright/test';

const apiBaseUrl = process.env.E2E_API_BASE_URL;
const plannerPassphrase = process.env.E2E_PLANNER_PASSPHRASE;

function plannerStateUrl() {
  return new URL('/api/planner/state', apiBaseUrl).toString();
}

async function apiState(request, token) {
  const response = await request.get(plannerStateUrl(), {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status(), 200, 'The authenticated planner state request should succeed.');
  return response.json();
}

async function saveApiState(request, token, expectedRevision, payload) {
  return request.put(plannerStateUrl(), {
    headers: { authorization: `Bearer ${token}` },
    data: { expectedRevision, payload },
  });
}

async function signIn(page, email, password) {
  await page.goto('/');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('planner-unlock')).toBeVisible({ timeout: 90_000 });
}

async function unlockPlanner(page) {
  const passphraseField = page.getByTestId('planner-passphrase');
  await expect(passphraseField).toBeVisible();
  await passphraseField.fill(plannerPassphrase);
  const confirmation = page.getByTestId('planner-passphrase-confirm');
  if (await confirmation.count()) await confirmation.fill(plannerPassphrase);
  await page.getByTestId('planner-unlock').click();
  await expect(page.getByTestId('today-capture-button')).toBeVisible({ timeout: 30_000 });
}

async function captureTask(page, title) {
  await page.getByTestId('today-capture-button').click();
  await page.getByTestId('capture-title').fill(title);
  await page.getByTestId('capture-save').click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function cleanTestTasks(request, token, marker) {
  const state = await apiState(request, token);
  if (!state.payload) return;
  const data = decryptPlannerPayload(state.payload, plannerPassphrase);
  const tasks = data.tasks ?? [];
  const remaining = tasks.filter((task) => !task.title.includes(marker));
  if (remaining.length === tasks.length) return;

  const cleaned = { ...data, tasks: remaining };
  const salt = Buffer.from(state.payload.salt, 'base64');
  const key = derivePlannerKey(plannerPassphrase, salt);
  const payload = encryptPlannerData(cleaned, key, salt, randomBytes(12));
  const response = await saveApiState(request, token, state.revision, payload);
  assert.equal(response.status(), 200, 'Test-created tasks should be removed from the disposable account.');
  const verified = await apiState(request, token);
  assert.equal(
    JSON.stringify(decryptPlannerPayload(verified.payload, plannerPassphrase)).includes(marker),
    false,
    'The cleaned cloud snapshot should not retain this run’s unique test task.',
  );
}

test('signs in, syncs encrypted mobile edits, merges an offline revision conflict, and isolates accounts', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const marker = `E2E mobile sync ${randomUUID()}`;
  const offlineTitle = `${marker} — offline edit`;
  const remoteTitle = `${marker} — concurrent cloud edit`;
  const contexts = [];
  let primaryToken;
  let primaryPlannerUnlocked = false;
  let conflictReturned = false;

  try {
    const primaryContext = await browser.newContext();
    contexts.push(primaryContext);
    const page = await primaryContext.newPage();
    page.on('request', (apiRequest) => {
      if (new URL(apiRequest.url()).pathname !== '/api/planner/state') return;
      void apiRequest.allHeaders().then((headers) => {
        const value = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (value) {
          primaryToken = value;
        }
      });
    });

    await signIn(page, process.env.E2E_USER_EMAIL, process.env.E2E_USER_PASSWORD);
    await expect.poll(() => primaryToken, { timeout: 30_000 }).toBeTruthy();
    await unlockPlanner(page);
    primaryPlannerUnlocked = true;

    await captureTask(page, marker);
    await expect.poll(async () => {
      const state = await apiState(request, primaryToken);
      return state.payload ? state.revision : 0;
    }, { timeout: 30_000 }).toBeGreaterThan(0);
    const originalApiState = await apiState(request, primaryToken);
    assert.ok(originalApiState.payload, 'The task should persist as an encrypted cloud snapshot.');
    assert.equal(JSON.stringify(originalApiState.payload).includes(marker), false);
    assert.equal(originalApiState.payload.cryptoVersion, 1);
    assert.equal(originalApiState.payload.kdf, 'PBKDF2-SHA256');

    // Reload the Expo web app to model an app restart. Unlocking must restore the task.
    await page.reload();
    await expect(page.getByTestId('planner-unlock')).toBeVisible({ timeout: 45_000 });
    await unlockPlanner(page);
    await expect(page.getByText(marker, { exact: true })).toBeVisible();

    const accountStateBeforeOfflineEdit = await apiState(request, primaryToken);
    const accountDataBeforeOfflineEdit = decryptPlannerPayload(
      accountStateBeforeOfflineEdit.payload,
      plannerPassphrase,
    );
    const testTask = (accountDataBeforeOfflineEdit.tasks ?? []).find(
      (task) => task.title === marker,
    );
    assert.ok(testTask, 'The encrypted API snapshot should decrypt to the UI-created task.');

    await primaryContext.setOffline(true);
    await page.getByRole('button', { name: `Edit task: ${marker}` }).click();
    await page.getByTestId('capture-title').fill(offlineTitle);
    await page.getByTestId('capture-save').click();
    await expect(page.getByText(offlineTitle, { exact: true })).toBeVisible();
    await expect.poll(async () => page.evaluate((marker) => {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith('buhay.os.encrypted-cache.v1:')) continue;
        const serialized = localStorage.getItem(key) ?? '';
        const record = JSON.parse(serialized || 'null');
        return Boolean(
          record?.payload?.cryptoVersion === 1
          && record?.payload?.ciphertext
          && !serialized.includes(marker),
        );
      }
      return false;
    }, offlineTitle)).toBe(true);

    // A second device writes a colliding edit while the mobile browser is offline.
    const remoteData = structuredClone(accountDataBeforeOfflineEdit);
    remoteData.tasks = (remoteData.tasks ?? []).map((task) =>
      task.id === testTask.id ? { ...task, title: remoteTitle } : task,
    );
    const salt = Buffer.from(accountStateBeforeOfflineEdit.payload.salt, 'base64');
    const key = derivePlannerKey(plannerPassphrase, salt);
    const remotePayload = encryptPlannerData(remoteData, key, salt, randomBytes(12));
    const remoteSave = await saveApiState(
      request,
      primaryToken,
      accountStateBeforeOfflineEdit.revision,
      remotePayload,
    );
    assert.equal(remoteSave.status(), 200, 'The simulated concurrent device should advance the revision.');

    // Reload before reconnecting to model closing and reopening the app offline.
    // Unlock must use the locally encrypted cache, then queue the edit for recovery.
    await page.reload();
    await expect(page.getByTestId('planner-unlock')).toBeVisible({ timeout: 45_000 });
    await unlockPlanner(page);
    await expect(page.getByText(offlineTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(remoteTitle, { exact: true })).toHaveCount(0);

    const whileOffline = await apiState(request, primaryToken);
    assert.equal(whileOffline.revision, accountStateBeforeOfflineEdit.revision + 1);
    assert.equal(JSON.stringify(whileOffline.payload).includes(offlineTitle), false);
    assert.equal(
      decryptPlannerPayload(whileOffline.payload, plannerPassphrase).tasks
        .some((task) => task.title === remoteTitle),
      true,
    );

    // Hold API reads at the old revision until the mobile app receives a genuine 409.
    await primaryContext.route(/\/api\/planner\/state(?:\?.*)?$/, async (route) => {
      const routeRequest = route.request();
      if (
        routeRequest.method() === 'GET' &&
        !conflictReturned
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(accountStateBeforeOfflineEdit),
        });
        return;
      }
      if (routeRequest.method() === 'PUT') {
        const response = await route.fetch();
        if (response.status() === 409) conflictReturned = true;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    await primaryContext.setOffline(false);
    await expect.poll(() => conflictReturned, { timeout: 60_000 }).toBe(true);
    await expect(page.getByText(remoteTitle, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`Conflict copy — ${offlineTitle}`, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const mergedState = await apiState(request, primaryToken);
    const mergedData = decryptPlannerPayload(mergedState.payload, plannerPassphrase);
    assert.ok(mergedData.tasks.some((task) => task.title === remoteTitle));
    assert.ok(mergedData.tasks.some((task) => task.title === `Conflict copy — ${offlineTitle}`));
    for (const secretText of [marker, offlineTitle, remoteTitle]) {
      assert.equal(JSON.stringify(mergedState.payload).includes(secretText), false);
    }

    const versionsResponse = await request.get(new URL('/api/planner/versions', apiBaseUrl).toString(), {
      headers: { authorization: `Bearer ${primaryToken}` },
    });
    assert.equal(versionsResponse.status(), 200);
    const versions = await versionsResponse.json();
    for (const version of versions) {
      const response = await request.get(
        new URL(`/api/planner/versions/${version.revision}`, apiBaseUrl).toString(),
        { headers: { authorization: `Bearer ${primaryToken}` } },
      );
      assert.equal(response.status(), 200);
      const versionBody = await response.json();
      for (const secretText of [marker, offlineTitle, remoteTitle]) {
        assert.equal(JSON.stringify(versionBody.payload).includes(secretText), false);
      }
    }

    // A separate Clerk user must see its own empty planner, never the first account’s item.
    const secondaryContext = await browser.newContext();
    contexts.push(secondaryContext);
    const secondaryPage = await secondaryContext.newPage();
    let secondaryToken;
    secondaryPage.on('request', (apiRequest) => {
      if (new URL(apiRequest.url()).pathname !== '/api/planner/state') return;
      void apiRequest.allHeaders().then((headers) => {
        secondaryToken ??= headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      });
    });
    await signIn(
      secondaryPage,
      process.env.E2E_SECOND_USER_EMAIL,
      process.env.E2E_SECOND_USER_PASSWORD,
    );
    await expect.poll(() => secondaryToken, { timeout: 30_000 }).toBeTruthy();
    await expect(secondaryPage.getByText('Set up encryption', { exact: true })).toBeVisible();
    const secondaryState = await apiState(request, secondaryToken);
    assert.equal(secondaryState.exists, false);
    assert.equal(secondaryState.payload, null);
    await expect(secondaryPage.getByText(marker, { exact: true })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (primaryPlannerUnlocked && primaryToken) {
      await cleanTestTasks(request, primaryToken, marker);
    }
  }
});
