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

async function addTask(page, title, frequency, date = today()) {
  await page.getByRole('button', { name: 'Add a task' }).click();
  await expect(page.getByTestId('capture-title')).toBeVisible();
  await page.getByTestId('capture-title').fill(title);
  await page.getByTestId('capture-date').fill(date);
  await page.getByTestId('capture-time').fill('09:00');
  await page.getByRole('button', { name: frequency[0].toUpperCase() + frequency.slice(1), exact: true }).click();
  await page.getByRole('button', { name: '15 min before', exact: true }).click();
  await page.getByTestId('capture-save').click();
  if (date === today()) {
    await expect(page.getByRole('button', { name: `Edit task: ${title}` })).toBeVisible();
  } else {
    await expect.poll(async () => {
      const tasks = JSON.parse(await page.getByTestId('recurrence-fixture-state').textContent());
      return tasks.some(task => task.title === title && task.dueDate === date);
    }).toBe(true);
  }
}

function mondayOf(date) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function selectDate(page, date, currentWeek) {
  const weekDistance = Math.round((new Date(`${mondayOf(date)}T12:00:00`) - new Date(`${currentWeek}T12:00:00`)) / (7 * 24 * 60 * 60 * 1000));
  const buttonName = weekDistance > 0 ? 'Next week' : 'Previous week';
  for (let index = 0; index < Math.abs(weekDistance); index += 1) {
    await page.getByRole('button', { name: buttonName }).click();
  }
  const label = await page.evaluate(value => new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00`)), date);
  await page.getByRole('button', { name: new RegExp(`${label}, \\d+ tasks`) }).click();
  return mondayOf(date);
}

test('monthly tasks on the 29th, 30th, and 31st skip short February dates and resume after editing', async ({ page }) => {
  await page.goto('/__e2e__/recurrence/week');
  let currentWeek = mondayOf(today());

  for (const day of [29, 30, 31]) {
    const date = `2027-01-${day}`;
    const title = `monthly ${day} mobile task`;
    const updatedTitle = `${title} updated`;
    await addTask(page, title, 'monthly', date);

    currentWeek = await selectDate(page, date, currentWeek);
    await page.getByRole('button', { name: `Edit task: ${title}` }).click();
    await page.getByRole('button', { name: 'Entire series', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '15 min before', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('capture-title').fill(updatedTitle);
    await page.getByTestId('capture-save').click();

    currentWeek = await selectDate(page, '2027-02-28', currentWeek);
    await expect(page.getByRole('button', { name: `Edit task: ${updatedTitle}` })).toHaveCount(0);
    currentWeek = await selectDate(page, `2027-03-${day}`, currentWeek);
    await expect(page.getByRole('button', { name: `Edit task: ${updatedTitle}` })).toBeVisible();
    await page.getByRole('button', { name: `Edit task: ${updatedTitle}` }).click();
    await page.getByRole('button', { name: 'Entire series', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '15 min before', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close capture' }).click();
  }
});

test('creates and edits daily, weekly, and monthly tasks while preserving reminders', async ({ page }) => {
  await page.goto('/__e2e__/recurrence/week');
  for (const frequency of ['daily', 'weekly', 'monthly']) {
    const title = `${frequency} mobile task`;
    await addTask(page, title, frequency);
    await page.getByRole('button', { name: `Edit task: ${title}` }).click();
    await page.getByRole('button', { name: 'Entire series', exact: true }).click();
    await expect(page.getByRole('button', { name: '15 min before', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: frequency[0].toUpperCase() + frequency.slice(1), exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('capture-title').fill(`${title} updated`);
    await page.getByTestId('capture-save').click();
    await expect(page.getByRole('button', { name: `Edit task: ${title} updated` })).toBeVisible();
  }

  const weeklyDate = shiftDate(today(), 7);
  await page.getByRole('button', { name: 'Next week' }).click();
  const weekday = await page.evaluate(date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)), weeklyDate);
  const weeklyDay = page.getByRole('button', { name: new RegExp(`${weekday}, \\d+ tasks`) });
  await expect(weeklyDay).toBeVisible();
  await weeklyDay.click();
  await expect(page.getByRole('button', { name: 'Edit task: weekly mobile task updated' })).toBeVisible();
});

test('edits one date, moves and removes the occurrence, and leaves older non-recurring tasks editable', async ({ page }) => {
  await page.goto('/__e2e__/recurrence/week');
  await addTask(page, 'daily mobile series', 'daily');

  const occurrenceDate = shiftDate(today(), 1);
  const occurrenceLabel = await page.evaluate(date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)), occurrenceDate);
  await page.getByRole('button', { name: new RegExp(`${occurrenceLabel}, 1 tasks`) }).click();
  await page.getByRole('button', { name: 'Edit task: daily mobile series' }).click();
  await expect(page.getByRole('button', { name: 'This occurrence', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('capture-title').fill('Moved mobile occurrence');
  await page.getByTestId('capture-date').fill(shiftDate(occurrenceDate, 2));
  await page.getByRole('button', { name: '5 min before', exact: true }).click();
  await page.getByTestId('capture-save').click();
  await expect.poll(async () => {
    const tasks = JSON.parse(await page.getByTestId('recurrence-fixture-state').textContent());
    return tasks.find(task => task.title === 'daily mobile series')?.occurrenceOverrides?.find(item => item.date === occurrenceDate)?.changes?.reminder?.minutesBefore;
  }).toBe(5);

  const movedDate = shiftDate(occurrenceDate, 2);
  const movedLabel = await page.evaluate(date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)), movedDate);
  await page.getByRole('button', { name: new RegExp(`${movedLabel}, \\d+ tasks`) }).click();
  await expect(page.getByRole('button', { name: 'Edit task: Moved mobile occurrence' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit task: Moved mobile occurrence' }).first().click();
  await expect(page.getByTestId('capture-title')).toHaveValue('Moved mobile occurrence');
  await expect(page.getByRole('button', { name: '5 min before', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'This occurrence', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close capture' }).click();

  const todayLabel = await page.evaluate(date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)), today());
  const sourceLabel = await page.evaluate(date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)), occurrenceDate);
  await page.getByRole('button', { name: new RegExp(`${sourceLabel}, \\d+ tasks`) }).click();
  await expect(page.getByText('Nothing scheduled here')).toBeVisible();

  await page.getByRole('button', { name: new RegExp(`${movedLabel}, \\d+ tasks`) }).click();
  await expect(page.getByRole('button', { name: 'Edit task: Moved mobile occurrence' })).toBeVisible();
  const nextDay = shiftDate(movedDate, 1);
  const nextDayLabel = await page.evaluate(date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)), nextDay);
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: new RegExp(`${nextDayLabel}, \\d+ tasks`) }).click();
  await expect(page.getByRole('button', { name: 'Edit task: daily mobile series' })).toBeVisible();

  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: new RegExp(`${todayLabel}, \\d+ tasks`) }).click();
  await page.getByRole('button', { name: 'Edit task: Legacy task' }).click();
  await expect(page.getByRole('button', { name: 'Does not repeat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('capture-title').fill('Legacy task updated');
  await page.getByTestId('capture-save').click();
  await expect(page.getByRole('button', { name: 'Edit task: Legacy task updated' })).toBeVisible();
});

test('series scope updates the recurring task rather than only its selected date', async ({ page }) => {
  await page.goto('/__e2e__/recurrence/week');
  await addTask(page, 'series scope mobile', 'daily');
  await page.getByRole('button', { name: 'Edit task: series scope mobile' }).click();
  await page.getByRole('button', { name: 'Entire series', exact: true }).click();
  await page.getByTestId('capture-title').fill('whole mobile series updated');
  await page.getByTestId('capture-save').click();
  await expect(page.getByRole('button', { name: 'Edit task: whole mobile series updated' })).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
  const nextWeek = shiftDate(today(), 7);
  const dayLabel = await page.evaluate(date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)), nextWeek);
  await page.getByRole('button', { name: new RegExp(`${dayLabel}, \\d+ tasks`) }).click();
  await expect(page.getByRole('button', { name: 'Edit task: whole mobile series updated' })).toBeVisible();
});
