import { test, expect } from '@playwright/test';

const harness = '/tests/e2e/tuklas-harness.html';
const snapshot = async (page) => JSON.parse(await page.getByTestId('snapshot').textContent());
const live = (snap) => (snap.financeEntries ?? []).filter((e) => !('deletedAt' in e));

async function open(page, query = '') {
  // A fixed day keeps "due in 3 days" and "this month" from drifting with the real calendar.
  await page.clock.install({ time: new Date('2026-11-10T12:00:00') });
  await page.goto(`${harness}${query}`);
  await expect(page.getByTestId('page-tuklas')).toBeVisible();
}

async function addCommitment(page, { name, amount, currency = 'AUD', category = 'Housing' }) {
  await page.getByTestId('button-add-commitment').click();
  await page.getByTestId('input-finance-name').fill(name);
  await page.getByTestId('input-finance-amount').fill(amount);
  const select = page.getByTestId('select-finance-currency');
  if (await select.count()) await select.selectOption(currency);
  await page.getByTestId('select-finance-category').selectOption(category);
  await page.getByTestId('button-finance-save').click();
}

test('with nothing recorded the page invites the user to add something and shows no figures', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('tuklas-empty')).toBeVisible();
  await expect(page.getByTestId('tuklas-committed')).toHaveCount(0);
});

test('adding a commitment stores whole minor units and fixes the currency for later entries', async ({ page }) => {
  await open(page);
  await addCommitment(page, { name: 'Rent', amount: '2,400.50' });
  await expect(page.getByTestId('toast')).toHaveText('Commitment added');
  const [entry] = live(await snapshot(page));
  expect(entry.amountMinor).toBe(240050);
  expect(entry.currency).toBe('AUD');
  await page.getByTestId('button-add-spending').click();
  await expect(page.getByTestId('input-finance-currency')).toHaveValue('AUD');
  await expect(page.getByTestId('select-finance-currency')).toHaveCount(0);
});

test('a bad amount or an empty name explains itself and saves nothing', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-add-commitment').click();
  await page.getByTestId('input-finance-name').fill('Gym');
  await page.getByTestId('input-finance-amount').fill('12.345');
  await page.getByTestId('button-finance-save').click();
  await expect(page.getByTestId('error-finance')).toContainText('plain amount');
  await page.getByTestId('input-finance-amount').fill('12.50');
  await page.getByTestId('input-finance-name').fill('   ');
  await page.getByTestId('button-finance-save').click();
  await expect(page.getByTestId('error-finance')).toContainText('name');
  expect(live(await snapshot(page))).toHaveLength(0);
});

test('the overview adds up what is committed, due soon and spent, and the paid mark moves the bar', async ({ page }) => {
  await open(page, '?seed');
  await expect(page.getByTestId('tuklas-committed')).toContainText('2,489.00');
  await expect(page.getByTestId('tuklas-upcoming-total')).toContainText('2,400.00');
  await expect(page.getByTestId('list-upcoming').getByTestId(/^upcoming-/)).toHaveCount(1);
  await expect(page.getByTestId('tuklas-committed')).toContainText('0.00 marked paid');
  await page.getByTestId(/^button-paid-/).click();
  await expect(page.getByTestId('toast')).toHaveText('Marked paid');
  await expect(page.getByTestId('tuklas-committed')).toContainText('2,400.00 marked paid');
  await expect(page.getByTestId('tuklas-upcoming-total')).toContainText('0.00');
  await expect(page.getByTestId('tuklas-snapshot')).toContainText('Housing');
});

test('the comparison with last month only states numbers', async ({ page }) => {
  await open(page, '?seed');
  const insight = page.getByTestId('tuklas-insight');
  await expect(insight).toContainText('100');
  await expect(insight).toContainText('last month');
  await expect(insight).not.toContainText(/should|keep it up|great|good job|overspend/i);
});

test('editing and deleting work, deleting asks first, and a deletion leaves no content behind', async ({ page }) => {
  await open(page, '?seed');
  await page.getByTestId('tab-tuklas-spending').click();
  await page.getByRole('button', { name: 'Edit Groceries', exact: true }).click();
  await page.getByTestId('input-finance-amount').fill('120');
  await page.getByTestId('button-finance-save').click();
  expect(live(await snapshot(page)).find((e) => e.name === 'Groceries').amountMinor).toBe(12000);
  await page.getByRole('button', { name: 'Delete Groceries', exact: true }).click();
  await expect(page.getByTestId('dialog-delete-finance')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-delete-finance')).toHaveCount(0);
  expect(live(await snapshot(page)).some((e) => e.name === 'Groceries')).toBe(true);
  await page.getByRole('button', { name: 'Delete Groceries', exact: true }).click();
  await page.getByTestId('button-confirm-delete-finance').click();
  const snap = await snapshot(page);
  expect(live(snap).some((e) => e.name === 'Groceries')).toBe(false);
  const tombstone = snap.financeEntries.find((e) => 'deletedAt' in e);
  expect(Object.keys(tombstone).sort()).toEqual(['deletedAt', 'id']);
});

test('months can be browsed and the report lists the last six', async ({ page }) => {
  await open(page, '?seed');
  const thisMonth = await page.getByTestId('tuklas-month').textContent();
  await page.getByTestId('button-tuklas-previous-month').click();
  await expect(page.getByTestId('tuklas-month')).not.toHaveText(thisMonth);
  await page.getByTestId('tab-tuklas-reports').click();
  await expect(page.getByTestId('table-report').locator('tbody tr')).toHaveCount(6);
});

test('tabs, fields and dialogs are keyboard and screen-reader friendly', async ({ page }) => {
  await open(page, '?seed');
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Commitments' }).click();
  await expect(page.getByRole('tab', { name: 'Commitments' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('button-add-commitment').click();
  await expect(page.getByRole('dialog', { name: 'Add a commitment' })).toBeVisible();
  for (const label of ['What is it for?', 'Amount', 'Currency', 'First due date', 'Category', 'Repeats', 'How it is paid']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-finance')).toHaveCount(0);
});
