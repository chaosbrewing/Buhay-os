import { test, expect } from '@playwright/test';

const harnessPath = '/tests/e2e/memory-harness.html';

async function open(page, query = '') {
  await page.goto(`${harnessPath}${query}`);
  await expect(page.getByTestId('harness-notes')).toBeVisible();
}

const snapshot = async (page) => JSON.parse(await page.getByTestId('snapshot').textContent());
const memoryCard = (page, text) => page.getByTestId(/^card-memory-/).filter({ hasText: text });
const live = (snap) => (snap.memories ?? []).filter((memory) => !('deletedAt' in memory));

async function addMemory(page, text, { kind, isPrivate } = {}) {
  await page.getByTestId('button-add-memory').click();
  await page.getByTestId('input-memory-text').fill(text);
  if (kind) await page.getByTestId('select-memory-kind').selectOption(kind);
  if (isPrivate) await page.getByTestId('checkbox-memory-private').check();
  await page.getByTestId('button-memory-save').click();
  await expect(page.getByTestId('dialog-memory')).toBeHidden();
}

test('with the feature off (as shipped) nothing about Memory appears and notes and Inbox are unchanged', async ({ page }) => {
  await open(page, '?off');
  await expect(page.getByTestId('button-remember-note-n1')).toHaveCount(0);
  await expect(page.getByTestId('button-remember-note-n2')).toHaveCount(0);
  await expect(page.getByTestId('button-remember-inbox-in1')).toHaveCount(0);
  await expect(page.getByTestId('page-memory')).toHaveCount(0);
  await expect(page.getByTestId('dialog-memory')).toHaveCount(0);
  // The existing controls are all still there.
  await expect(page.getByTestId('button-edit-note-n1')).toBeVisible();
  await expect(page.getByTestId('button-delete-note-n1')).toBeVisible();
  await expect(page.getByTestId('button-convert-inbox-task-in1')).toBeVisible();
  await expect(page.getByTestId('button-convert-inbox-note-in1')).toBeVisible();
  expect((await snapshot(page)).memories).toBeUndefined();
});

test('switching the feature off later hides Memory but leaves saved memories exactly as they were', async ({ page }) => {
  await open(page, '?off&seeded');
  const before = await snapshot(page);
  expect(live(before)).toHaveLength(2);
  await expect(page.getByTestId('page-memory')).toHaveCount(0);
  await expect(page.getByTestId('button-remember-note-n1')).toHaveCount(0);
  await expect(page.getByTestId('button-remember-inbox-in1')).toHaveCount(0);
  // innerText is what a person can see; the hidden snapshot the harness keeps for assertions is excluded.
  expect(await page.evaluate(() => document.body.innerText)).not.toContain('I prefer morning flights');
  // Using the rest of the planner changes nothing about the saved memories.
  await page.getByTestId('button-convert-inbox-task-in1').click();
  expect(await snapshot(page)).toEqual(before);
});

test('"Remember this" on a note saves a memory the user shaped, with its source, privacy and an audit entry without its text', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-remember-note-n1').click();
  const dialog = page.getByTestId('dialog-memory');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('text-memory-context')).toHaveText('From your note “Landlord”');
  await expect(page.getByTestId('input-memory-text')).toHaveValue('Mr Reyes prefers email and answers within a day');
  await expect(page.getByTestId('input-memory-text')).toBeFocused();

  await page.getByTestId('input-memory-text').fill('Landlord Mr Reyes prefers email');
  await page.getByTestId('select-memory-kind').selectOption('preference');
  await page.getByTestId('checkbox-memory-private').check();
  await page.getByTestId('button-memory-save').click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('toast')).toHaveText('Saved to Memory');
  const card = memoryCard(page, 'Landlord Mr Reyes prefers email');
  await expect(card).toContainText('Preference');
  await expect(card).toContainText('You confirmed this');
  await expect(card).toContainText('Private');
  await expect(card).toContainText('From your note: “Landlord”');

  const snap = await snapshot(page);
  const saved = live(snap).find((memory) => memory.text === 'Landlord Mr Reyes prefers email');
  expect(saved).toMatchObject({
    kind: 'preference', verification: 'user-confirmed', sensitivity: 'private',
    source: { type: 'planner', ref: { type: 'note', id: 'n1' } },
  });
  expect(snap.auditEvents.at(-1)).toMatchObject({ actor: 'user', action: 'memory.created' });
  expect(JSON.stringify(snap.auditEvents)).not.toContain('Landlord Mr Reyes');
  // A note with no body offers its title instead.
  await page.getByTestId('button-remember-note-n2').click();
  await expect(page.getByTestId('input-memory-text')).toHaveValue('Packing list');
});

