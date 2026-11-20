import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UGNAY_SCHEMA_VERSION,
  addPlanDraftItem,
  approvePlanDraftItem,
  createPlanDraft,
  dismissPlanDraft,
  draftRecordId,
  normalizeUgnayData,
  openPlanDrafts,
} from './ugnay.ts';
import { mergeReleaseTwoData, mergeReleaseTwoSnapshots } from './release2-merge.ts';

const legacy = () => ({
  tasks: [{ id: 't1', title: 'Pack boxes', dueDate: '2026-11-01', dueTime: '', tag: '', completed: false }],
  notes: [],
  settings: { theme: 'light', accentHex: '#3b765e' },
  unknownField: { retained: true },
});

const ids = (prefix = 'id') => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

const T = (minute) => `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`;

const INBOX = { type: 'inbox', id: 'in1' };
const startPlan = (data = legacy(), makeId = ids('p')) => createPlanDraft(data, {
  capability: 'planner',
  title: 'Move to a new city',
  source: INBOX,
  items: [
    { action: 'create', target: { type: 'task' }, fields: { title: 'Book movers', dueDate: '2026-11-03' } },
    { action: 'create', target: { type: 'note' }, fields: { title: 'Lease', content: 'Ends 31 Jan', date: '2026-10-25', tags: ['move'] } },
    { action: 'create', target: { type: 'goal' }, fields: { title: 'Settle in', targetDate: '2027-01-31' } },
  ],
}, T(0), makeId);

test('approving an item creates its record with provenance and an audit trail, and nothing else changes', () => {
  const makeId = ids('p');
  const { data, draft } = startPlan(legacy(), makeId);
  assert.equal(draft.source.id, 'in1');
  const [taskItem] = draft.items;
  const after = approvePlanDraftItem(data, draft.id, taskItem.id, T(2), makeId, { title: '  Book two movers ', dueDate: '2026-11-04' });

  const created = after.tasks.find((task) => task.id === draftRecordId(taskItem));
  assert.equal(after.tasks.length, legacy().tasks.length + 1);
  assert.deepEqual(after.tasks.slice(0, 1), legacy().tasks, 'existing tasks are untouched');
  assert.equal(created.title, 'Book two movers');
  assert.equal(created.dueDate, '2026-11-04');
  assert.equal(created.completed, false);
  assert.equal(created.dueTime, '');
  assert.deepEqual(created.provenance, { capability: 'planner', draftId: draft.id, draftItemId: taskItem.id, approvedAt: T(2) });
  assert.deepEqual(after.notes, [], 'other types stay untouched until their own item is approved');
  assert.equal(after.planDrafts[0].items[0].status, 'approved');
  assert.equal(after.planDrafts[0].items[0].fields.title, '  Book two movers ');
  assert.equal(after.planDrafts[0].status, 'open');
  assert.equal(after.schemaVersion, UGNAY_SCHEMA_VERSION);
  const approvedEvent = after.auditEvents.at(-1);
  assert.deepEqual([approvedEvent.actor, approvedEvent.action], ['user', 'draft.item.approved']);
  assert.deepEqual(approvedEvent.subjectIds, [draft.id, taskItem.id, created.id]);
  assert.deepEqual(normalizeUgnayData(after), after, 'the result is a valid snapshot');
});

test('notes and goals are applied with their own defaults', () => {
  const makeId = ids('p');
  const { data, draft } = startPlan(legacy(), makeId);
  const withNote = approvePlanDraftItem(data, draft.id, draft.items[1].id, T(2), makeId);
  const withBoth = approvePlanDraftItem(withNote, draft.id, draft.items[2].id, T(3), makeId);
  const { provenance: noteProvenance, ...note } = withBoth.notes[0];
  const { provenance: goalProvenance, ...goal } = withBoth.goals[0];
  assert.deepEqual(note, { id: draftRecordId(draft.items[1]), title: 'Lease', content: 'Ends 31 Jan', date: '2026-10-25', tags: ['move'] });
  assert.deepEqual(goal, { id: draftRecordId(draft.items[2]), status: 'active', title: 'Settle in', targetDate: '2027-01-31' });
  assert.equal(noteProvenance.approvedAt, T(2));
  assert.equal(goalProvenance.approvedAt, T(3));
});

