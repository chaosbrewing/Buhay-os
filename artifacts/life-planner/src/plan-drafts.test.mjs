import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { approvePlanDraftItem, createPlanDraft, openPlanDrafts } from '@workspace/planner-contract/ugnay';
import { initialPlanItems, itemDateKey, itemTypeLabel, planForInboxItem } from './planDrafts.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('./App.tsx');
const hook = read('./usePlanDrafts.ts');
const sheet = read('./components/PlanDraftSheet.tsx');
const inboxPage = read('./pages/ReleaseOnePage.tsx');
const replitConfig = readFileSync(new URL('../../../.replit', import.meta.url), 'utf8');

const inboxItem = { id: 'in1', title: 'Move to another city', content: '  In three months  ', capturedAt: '2026-10-25T00:00:00.000Z' };
const emptySnapshot = () => ({ tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3b765e' } });
const ids = () => { let n = 0; return () => `id-${++n}`; };

test('"Turn into a plan" uses only the user\'s own words: a task, or a goal when Goals is on', () => {
  const task = initialPlanItems(inboxItem, { goalsEnabled: false, today: '2026-10-25' });
  assert.deepEqual(task, [{ action: 'create', target: { type: 'task' }, fields: { title: 'Move to another city', dueDate: '2026-10-25', description: 'In three months' } }]);
  const goal = initialPlanItems({ ...inboxItem, content: '' }, { goalsEnabled: true, today: '2026-10-25' });
  assert.deepEqual(goal, [{ action: 'create', target: { type: 'goal' }, fields: { title: 'Move to another city' } }]);
});

test('an Inbox thought turned into a plan stays a draft until the user approves each item', () => {
  const makeId = ids();
  const items = initialPlanItems(inboxItem, { goalsEnabled: false, today: '2026-10-25' });
  const { data, draft } = createPlanDraft(emptySnapshot(), {
    capability: 'planner', title: inboxItem.title, source: { type: 'inbox', id: inboxItem.id }, items,
  }, '2026-10-25T10:00:00.000Z', makeId);
  assert.deepEqual(data.tasks, [], 'the draft alone changes nothing');
  assert.equal(planForInboxItem(openPlanDrafts(data), 'in1').id, draft.id);
  assert.equal(planForInboxItem(openPlanDrafts(data), 'other'), undefined);

  const approved = approvePlanDraftItem(data, draft.id, draft.items[0].id, '2026-10-25T10:05:00.000Z', makeId, { title: 'Decide the city', dueDate: '2026-10-30' });
  assert.equal(approved.tasks.length, 1);
  assert.equal(approved.tasks[0].title, 'Decide the city');
  assert.equal(approved.tasks[0].provenance.capability, 'planner');
  assert.equal(planForInboxItem(openPlanDrafts(approved), 'in1'), undefined, 'a fully decided plan is no longer waiting');
});

test('review rows edit the right date per item type', () => {
  assert.equal(itemDateKey('task'), 'dueDate');
  assert.equal(itemDateKey('goal'), 'targetDate');
  assert.equal(itemDateKey('note'), null);
  assert.deepEqual(['task', 'note', 'goal'].map(itemTypeLabel), ['Task', 'Note', 'Goal']);
});

test('plan drafts are off unless the flag is exactly "true", in the app and the shared environment', () => {
  assert.match(app, /const planDraftsEnabled = buildEnv\.VITE_UGNAY_PLAN_DRAFTS === 'true';/);
  assert.match(app, /usePlanDrafts\(\{enabled:planDraftsEnabled,/);
  assert.match(app, /plans=\{planDraftsEnabled\?\{drafts:plans\.drafts,onTurnIntoPlan:plans\.turnIntoPlan,onOpenDraft:plans\.openDraft\}:undefined\}/);
  assert.match(replitConfig, /^VITE_UGNAY_PLAN_DRAFTS = "false"\s*$/m);
});

test('with the flag off the hook does nothing and the Inbox shows no plan controls', () => {
  assert.match(hook, /if \(!enabled\) return \[\];/);
  assert.match(hook, /turnIntoPlan: \(item: InboxItem\) => \{\s*if \(!enabled\) return;/);
  assert.match(hook, /openDraft: \(draftId: string\) => \{ if \(enabled\) setActiveId\(draftId\); \}/);
  assert.match(hook, /const run = [^]*?if \(!enabled\) return null;/);
  assert.match(inboxPage, /\{plans && <PlanButton item=\{item\} plans=\{plans\} \/>\}/);
  assert.match(inboxPage, /section === 'inbox' && plans && plans\.drafts\.length > 0/);
  assert.match(app, /releaseSection==='inbox'&&plans\.activeDraft&&<PlanDraftSheet/);
});

test('only an explicit "Add to my planner" press writes to the planner, and nothing leaves the device', () => {
  assert.match(hook, /approvePlanDraftItem\(data, draftId, itemId, now\(\), makeId, fields\)/);
  assert.match(hook, /capability: 'planner'/);
  assert.doesNotMatch(hook, /capability: '(ikaw|bakas|tuklas)'/);
  assert.match(sheet, /onClick=\{\(\) => approve\(item\)\}/);
  assert.match(sheet, /Nothing is added until you decide/);
  for (const source of [hook, sheet]) assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|useMutation|useQuery/);
});

test('the review sheet is an accessible dialog that closes on Escape, traps Tab and restores focus', () => {
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /aria-modal="true"/);
  assert.match(sheet, /aria-labelledby="plan-sheet-title"/);
  assert.match(sheet, /event\.key === 'Escape'/);
  assert.match(sheet, /event\.key !== 'Tab'/);
  assert.match(sheet, /return \(\) => opener\?\.focus\?\.\(\)/);
  assert.match(sheet, /role="alert"/);
  assert.match(sheet, /aria-label=\{`Title for \$\{label\}`\}/);
});