test('"Remember this" on an Inbox thought works from the keyboard, and closing it saves nothing and gives focus back', async ({ page }) => {
  await open(page);
  const button = page.getByTestId('button-remember-inbox-in1');
  const before = live(await snapshot(page)).length;

  await button.focus();
  await button.press('Enter');
  const dialog = page.getByTestId('dialog-memory');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('text-memory-context')).toHaveText('From your Inbox thought “Dentist moved to Friday”');
  await expect(page.getByTestId('input-memory-text')).toHaveValue('Ask about the new time');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();

  await button.click();
  await page.getByTestId('button-memory-cancel').click();
  await expect(dialog).toBeHidden();
  expect(live(await snapshot(page)).length).toBe(before);

  await button.click();
  await page.getByTestId('button-memory-save').click();
  await expect(dialog).toBeHidden();
  const card = memoryCard(page, 'Ask about the new time');
  await expect(card).toContainText('From your Inbox thought: “Dentist moved to Friday”');
  await expect(card).not.toContainText('Private');
  expect(live(await snapshot(page)).length).toBe(before + 1);
});

test('the dialog keeps Tab inside it and refuses an empty memory without saving anything', async ({ page }) => {
  await open(page);
  const before = live(await snapshot(page)).length;
  await page.getByTestId('button-add-memory').click();
  await expect(page.getByTestId('text-memory-context')).toHaveCount(0);

  await page.getByTestId('button-memory-save').click();
  await expect(page.getByTestId('error-memory')).toHaveText('A memory needs some text.');
  await expect(page.getByTestId('dialog-memory')).toBeVisible();
  expect(live(await snapshot(page)).length).toBe(before);

  await page.getByTestId('button-memory-save').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('button-memory-close-x')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('button-memory-save')).toBeFocused();

  await page.getByTestId('input-memory-text').fill('The boiler is serviced every March');
  await page.getByTestId('button-memory-save').click();
  await expect(page.getByTestId('dialog-memory')).toBeHidden();
  await expect(memoryCard(page, 'The boiler is serviced every March')).toContainText('Added by you');
});

test('correcting a memory keeps the earlier wording where the user can see it', async ({ page }) => {
  await open(page);
  const card = memoryCard(page, 'I prefer morning flights');
  await card.getByTestId(/^button-edit-memory-/).click();
  await expect(page.getByRole('heading', { name: 'Correct this memory' })).toBeVisible();
  await expect(page.getByTestId('input-memory-text')).toHaveValue('I prefer morning flights');
  await page.getByTestId('input-memory-text').fill('I prefer morning flights, never red-eyes');
  await page.getByTestId('button-memory-save').click();

  await expect(page.getByTestId('toast')).toHaveText('Memory updated');
  const updated = memoryCard(page, 'never red-eyes');
  await expect(updated).toContainText('You confirmed this');
  await expect(updated).toContainText('Updated');
  const history = updated.getByTestId(/^history-memory-/);
  await expect(history).toContainText('Earlier versions (1)');
  await history.locator('summary').click();
  await expect(history).toContainText('“I prefer morning flights”');

  const memory = live(await snapshot(page)).find((entry) => entry.text.includes('never red-eyes'));
  expect(memory.revisions).toHaveLength(1);
  expect(memory.revisions[0].text).toBe('I prefer morning flights');
});

