import { test, expect } from '@playwright/test';

const harness = '/tests/e2e/journal-harness.html';

const snapshot = async (page) => JSON.parse(await page.getByTestId('snapshot').textContent());
const entries = (snap) => (snap.journalEntries ?? []).filter((e) => !('deletedAt' in e));

async function begin(page, query = '') {
  await page.goto(`${harness}${query}`);
  await expect(page.getByTestId('page-journal')).toBeVisible();
}

async function startToday(page) {
  await begin(page);
  await page.getByTestId('button-start-journal').click();
  await expect(page.getByTestId('journal-day-counter')).toHaveText('Day 1 of 365');
}

test('starting a journal shows Day 1, its question and a Today card', async ({ page }) => {
  await startToday(page);
  await expect(page.getByTestId('journal-day-title')).toContainText('Day 001');
  await expect(page.getByTestId('journal-question')).not.toBeEmpty();
  await expect(page.getByTestId('widget-today-journal')).toBeVisible();
  await expect(page.getByTestId('link-today-open-journal')).toHaveText(/Write today’s page/);
  const snap = await snapshot(page);
  expect(snap.journalCollections).toHaveLength(1);
  expect(entries(snap)).toHaveLength(0);
});

test('writing and saving keeps the text, the mood and the day number', async ({ page }) => {
  await begin(page, '?daysAgo=41');
  await expect(page.getByTestId('journal-day-title')).toContainText('Day 042');
  await page.getByTestId('textarea-journal-today').fill('A calm day at the studio');
  await page.getByTestId('textarea-journal-answer').fill('The light in the morning');
  await page.getByTestId('select-journal-mood').selectOption('Peaceful');
  await page.getByTestId('button-journal-save').click();
  await expect(page.getByTestId('toast')).toHaveText('Journal saved');
  const [entry] = entries(await snapshot(page));
  expect(entry.dayNumber).toBe(42);
  expect(entry.todayInMyLife).toBe('A calm day at the studio');
  expect(entry.promptResponse).toBe('The light in the morning');
  expect(entry.mood).toEqual({ label: 'Peaceful' });
  expect(entry.modality).toBe('digital');
  await expect(page.getByTestId('link-today-open-journal')).toHaveText(/Open journal/);
});

test('saving nothing explains what to do and writes nothing', async ({ page }) => {
  await begin(page, '?daysAgo=3');
  await page.getByTestId('button-journal-save').click();
  await expect(page.getByTestId('journal-error')).toContainText('Write something');
  expect(entries(await snapshot(page))).toHaveLength(0);
});

test('a paper-only day records handwriting and adds no text', async ({ page }) => {
  await begin(page, '?daysAgo=5');
  await page.getByTestId('checkbox-journal-paper').check();
  await page.getByTestId('button-journal-save').click();
  const [entry] = entries(await snapshot(page));
  expect(entry.modality).toBe('handwritten');
  for (const field of ['todayInMyLife', 'promptResponse', 'smallMoment', 'tomorrowThought', 'body', 'title']) expect(entry[field]).toBeUndefined();
});

test('moving to another day saves what was typed, and it is there when you come back', async ({ page }) => {
  await begin(page, '?daysAgo=10');
  await page.getByTestId('textarea-journal-small').fill('Coffee with a friend');
  await page.getByTestId('button-journal-previous').click();
  await expect(page.getByTestId('journal-day-title')).toContainText('Day 010');
  await page.getByTestId('button-journal-next').click();
  await expect(page.getByTestId('journal-day-title')).toContainText('Day 011');
  await expect(page.getByTestId('textarea-journal-small')).toHaveValue('Coffee with a friend');
  await expect(page.getByTestId('button-journal-next')).toBeDisabled();
});

test('editing keeps the earlier wording as a recoverable copy', async ({ page }) => {
  await begin(page, '?daysAgo=2');
  await page.getByTestId('textarea-journal-today').fill('First wording');
  await page.getByTestId('button-journal-save').click();
  await page.getByTestId('textarea-journal-today').fill('Second wording');
  await page.getByTestId('button-journal-save').click();
  const [entry] = entries(await snapshot(page));
  expect(entry.todayInMyLife).toBe('Second wording');
  expect(entry.revisions.map((r) => r.todayInMyLife)).toEqual(['First wording']);
});

test('deleting asks first, can be cancelled with Escape, and then erases the text for good', async ({ page }) => {
  await begin(page, '?daysAgo=4');
  await page.getByTestId('textarea-journal-today').fill('SECRET-JOURNAL-TEXT');
  await page.getByTestId('button-journal-save').click();
  await page.getByTestId('button-journal-delete').click();
  await expect(page.getByTestId('dialog-delete-journal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-delete-journal')).toHaveCount(0);
  expect(entries(await snapshot(page))).toHaveLength(1);
  await page.getByTestId('button-journal-delete').click();
  await page.getByTestId('button-confirm-delete-journal').click();
  await expect(page.getByTestId('dialog-delete-journal')).toHaveCount(0);
  const snap = await snapshot(page);
  expect(entries(snap)).toHaveLength(0);
  expect(JSON.stringify(snap)).not.toContain('SECRET-JOURNAL-TEXT');
  expect(snap.journalEntries).toHaveLength(1);
  expect(Object.keys(snap.journalEntries[0]).sort()).toEqual(['deletedAt', 'id']);
});

test('every field has a label, the arrows have names, and progress is announced', async ({ page }) => {
  await begin(page, '?daysAgo=6');
  for (const label of ['Today’s mood', 'Today in my life', 'A little thing worth remembering', 'One thought before tomorrow', 'Your answer']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Previous day' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: /day 7 of 365/i })).toBeVisible();
});
