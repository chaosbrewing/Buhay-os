import { test, expect } from '@playwright/test';

const harness = '/tests/e2e/planner-harness.html';

async function open(page) {
  await page.goto(harness);
  await expect(page.getByTestId('page-planner-overview')).toBeVisible();
}

test('the Tasks tab lists this week’s tasks in date and time order, and counts them', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('planner-task-count')).toHaveText('4');
  const titles = await page.locator('.po-task .po-title').allTextContents();
  expect(titles).toEqual(['Finalize design tokens', 'Prepare deck', 'Review notes', 'Plan next week']);
  await expect(page.getByTestId('planner-week-range')).toHaveText('Nov 9 – Nov 15');
});

test('ticking a task updates the day tally and the progress, and edit and add are handed to the app', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('planner-progress')).toContainText('1 / 4');
  await page.getByTestId('button-planner-toggle-b').click();
  await expect(page.getByTestId('planner-progress')).toContainText('2 / 4');
  await expect(page.getByRole('button', { name: 'Mark incomplete: Prepare deck' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Review notes', exact: true }).click();
  await expect(page.getByTestId('log')).toHaveText('edit:c');
  await page.getByTestId('button-planner-add-task').click();
  await expect(page.getByTestId('log')).toHaveText('add-task');
});

test('the week can move forward and back, and a different week shows its own tasks', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-planner-next-week').click();
  await expect(page.getByTestId('planner-week-range')).toHaveText('Nov 16 – Nov 22');
  await expect(page.locator('.po-task .po-title')).toHaveText(['Next week thing']);
  await page.getByTestId('button-planner-previous-week').click();
  await page.getByTestId('button-planner-previous-week').click();
  await expect(page.locator('.po-task')).toHaveCount(0);
  await expect(page.getByText('No tasks this week')).toBeVisible();
});

test('progress counts tasks and habit days, and shows goals from their linked work', async ({ page }) => {
  await open(page);
  const progress = page.getByTestId('planner-progress');
  await expect(progress).toContainText('Tasks');
  await expect(progress).toContainText('Habits');
  await expect(progress).toContainText('Goals');
  await expect(progress).toContainText('1 / 1');
  await expect(progress).not.toContainText(/score|rank|streak/i);
  await expect(page.getByRole('img', { name: /percent of this week’s plan done/ })).toBeVisible();
});

test('routines, goals and progress tabs work, and tabs are announced to screen readers', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Routines' }).click();
  await expect(page.getByText('Morning reset')).toBeVisible();
  await page.getByTestId('button-planner-start-routine-r1').click();
  await expect(page.getByTestId('log')).toHaveText('start:r1');
  await page.getByRole('tab', { name: 'Goals' }).click();
  await expect(page.getByText('Launch the beta')).toBeVisible();
  await expect(page.getByText('1 of 1 linked done')).toBeVisible();
  await page.getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByTestId('planner-progress')).toBeVisible();
  await expect(page.getByRole('tabpanel')).toBeVisible();
});