test('a memory can be made private and public again', async ({ page }) => {
  await open(page);
  const card = memoryCard(page, 'I prefer morning flights');
  const toggle = card.getByTestId(/^button-private-memory-/);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('Private');
  await expect(page.getByTestId('toast')).toHaveText('Marked private');
  expect(live(await snapshot(page)).find((memory) => memory.text === 'I prefer morning flights').sensitivity).toBe('private');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('toast')).toHaveText('No longer private');
});

test('deleting asks first, can be cancelled, and then erases the memory and its earlier versions for good', async ({ page }) => {
  await open(page);
  // Give it an earlier version so there is something extra to erase.
  await memoryCard(page, 'I prefer morning flights').getByTestId(/^button-edit-memory-/).click();
  await page.getByTestId('input-memory-text').fill('I prefer afternoon flights');
  await page.getByTestId('button-memory-save').click();
  await expect(memoryCard(page, 'afternoon flights')).toBeVisible();

  const card = memoryCard(page, 'afternoon flights');
  await card.getByTestId(/^button-delete-memory-/).click();
  const confirm = page.getByTestId('dialog-delete-memory');
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveAttribute('role', 'alertdialog');
  await expect(page.getByTestId('button-cancel-delete-memory')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(card).toBeVisible();

  await card.getByTestId(/^button-delete-memory-/).click();
  await page.getByTestId('button-confirm-delete-memory').click();
  await expect(page.getByTestId('toast')).toHaveText('Memory deleted');
  await expect(memoryCard(page, 'afternoon flights')).toHaveCount(0);

  const snap = await snapshot(page);
  const everything = JSON.stringify(snap);
  expect(everything).not.toContain('afternoon flights');
  expect(everything).not.toContain('morning flights');
  const tombstones = snap.memories.filter((memory) => 'deletedAt' in memory);
  expect(tombstones).toHaveLength(1);
  expect(Object.keys(tombstones[0]).sort()).toEqual(['deletedAt', 'id']);
});

test('a memory whose source was disconnected asks the user to keep or delete it', async ({ page }) => {
  await open(page);
  const gym = memoryCard(page, 'Gym class is on Wednesday');
  await expect(gym).toContainText('From Google Calendar');
  await expect(gym).toContainText('Verified from its source');
  const decide = gym.getByTestId(/^decide-memory-/);
  await expect(decide).toContainText('Where this came from was disconnected');
  // Other memories don't ask.
  await expect(memoryCard(page, 'I prefer morning flights').getByTestId(/^decide-memory-/)).toHaveCount(0);

  // Until the user decides, other capabilities are not given it, even with permission.
  expect(await page.evaluate(() => window.__retrieveFor('ikaw', 'gym', true))).toEqual({ allowed: true, texts: [] });

  await decide.getByTestId(/^button-keep-memory-/).click();
  await expect(page.getByTestId('toast')).toHaveText('Memory kept');
  await expect(gym.getByTestId(/^decide-memory-/)).toHaveCount(0);
  await expect(gym).toContainText('You confirmed this');
  await expect(gym).toContainText('From Google Calendar');
  const kept = live(await snapshot(page)).find((memory) => memory.text.startsWith('Gym class'));
  expect(kept.keptAt).toBeTruthy();
  expect(kept.sourceRevokedAt).toBeTruthy();
  expect(kept.source.app).toBe('Google Calendar');
  expect(await page.evaluate(() => window.__retrieveFor('ikaw', 'gym', true))).toEqual({ allowed: true, texts: ['Gym class is on Wednesday at 6pm'] });
});

test('the other choice, delete it, removes a disconnected memory after confirmation', async ({ page }) => {
  await open(page);
  const gym = memoryCard(page, 'Gym class is on Wednesday');
  await gym.getByTestId(/^button-decide-delete-memory-/).click();
  await expect(page.getByTestId('dialog-delete-memory')).toBeVisible();
  await page.getByTestId('button-confirm-delete-memory').click();
  await expect(gym).toHaveCount(0);
  expect(JSON.stringify(await snapshot(page))).not.toContain('Gym class');
});

test('memory access respects permissions: only normal memories, and only with an active grant', async ({ page }) => {
  await open(page);
  await addMemory(page, 'Flights to Cebu are cheaper on Tuesdays');
  await addMemory(page, 'Flights with my sister stay private', { isPrivate: true });

  const asked = (capability, text, withGrant) => page.evaluate(([c, t, g]) => window.__retrieveFor(c, t, g), [capability, text, withGrant]);
  expect(await asked('ikaw', 'flights', false)).toEqual({ allowed: false, texts: [] });
  const granted = await asked('ikaw', 'flights', true);
  expect(granted.allowed).toBe(true);
  expect(granted.texts.sort()).toEqual(['Flights to Cebu are cheaper on Tuesdays', 'I prefer morning flights']);
  expect(granted.texts.join(' ')).not.toContain('private');
  // A capability that can never read memories gets nothing, grant or not.
  expect(await asked('tuklas', 'flights', false)).toEqual({ allowed: false, texts: [] });
  // Making one private takes it out of what others can be given.
  await memoryCard(page, 'Flights to Cebu').getByTestId(/^button-private-memory-/).click();
  expect((await asked('ikaw', 'flights', true)).texts).toEqual(['I prefer morning flights']);
});

test('on a phone the dialogs and the page fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  const fits = (locator) => locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth;
  });
  // Wait for web fonts and two animation frames first: measuring while text is still reflowing made this
  // check flaky on slower machines (it passed or failed on identical code).
  const noSideScroll = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.documentElement.scrollWidth <= window.innerWidth;
    });

  expect(await noSideScroll()).toBe(true);
  await page.getByTestId('button-remember-note-n1').click();
  expect(await fits(page.getByTestId('dialog-memory'))).toBe(true);
  expect(await noSideScroll()).toBe(true);
  await page.getByTestId('button-memory-cancel').click();

  const card = memoryCard(page, 'Gym class is on Wednesday');
  await card.scrollIntoViewIfNeeded();
  expect(await fits(card)).toBe(true);
  await card.getByTestId(/^button-decide-delete-memory-/).click();
  expect(await fits(page.getByTestId('dialog-delete-memory'))).toBe(true);
  expect(await noSideScroll()).toBe(true);
});

