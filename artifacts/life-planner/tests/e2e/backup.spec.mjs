import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const harness = '/tests/e2e/backup-harness.html';
const PASSWORD = 'correct horse battery staple';

const snapshot = async (page) => JSON.parse(await page.getByTestId('snapshot').textContent());
const liveText = (snap) => (snap.memories ?? []).filter((m) => !('deletedAt' in m)).map((m) => m.text);

async function open(page) {
  await page.goto(harness);
  await expect(page.getByTestId('button-export-backup')).toBeVisible();
}

async function exportBackup(page, password = PASSWORD) {
  await page.getByTestId('button-export-backup').click();
  await page.getByTestId('input-backup-password').fill(password);
  await page.getByTestId('input-backup-password-confirm').fill(password);
  const download = page.waitForEvent('download');
  await page.getByTestId('button-backup-password-submit').click();
  const file = await download;
  const text = await readFile(await file.path(), 'utf8');
  await expect(page.getByTestId('dialog-backup-password')).toHaveCount(0);
  return text;
}

const importText = (page, text, name = 'backup.buhaybackup') =>
  page.getByTestId('input-import-backup').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

test('an exported backup is encrypted: no memory text, no plaintext fields, versioned format', async ({ page }) => {
  await open(page);
  const text = await exportBackup(page);
  expect(text).not.toContain('KEEP-ME-TEXT');
  expect(text).not.toContain('DELETE-ME-TEXT');
  expect(text).not.toContain('Pack boxes');
  expect(text).not.toContain(PASSWORD);
  const file = JSON.parse(text);
  expect(file).toMatchObject({ format: 'buhay-os-encrypted-backup', version: 1, kdf: { name: 'PBKDF2-SHA256' }, cipher: { name: 'AES-256-GCM' } });
  expect(Object.keys(file).sort()).toEqual(['cipher', 'ciphertext', 'format', 'kdf', 'version']);
});

test('export asks for a long enough password, twice, and creates nothing until it is right', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-export-backup').click();
  const submit = page.getByTestId('button-backup-password-submit');
  await page.getByTestId('input-backup-password').fill('short');
  await page.getByTestId('input-backup-password-confirm').fill('short');
  await submit.click();
  await expect(page.getByTestId('text-backup-password-error')).toContainText('at least 12 characters');
  await page.getByTestId('input-backup-password').fill(PASSWORD);
  await page.getByTestId('input-backup-password-confirm').fill(PASSWORD + 'x');
  await submit.click();
  await expect(page.getByTestId('text-backup-password-error')).toContainText('do not match');
  await expect(page.getByTestId('status-message')).toHaveText('');
});

test('the password dialog is labelled for screen readers, keyboard-operable, and the password is hidden', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-export-backup').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/password/i);
  const password = page.getByLabel('Backup password');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.getByLabel('Confirm password')).toHaveAttribute('type', 'password');
  await expect(password).toBeFocused();
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-message')).toContainText('encrypted backup is ready');
  // Errors are announced.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('button-export-backup').click();
  await page.getByTestId('input-backup-password').fill('x');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'at least 12' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a wrong password cannot restore, and leaves the planner exactly as it was', async ({ page }) => {
  await open(page);
  const text = await exportBackup(page);
  const before = await page.getByTestId('snapshot').textContent();
  await importText(page, text);
  await page.getByTestId('input-backup-password').fill('totally the wrong password');
  await page.getByTestId('button-backup-password-submit').click();
  await expect(page.getByTestId('text-backup-password-error')).toContainText('password is wrong');
  await expect(page.getByTestId('backup-import-preview')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await page.getByTestId('snapshot').textContent()).toBe(before);
});

test('a tampered file, a damaged file and an unrelated file are rejected without changing anything', async ({ page }) => {
  await open(page);
  const text = await exportBackup(page);
  const before = await page.getByTestId('snapshot').textContent();

  const tampered = JSON.parse(text);
  const bytes = Buffer.from(tampered.ciphertext, 'base64');
  bytes[5] ^= 1;
  tampered.ciphertext = bytes.toString('base64');
  await importText(page, JSON.stringify(tampered));
  await page.getByTestId('input-backup-password').fill(PASSWORD);
  await page.getByTestId('button-backup-password-submit').click();
  await expect(page.getByTestId('text-backup-password-error')).toContainText('wrong, or the file has been changed');
  await page.keyboard.press('Escape');

  await importText(page, text.slice(0, text.length - 40));
  await expect(page.getByTestId('status-message')).toContainText('not a valid HANAY backup');
  await importText(page, '{"hello":"world"}');
  await expect(page.getByTestId('status-message')).toContainText('not a valid HANAY backup');
  expect(await page.getByTestId('snapshot').textContent()).toBe(before);
});

test('an older plaintext JSON backup is refused, not imported and not asked for a password', async ({ page }) => {
  await open(page);
  const before = await page.getByTestId('snapshot').textContent();
  await importText(page, JSON.stringify({ tasks: [], notes: [], settings: {} }), 'old.json');
  await expect(page.getByTestId('status-message')).toContainText('unencrypted backup');
  await expect(page.getByTestId('status-message')).toContainText('nothing was changed');
  await expect(page.getByTestId('dialog-backup-password')).toHaveCount(0);
  await expect(page.getByTestId('input-backup-password')).toHaveCount(0);
  expect(await page.getByTestId('snapshot').textContent()).toBe(before);
});

test('restoring a stale backup replaces the planner but cannot bring back a deleted memory', async ({ page }) => {
  await open(page);
  const text = await exportBackup(page); // made while both memories existed
  await page.getByTestId('button-delete-memory').click();
  expect(liveText(await snapshot(page))).toEqual(['KEEP-ME-TEXT']);

  await importText(page, text);
  await page.getByTestId('input-backup-password').fill(PASSWORD);
  await page.getByTestId('button-backup-password-submit').click();
  await expect(page.getByTestId('backup-import-preview')).toBeVisible();
  await page.getByTestId('button-confirm-backup-import').click();
  await expect(page.getByTestId('status-message')).toHaveText('Backup restored.');

  const after = await snapshot(page);
  expect(liveText(after)).toEqual(['KEEP-ME-TEXT']);
  expect(JSON.stringify(after)).not.toContain('DELETE-ME-TEXT');
  expect(after.memories.find((m) => m.id === 'gone')).toEqual({ id: 'gone', deletedAt: '2026-11-01T00:00:00.000Z' });
  expect(after.tasks[0].title).toBe('Pack boxes');
});

test('the password is never kept: closing the dialog clears it', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-export-backup').click();
  await page.getByTestId('input-backup-password').fill(PASSWORD);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('button-export-backup').click();
  await expect(page.getByTestId('input-backup-password')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toContain('correct horse');
});
