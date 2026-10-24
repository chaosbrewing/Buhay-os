import { test, expect } from '@playwright/test';

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

async function createRecurringTask(page, title, frequency, date = today()) {
  await page.getByTestId(date === today() ? 'button-open-test-editor' : `button-add-task-${date}`).click();
  await page.getByTestId('input-entry-title').fill(title);
  await page.getByTestId('input-entry-date').fill(date);
  await page.getByTestId('input-entry-time').fill('09:00');
  await page.getByTestId('select-task-repeat').selectOption(frequency);
  await page.getByTestId('select-task-reminder').selectOption('15');
  if (frequency === 'weekly') {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    await page.getByRole('button', { name: labels[weekday], exact: true }).click();
  }
  await page.getByTestId('button-save-entry').click();
}

test('monthly tasks on the 29th, 30th, and 31st skip short February dates and resume after editing', async ({ page }) => {
  await page.goto('/tests/e2e/recurrence-harness.html?start=2027-01-01');
  for (const day of [29, 30, 31]) {
    const date = `2027-01-${day}`;
    const title = `monthly ${day} task`;
    const updatedTitle = `${title} updated`;
    await createRecurringTask(page, title, 'monthly', date);

    await page.getByRole('button', { name: `Edit ${title} on ${date}` }).click();
    await page.getByRole('button', { name: 'Entire series' }).click();
    await expect(page.getByTestId('select-task-repeat')).toHaveValue('monthly');
    await expect(page.getByTestId('select-task-reminder')).toHaveValue('15');
    await page.getByTestId('input-entry-title').fill(updatedTitle);
    await page.getByTestId('button-save-entry').click();

    await expect(page.getByTestId('column-day-2027-02-28').getByText(updatedTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId(`column-day-2027-03-${day}`).getByText(updatedTitle, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${updatedTitle} on 2027-03-${day}` }).click();
    await page.getByRole('button', { name: 'Entire series' }).click();
    await expect(page.getByTestId('select-task-repeat')).toHaveValue('monthly');
    await expect(page.getByTestId('select-task-reminder')).toHaveValue('15');
    await page.getByTestId('button-close-dialog').click();
  }
});

test('creates and edits daily, weekly, and monthly series with reminders and dated weekly occurrences', async ({ page }) => {
  await page.goto('/tests/e2e/recurrence-harness.html');
  for (const frequency of ['daily', 'weekly', 'monthly']) {
    const title = `${frequency} task`;
    await createRecurringTask(page, title, frequency);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: `Edit ${title} on ${today()}` }).click();
    await page.getByRole('button', { name: 'Entire series' }).click();
    await expect(page.getByTestId('select-task-repeat')).toHaveValue(frequency);
    await expect(page.getByTestId('select-task-reminder')).toHaveValue('15');
    await page.getByTestId('input-entry-title').fill(`${title} updated`);
    await page.getByTestId('button-save-entry').click();
    await expect(page.getByText(`${title} updated`, { exact: true }).first()).toBeVisible();
  }

  const weeklyNextWeek = shiftDate(today(), 7);
  await expect(page.getByTestId(`column-day-${weeklyNextWeek}`).getByText('weekly task updated', { exact: true })).toBeVisible();
});

test('edits one occurrence without changing its neighbors, moves and removes dated instances, and keeps legacy tasks editable', async ({ page }) => {
  await page.route('**/api/planner/calendar/**', route => route.fulfill({ json: { connected: false } }));
  await page.goto('/tests/e2e/recurrence-harness.html');
  await createRecurringTask(page, 'daily occurrence', 'daily');
  const occurrenceDate = shiftDate(today(), 1);
  await page.getByRole('button', { name: `Edit daily occurrence on ${occurrenceDate}` }).click();
  await expect(page.getByRole('button', { name: 'This occurrence' })).toHaveClass(/btn-primary/);
  await page.getByTestId('input-entry-title').fill('Moved appointment');
  await page.getByTestId('input-entry-date').fill(shiftDate(occurrenceDate, 2));
  await page.getByTestId('select-task-reminder').selectOption('5');
  await page.getByTestId('button-save-entry').click();

  await expect(page.getByTestId(`column-day-${occurrenceDate}`).getByText('daily occurrence', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId(`column-day-${shiftDate(occurrenceDate, 2)}`).getByText('Moved appointment', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Edit Moved appointment on ${shiftDate(occurrenceDate, 2)}` }).click();
  await expect(page.getByTestId('select-task-reminder')).toHaveValue('5');
  await page.getByTestId('button-delete-entry').click();
  await expect(page.getByTestId(`column-day-${shiftDate(occurrenceDate, 2)}`).getByText('Moved appointment', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId(`column-day-${shiftDate(occurrenceDate, 3)}`).getByText('daily occurrence', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Legacy task on ' + today() }).click();
  await expect(page.getByTestId('select-task-repeat')).toHaveValue('');
  await page.getByTestId('input-entry-title').fill('Legacy task edited');
  await page.getByTestId('button-save-entry').click();
  await expect(page.getByText('Legacy task edited', { exact: true })).toBeVisible();
});

test('choosing entire series applies edited title to every future occurrence', async ({ page }) => {
  await page.goto('/tests/e2e/recurrence-harness.html');
  await createRecurringTask(page, 'series scope', 'daily');
  const occurrenceDate = shiftDate(today(), 1);
  await page.getByRole('button', { name: `Edit series scope on ${occurrenceDate}` }).click();
  await page.getByRole('button', { name: 'Entire series' }).click();
  await page.getByTestId('input-entry-title').fill('whole series updated');
  await page.getByTestId('button-save-entry').click();
  await expect(page.getByTestId(`column-day-${occurrenceDate}`).getByText('whole series updated', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`column-day-${shiftDate(today(), 2)}`).getByText('whole series updated', { exact: true })).toBeVisible();
});