test('with no memories saved the page invites the user to add one', async ({ page }) => {
  await open(page, '?empty');
  await expect(page.getByTestId('empty-memories')).toContainText('Nothing saved yet.');
  await expect(page.getByTestId('list-memories')).toHaveCount(0);
  await page.getByTestId('button-empty-add-memory').click();
  await expect(page.getByTestId('dialog-memory')).toBeVisible();
});

test('unreadable memories show a plain message, are not changed, and never crash the page', async ({ page }) => {
  await open(page, '?broken');
  await expect(page.getByTestId('error-memory-page')).toContainText("couldn't be read");
  await expect(page.getByTestId('error-memory-page')).toContainText('Nothing has been changed');
  await expect(page.getByTestId('button-add-memory')).toBeDisabled();
  await expect(page.getByTestId('list-memories')).toHaveCount(0);
  // The rest of the planner still works.
  await expect(page.getByTestId('button-edit-note-n1')).toBeVisible();
});

test('the vault shows tabs and counts, and filters by private and linked', async ({ page }) => {
  await open(page);
  const total = Number((await page.getByTestId('tab-memory-all').textContent()).match(/\((\d+)\)/)[1]);
  expect(total).toBeGreaterThan(0);
  await addMemory(page, 'A private thing', { isPrivate: true });
  await expect(page.getByTestId('tab-memory-all')).toHaveText(`All memories (${total + 1})`);
  await page.getByTestId('tab-memory-private').click();
  await expect(page.getByTestId('tab-memory-private')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('list-memories').getByTestId(/^card-memory-/)).toHaveCount(await page.locator('[data-testid^="card-memory-"] .is-private').count());
  await expect(memoryCard(page, 'A private thing')).toBeVisible();
  await expect(page.getByTestId('memory-stats')).toContainText('Total memories');
  await page.getByTestId('tab-memory-all').click();
  await expect(page.getByTestId('list-memories').getByTestId(/^card-memory-/)).toHaveCount(total + 1);
});