test('items that cannot be applied fail whole: no record, no decision, no audit entry', () => {
  const makeId = ids('p');
  const { data, draft } = startPlan(legacy(), makeId);
  const before = JSON.stringify(data);
  const taskId = draft.items[0].id;
  for (const [overrides, message] of [
    [{ title: '   ' }, /title is required/],
    [{ dueDate: '2026-02-31' }, /valid date/],
    [{ dueTime: '25:00' }, /valid time/],
    [{ priority: 'urgent' }, /valid priority/],
    [{ completed: true }, /can't be set from a plan draft: completed/],
    [{ id: 'hijack' }, /can't be set from a plan draft: id/],
    [{ projectId: 'p1' }, /can't be set from a plan draft: projectId/],
  ]) {
    assert.throws(() => approvePlanDraftItem(data, draft.id, taskId, T(2), makeId, overrides), message);
  }
  assert.equal(JSON.stringify(data), before, 'the input snapshot is never mutated');

  const unsupported = createPlanDraft(legacy(), {
    capability: 'planner', title: 'Odd', items: [{ action: 'create', target: { type: 'project' }, fields: { title: 'Move' } }],
  }, T(0), makeId);
  assert.throws(() => approvePlanDraftItem(unsupported.data, unsupported.draft.id, unsupported.draft.items[0].id, T(1), makeId), /can't create or change a project yet/);
  const taskWithoutDate = createPlanDraft(legacy(), {
    capability: 'planner', title: 'No date', items: [{ action: 'create', target: { type: 'task' }, fields: { title: 'Pack' } }],
  }, T(0), makeId);
  assert.throws(() => approvePlanDraftItem(taskWithoutDate.data, taskWithoutDate.draft.id, taskWithoutDate.draft.items[0].id, T(1), makeId), /needs a date/);
  assert.throws(() => approvePlanDraftItem(data, draft.id, 'nope', T(2), makeId), /no longer exists/);
});

test('an item can only be approved once, and a record that already exists is never duplicated', () => {
  const makeId = ids('p');
  const { data, draft } = startPlan(legacy(), makeId);
  const item = draft.items[0];
  const once = approvePlanDraftItem(data, draft.id, item.id, T(2), makeId);
  assert.throws(() => approvePlanDraftItem(once, draft.id, item.id, T(3), makeId), /already been decided/);

  // Another device already synced the created record while this copy still shows the item as proposed.
  const synced = { ...data, tasks: [...data.tasks, once.tasks.find((task) => task.id === draftRecordId(item))] };
  const again = approvePlanDraftItem(synced, draft.id, item.id, T(4), makeId);
  assert.equal(again.tasks.filter((task) => task.id === draftRecordId(item)).length, 1);
  assert.equal(again.planDrafts[0].items[0].status, 'approved');
});

test('an update item changes only the allowed fields of an existing record and stamps its provenance', () => {
  const makeId = ids('p');
  const base = { ...legacy(), tasks: [{ ...legacy().tasks[0], completed: true, priority: 'high' }] };
  const { data, draft } = createPlanDraft(base, {
    capability: 'planner', title: 'Reschedule',
    items: [
      { action: 'update', target: { type: 'task', id: 't1' }, fields: { dueDate: '2026-11-10', tag: 'move' } },
      { action: 'update', target: { type: 'task', id: 'gone' }, fields: { dueDate: '2026-11-10' } },
    ],
  }, T(0), makeId);
  const after = approvePlanDraftItem(data, draft.id, draft.items[0].id, T(2), makeId);
  const { provenance, ...task } = after.tasks[0];
  assert.deepEqual(task, { ...base.tasks[0], dueDate: '2026-11-10', tag: 'move' }, 'completion state, priority and everything else stay as they were');
  assert.equal(provenance.draftItemId, draft.items[0].id);
  assert.equal(after.tasks.length, 1);
  assert.throws(() => approvePlanDraftItem(after, draft.id, draft.items[1].id, T(3), makeId), /no longer exists/);
});

test('steps can be added to a draft, which reopens it; invalid steps are rejected', () => {
  const makeId = ids('p');
  const { data, draft } = createPlanDraft(legacy(), {
    capability: 'planner', title: 'Tiny', items: [{ action: 'create', target: { type: 'task' }, fields: { title: 'One', dueDate: '2026-11-01' } }],
  }, T(0), makeId);
  const closed = approvePlanDraftItem(data, draft.id, draft.items[0].id, T(1), makeId);
  assert.equal(closed.planDrafts[0].status, 'approved');
  const reopened = addPlanDraftItem(closed, draft.id, { action: 'create', target: { type: 'task' }, fields: { title: ' Two ', dueDate: '2026-11-02' } }, T(2), makeId);
  assert.equal(reopened.planDrafts[0].status, 'open');
  assert.deepEqual(reopened.planDrafts[0].items.map((item) => [item.status, item.fields.title]), [['approved', 'One'], ['proposed', 'Two']]);
  assert.equal(reopened.auditEvents.at(-1).action, 'draft.item.added');
  assert.equal(reopened.tasks.length, closed.tasks.length, 'adding a step writes nothing to the planner');
  assert.throws(() => addPlanDraftItem(closed, draft.id, { action: 'create', target: { type: 'task' }, fields: { title: '' } }, T(2), makeId), /title is required/);
  assert.throws(() => addPlanDraftItem(closed, draft.id, { action: 'create', target: { type: 'review' }, fields: { title: 'x' } }, T(2), makeId), /can't create or change/);
  assert.throws(() => addPlanDraftItem(closed, 'missing', { action: 'create', target: { type: 'task' }, fields: { title: 'x', dueDate: '2026-11-02' } }, T(2), makeId), /no longer exists/);
});

test('dismissing a draft only dismisses what is still undecided', () => {
  const makeId = ids('p');
  const { data, draft } = startPlan(legacy(), makeId);
  const partly = approvePlanDraftItem(data, draft.id, draft.items[0].id, T(1), makeId);
  const dismissed = dismissPlanDraft(partly, draft.id, T(2), makeId);
  assert.deepEqual(dismissed.planDrafts[0].items.map((item) => item.status), ['approved', 'dismissed', 'dismissed']);
  assert.equal(dismissed.planDrafts[0].status, 'approved');
  assert.equal(dismissed.tasks.length, partly.tasks.length);
  assert.equal(dismissed.auditEvents.at(-1).action, 'draft.dismissed');
  assert.deepEqual(dismissPlanDraft(dismissed, draft.id, T(3), makeId), dismissed, 'nothing left to dismiss');
  assert.throws(() => dismissPlanDraft(dismissed, 'missing', T(3), makeId), /no longer exists/);
});

test('open drafts are listed newest first and a draft remembers where it came from', () => {
  const makeId = ids('p');
  const first = startPlan(legacy(), makeId);
  const second = createPlanDraft(first.data, {
    capability: 'planner', title: 'Later plan', items: [{ action: 'create', target: { type: 'task' }, fields: { title: 'x', dueDate: '2026-11-01' } }],
  }, T(10), makeId);
  assert.deepEqual(openPlanDrafts(second.data).map((draft) => draft.title), ['Later plan', 'Move to a new city']);
  assert.deepEqual(openPlanDrafts(dismissPlanDraft(second.data, second.draft.id, T(11), makeId)).map((draft) => draft.title), ['Move to a new city']);
  assert.deepEqual(openPlanDrafts(legacy()), []);
  const badSource = { ...first.data, planDrafts: [{ ...first.data.planDrafts[0], source: { type: 'bogus', id: 'x' } }] };
  assert.throws(() => normalizeUgnayData(badSource), /planDrafts/);
});

test('two devices approving the same item offline lose nothing and sync as one planner record plus a visible copy', () => {
  const makeId = ids('m');
  const { data, draft } = startPlan(legacy(), makeId);
  const itemId = draft.items[0].id;
  const deviceA = approvePlanDraftItem(data, draft.id, itemId, T(2), makeId);
  const deviceB = approvePlanDraftItem(data, draft.id, itemId, T(3), makeId);
  for (const merged of [
    mergeReleaseTwoData(deviceB, deviceA, makeId).data,
    mergeReleaseTwoSnapshots(data, deviceA, deviceB, makeId),
  ]) {
    assert.equal(merged.planDrafts[0].items[0].status, 'approved');
    assert.equal(merged.planDrafts[0].items[0].decidedAt, T(2), 'the first approval stands');
    const created = merged.tasks.filter((task) => /Book movers/.test(task.title));
    assert.ok(created.length >= 1 && created.length <= 2, 'at most the original and one conflict copy');
    assert.ok(created.some((task) => task.id === draftRecordId({ id: itemId })));
    assert.equal(merged.auditEvents.filter((event) => event.action === 'draft.item.approved').length, 2, 'both approvals stay on record');
  }
});
