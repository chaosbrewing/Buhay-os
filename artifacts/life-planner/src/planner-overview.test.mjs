import test from 'node:test';
import assert from 'node:assert/strict';
import { linkPlannerRecords } from '@workspace/planner-contract/release2';
import { buildPlannerOverview, mondayOf, percentOf, shiftWeek } from './planner-overview.ts';

const settings = { theme: 'light', accentHex: '#3b765e' };
const task = (id, dueDate, extra = {}) => ({ id, title: id, dueDate, dueTime: '', tag: '', completed: false, ...extra });

test('a week runs Monday to Sunday and moves by whole weeks', () => {
  assert.equal(mondayOf('2026-11-19'), '2026-11-16'); // Thursday
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(mondayOf('2026-11-22'), '2026-11-16'); // Sunday belongs to the week before
  assert.equal(shiftWeek('2026-11-16', 1), '2026-11-23');
  assert.equal(shiftWeek('2026-11-16', -1), '2026-11-09');
});

test('tasks are tallied per day and for the week, ignoring other weeks', () => {
  const data = { tasks: [
    task('a', '2026-11-16', { completed: true }), task('b', '2026-11-16'),
    task('c', '2026-11-18', { completed: true }), task('later', '2026-11-30'),
  ], notes: [], settings };
  const overview = buildPlannerOverview(data, '2026-11-16', '2026-11-19');
  assert.deepEqual(overview.tasksTally, { completed: 2, total: 3 });
  assert.deepEqual(overview.days[0], { date: '2026-11-16', completed: 1, total: 2 });
  assert.deepEqual(overview.days[2], { date: '2026-11-18', completed: 1, total: 1 });
  assert.equal(overview.days[6].total, 0);
  assert.equal(overview.tasks.length, 3);
});

test('tasks are listed by date then time, with untimed tasks after timed ones', () => {
  const data = { tasks: [
    task('untimed', '2026-11-17'), task('late', '2026-11-17', { dueTime: '15:00' }), task('early', '2026-11-17', { dueTime: '08:00' }),
  ], notes: [], settings };
  assert.deepEqual(buildPlannerOverview(data, '2026-11-16', '2026-11-17').tasks.map((t) => t.id), ['early', 'late', 'untimed']);
});

test('a parent task is counted through its subtasks, not twice', () => {
  const data = { tasks: [
    task('parent', '2026-11-17'),
    task('child1', '2026-11-17', { parentTaskId: 'parent', completed: true }),
    task('child2', '2026-11-17', { parentTaskId: 'parent' }),
  ], notes: [], settings };
  const overview = buildPlannerOverview(data, '2026-11-16', '2026-11-17');
  assert.equal(overview.tasksTally.total, 2);
  assert.equal(overview.tasksTally.completed, 1);
});

test('with nothing planned there is no percentage and no goals tally', () => {
  const overview = buildPlannerOverview({ tasks: [], notes: [], settings }, '2026-11-16', '2026-11-19');
  assert.equal(overview.weekPercent, null);
  assert.equal(overview.goalsTally, null);
  assert.deepEqual(overview.habitsTally, { completed: 0, total: 0 });
});

test('habits count this week’s planned days and completions', () => {
  const data = { tasks: [], notes: [], settings, habits: [
    { id: 'h', title: 'Read', completedDates: ['2026-11-16', '2026-11-17'], scheduledDays: [1, 2, 3, 4, 5] },
  ] };
  const overview = buildPlannerOverview(data, '2026-11-16', '2026-11-19');
  assert.equal(overview.habitsTally.completed, 2);
  assert.ok(overview.habitsTally.total >= 2);
  assert.equal(overview.weekPercent, percentOf({ completed: 2, total: overview.habitsTally.total }));
});

test('active goals are summed from their linked work; archived goals are left out', () => {
  let data = { tasks: [task('t1', '2026-11-17', { completed: true }), task('t2', '2026-11-17')], notes: [], settings,
    goals: [{ id: 'g1', title: 'Launch', status: 'active' }, { id: 'g2', title: 'Old', status: 'archived' }] };
  data = linkPlannerRecords(data, { type: 'goal', id: 'g1' }, { type: 'task', id: 't1' }, '2026-11-01T00:00:00.000Z');
  data = linkPlannerRecords(data, { type: 'goal', id: 'g1' }, { type: 'task', id: 't2' }, '2026-11-01T00:00:00.000Z');
  const overview = buildPlannerOverview(data, '2026-11-16', '2026-11-19');
  assert.deepEqual(overview.goalsTally, { completed: 1, total: 2, goals: 1 });
});
