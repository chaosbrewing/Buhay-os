import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlannerTombstone,
  canSetTaskParent,
  convertInboxItemToNote,
  convertInboxItemToTask,
  completePlannerRoutineStep,
  deletePlannerRoutineRun,
  expandPlannerTaskOccurrences,
  getPlannerDateKeyInTimeZone,
  getPlannerReminderInstances,
  getTodayWidgetOrder,
  getPlannerHabitHistory,
  getPlannerHabitWeek,
  isPlannerRoutineStepComplete,
  mergePlannerData,
  mergePlannerSnapshots,
  normalizePlannerData,
  pausePlannerHabit,
  resolvePreferredCalendar,
  resolvePlannerLocalDateTime,
  startPlannerRoutineRun,
  setPlannerRoutineStepCompletion,
  summarizePlannerHabit,
  resumePlannerHabit,
  setPlannerHabitProgress,
  setPlannerHabitCompleted,
  setPlannerHabitSkipped,
  updatePlannerTaskOccurrence,
} from './index.ts';

const legacy = () => ({
  tasks: [],
  notes: [],
  settings: { theme: 'light', accentHex: '#3b765e' },
  futureField: { retained: true },
});

test('legacy snapshots remain unchanged until a Release 1 collection is used', () => {
  const snapshot = legacy();
  assert.deepEqual(normalizePlannerData(snapshot), snapshot);
  assert.equal('inbox' in normalizePlannerData(snapshot), false);
  assert.equal('habits' in normalizePlannerData(snapshot), false);
  assert.equal('routines' in normalizePlannerData(snapshot), false);
  const merged = mergePlannerData(snapshot, snapshot, () => 'unused');
  assert.equal('deletedRecords' in merged.data, false);
});

test('optional calendar, dashboard, and reminder privacy preferences survive legacy merges', () => {
  const snapshot = legacy();
  assert.deepEqual(normalizePlannerData(snapshot), snapshot);
  assert.deepEqual(getTodayWidgetOrder(snapshot.settings), ['progress', 'tasks', 'notes']);
  const customized = {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      preferredCalendarId: 'team',
      todayWidgetOrder: ['habits', 'tasks'],
      showTaskTitlesInReminders: false,
    },
  };
  assert.deepEqual(getTodayWidgetOrder(customized.settings), ['habits', 'tasks']);
  assert.deepEqual(mergePlannerData(snapshot, customized, () => 'unused').data.settings, customized.settings);
  assert.throws(() => normalizePlannerData({
    ...snapshot,
    settings: { ...snapshot.settings, showTaskTitlesInReminders: 'false' },
  }), /invalid/);
  assert.throws(() => normalizePlannerData({
    ...snapshot,
    settings: { ...snapshot.settings, todayWidgetOrder: ['tasks', 'unknown'] },
  }), /invalid/);
  assert.throws(() => normalizePlannerData({
    ...snapshot,
    tasks: [{ id: 'bad-link', title: 'Task', dueDate: '', dueTime: '', tag: '', completed: false, calendarEventRef: { calendarId: 'primary' } }],
  }), /invalid/);
});

test('task-to-event references merge without creating a duplicate task copy', () => {
  const task = { id: 'task', title: 'Call the clinic', dueDate: '2026-10-15', dueTime: '09:00', tag: '', completed: false };
  const base = { ...legacy(), tasks: [task] };
  const local = { ...base, tasks: [{ ...task, calendarEventRef: { calendarId: 'team', eventId: 'event-1' } }] };
  const remote = base;
  const merged = mergePlannerData(remote, local, () => 'unused');
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.data.tasks.length, 1);
  assert.equal(merged.data.tasks[0].completed, false);
  assert.deepEqual(merged.data.tasks[0].calendarEventRef, { calendarId: 'team', eventId: 'event-1' });
});

test('preferred calendar selection uses writable destinations and explains revoked choices', () => {
  const calendars = [
    { id: 'primary', primary: true, accessRole: 'owner' },
    { id: 'team', primary: false, accessRole: 'writer' },
    { id: 'read-only', primary: false, accessRole: 'reader' },
  ];
  assert.deepEqual(resolvePreferredCalendar('team', calendars), { calendarId: 'team', usedFallback: false });
  assert.deepEqual(resolvePreferredCalendar('read-only', calendars), { calendarId: 'primary', usedFallback: true });
  assert.deepEqual(resolvePreferredCalendar('missing', [{ id: 'reader', primary: true, accessRole: 'reader' }]), {
    calendarId: null,
    usedFallback: true,
  });
});

test('offline settings merges keep the preferred calendar and dashboard order independently', () => {
  const base = legacy();
  const local = {
    ...base,
    settings: { ...base.settings, preferredCalendarId: 'team-calendar', theme: 'dark' },
  };
  const remote = {
    ...base,
    settings: { ...base.settings, todayWidgetOrder: ['habits', 'tasks'], accentHex: '#456789' },
  };
  const merged = mergePlannerSnapshots(base, local, remote, () => 'unused');
  assert.equal(merged.settings.preferredCalendarId, 'team-calendar');
  assert.deepEqual(merged.settings.todayWidgetOrder, ['habits', 'tasks']);
  assert.equal(merged.settings.theme, 'dark');
  assert.equal(merged.settings.accentHex, '#456789');
});

test('shared merge retains projects, Inbox, habits and ordered routine edits on conflict', () => {
  const base = {
    ...legacy(),
    projects: [{ id: 'project', title: 'Garden', description: '', status: 'active' }],
    inbox: [{ id: 'inbox', title: 'Idea', content: 'Plant herbs', capturedAt: '2026-10-12T10:00:00Z' }],
    habits: [{ id: 'habit', title: 'Walk', completedDates: [] }],
    routines: [{ id: 'routine', title: 'Morning', steps: [{ id: 'one', title: 'Stretch' }, { id: 'two', title: 'Tea' }] }],
  };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.projects[0].title = 'Garden project';
  remote.projects[0].description = 'Balcony herbs';
  local.inbox[0].content = 'Grow basil';
  remote.inbox[0].content = 'Buy planters';
  local.habits[0].completedDates = ['2026-10-12'];
  remote.routines[0].steps.reverse();
  const ids = ['conflict-project', 'conflict-inbox'];
  const merged = mergePlannerSnapshots(base, local, remote, () => ids.shift());

  assert.equal(merged.projects.length, 2);
  assert.equal(merged.inbox.length, 2);
  assert.deepEqual(merged.habits[0].completedDates, ['2026-10-12']);
  assert.deepEqual(merged.routines[0].steps.map((step) => step.id), ['two', 'one']);
  assert.deepEqual(merged.futureField, { retained: true });
});

test('offline merge preserves all supported collections and labels same-ID conflicts', () => {
  const remote = {
    ...legacy(),
    inbox: [{ id: 'inbox', title: 'Cloud idea', content: '', capturedAt: '2026-10-12T10:00:00Z' }],
    habits: [{ id: 'habit', title: 'Read', completedDates: [] }],
    routines: [{ id: 'routine', title: 'Evening', steps: [{ id: 'cloud', title: 'Close the day' }] }],
  };
  const local = structuredClone(remote);
  local.inbox[0].title = 'Offline idea';
  local.habits[0].completedDates = ['2026-10-12'];
  local.routines[0].steps[0].title = 'Write a note';
  local.routines.push({ id: 'local-routine', title: 'Weekend', steps: [] });
  const merged = mergePlannerData(remote, local, () => 'conflict-copy');

  assert.equal(merged.conflicts, 3);
  assert.equal(merged.data.inbox[0].title, 'Cloud idea');
  assert.equal(merged.data.inbox[1].title, 'Conflict copy — Offline idea');
  assert.deepEqual(merged.data.habits[1].completedDates, ['2026-10-12']);
  assert.equal(merged.data.routines.length, 3);
  assert.equal(merged.data.routines[0].steps[0].title, 'Close the day');
  const editedRoutineCopy = merged.data.routines.find((routine) => routine.title === 'Conflict copy — Evening');
  assert.equal(editedRoutineCopy.steps[0].title, 'Write a note');
});

test('routine runs snapshot the saved step order and preserve dated step completion', () => {
  const routine = {
    id: 'routine',
    title: 'Morning',
    steps: [{ id: 'one', title: 'Stretch' }, { id: 'two', title: 'Tea' }],
  };
  const started = startPlannerRoutineRun(routine, 'run-1', '2026-10-13T07:00:00.000Z');
  assert.deepEqual(routine.steps.map((step) => step.id), ['one', 'two']);
  assert.deepEqual(started.runs[0].steps, routine.steps);
  assert.deepEqual(started.runs[0].completedStepIds, []);

  const firstStep = completePlannerRoutineStep(started, 'run-1', 'one', '2026-10-13T07:05:00.000Z');
  assert.deepEqual(firstStep.runs[0].completedStepIds, ['one']);
  assert.equal(firstStep.runs[0].completedAt, undefined);
  assert.equal(completePlannerRoutineStep(firstStep, 'run-1', 'missing', '2026-10-13T07:06:00.000Z'), firstStep);

  const finished = completePlannerRoutineStep(firstStep, 'run-1', 'two', '2026-10-13T07:10:00.000Z');
  assert.deepEqual(finished.runs[0].completedStepIds, ['one', 'two']);
  assert.equal(finished.runs[0].completedAt, '2026-10-13T07:10:00.000Z');
  assert.deepEqual(finished.steps, routine.steps);
  assert.equal(normalizePlannerData({ ...legacy(), routines: [routine] }).routines[0].runs, undefined);
});

test('daily, weekly, and monthly recurrence use calendar dates across DST and month boundaries', () => {
  const daily = {
    id: 'daily', title: 'Water plants', dueDate: '2026-03-07', dueTime: '08:15', tag: '',
    completed: false, recurrence: { frequency: 'daily', timeZone: 'America/New_York' },
    reminder: { minutesBefore: 15, timeZone: 'America/New_York' },
  };
  assert.deepEqual(expandPlannerTaskOccurrences([daily], '2026-03-07', '2026-03-10').map((task) => task.dueDate), [
    '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
  ]);
  assert.equal(expandPlannerTaskOccurrences([daily], '2026-03-08', '2026-03-08')[0].dueTime, '08:15');
  assert.equal(expandPlannerTaskOccurrences([daily], '2026-03-08', '2026-03-08')[0].reminder.timeZone, 'America/New_York');

  const weekly = {
    ...daily, dueDate: '2026-10-30',
    recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 5] },
  };
  assert.deepEqual(expandPlannerTaskOccurrences([weekly], '2026-10-30', '2026-11-16').map((task) => task.dueDate), [
    '2026-10-30', '2026-11-09', '2026-11-13',
  ]);

  const monthly = { ...daily, dueDate: '2026-01-31', recurrence: { frequency: 'monthly' } };
  assert.deepEqual(expandPlannerTaskOccurrences([monthly], '2026-02-01', '2026-04-30').map((task) => task.dueDate), [
    '2026-03-31',
  ]);

  for (const day of [29, 30, 31]) {
    const anchored = {
      ...monthly,
      dueDate: `2027-01-${day}`,
      recurrence: { frequency: 'monthly' },
      reminder: { minutesBefore: 15, timeZone: 'America/New_York' },
    };
    assert.deepEqual(expandPlannerTaskOccurrences([anchored], '2027-02-01', '2027-02-28'), []);
    const march = expandPlannerTaskOccurrences([anchored], `2027-03-${day}`, `2027-03-${day}`);
    assert.deepEqual(march.map((task) => task.dueDate), [`2027-03-${day}`]);
    assert.deepEqual(march[0].reminder, anchored.reminder);
  }

  const leapDaySeries = { ...monthly, dueDate: '2028-01-29', recurrence: { frequency: 'monthly' } };
  assert.deepEqual(expandPlannerTaskOccurrences([leapDaySeries], '2028-02-01', '2028-02-29').map((task) => task.dueDate), [
    '2028-02-29',
  ]);
});

test('one recurring occurrence can be edited or cancelled without changing its series or neighbors', () => {
  const series = {
    id: 'series', title: 'Take medicine', dueDate: '2026-11-01', dueTime: '09:00', tag: 'Health',
    completed: false, recurrence: { frequency: 'daily', timeZone: 'Pacific/Kiritimati' },
  };
  const base = { ...legacy(), tasks: [series] };
  const moved = updatePlannerTaskOccurrence(base, 'series', '2026-11-02', {
    dueDate: '2026-11-03', dueTime: '10:00', reminder: { minutesBefore: 5, timeZone: 'Pacific/Kiritimati' },
  }, '2026-11-01T22:00:00.000Z');
  assert.deepEqual(moved.tasks[0].recurrence, series.recurrence);
  assert.deepEqual(expandPlannerTaskOccurrences(moved.tasks, '2026-11-01', '2026-11-03').map(({ dueDate, dueTime }) => [dueDate, dueTime]), [
    ['2026-11-01', '09:00'], ['2026-11-03', '09:00'], ['2026-11-03', '10:00'],
  ]);
  const deleted = updatePlannerTaskOccurrence(moved, 'series', '2026-11-02', undefined, '2026-11-01T23:00:00.000Z', true);
  assert.deepEqual(expandPlannerTaskOccurrences(deleted.tasks, '2026-11-01', '2026-11-03').map((task) => task.occurrenceDate), [
    '2026-11-01', '2026-11-03',
  ]);
});

test('offline recurrence edits merge by occurrence timestamp without making conflict copies', () => {
  const task = {
    id: 'series', title: 'Walk', dueDate: '2026-10-12', dueTime: '08:00', tag: '',
    completed: false, recurrence: { frequency: 'daily', interval: 1, timeZone: 'America/Los_Angeles' },
  };
  const base = { ...legacy(), tasks: [task] };
  const local = updatePlannerTaskOccurrence(base, 'series', '2026-10-13', { completed: true }, '2026-10-13T10:00:00.000Z');
  const remote = updatePlannerTaskOccurrence(base, 'series', '2026-10-14', { dueTime: '09:00' }, '2026-10-14T10:00:00.000Z');
  const merged = mergePlannerData(remote, local, () => 'unused');
  assert.equal(merged.conflicts, 0);
  assert.deepEqual(merged.data.tasks[0].occurrenceOverrides.map((entry) => entry.date).sort(), ['2026-10-13', '2026-10-14']);
  const sameDateRemote = updatePlannerTaskOccurrence(base, 'series', '2026-10-13', { completed: false }, '2026-10-13T11:00:00.000Z');
  const corrected = mergePlannerData(sameDateRemote, local, () => 'unused');
  assert.equal(corrected.conflicts, 0);
  assert.equal(corrected.data.tasks[0].occurrenceOverrides[0].changes.completed, false);
});

test('routine completion corrections and run removals survive both offline merge modes', () => {
  const routine = {
    id: 'routine', title: 'Close out', steps: [{ id: 'one', title: 'Lock up' }, { id: 'two', title: 'Set alarm' }],
    runs: [{
      id: 'run', startedAt: '2026-10-13T20:00:00.000Z',
      steps: [{ id: 'one', title: 'Lock up' }, { id: 'two', title: 'Set alarm' }],
      completedStepIds: ['one', 'two'], completedAt: '2026-10-13T20:15:00.000Z',
    }],
  };
  const base = { ...legacy(), routines: [routine] };
  const corrected = {
    ...base,
    routines: [setPlannerRoutineStepCompletion(routine, 'run', 'one', false, '2026-10-14T01:00:00.000Z')],
  };
  const removed = {
    ...base,
    routines: [deletePlannerRoutineRun(routine, 'run', '2026-10-14T02:00:00.000Z')],
  };
  const offline = mergePlannerData(base, corrected, () => 'unused');
  const run = offline.data.routines[0].runs[0];
  assert.equal(isPlannerRoutineStepComplete(run, 'one'), false);
  assert.equal(run.completedAt, undefined);
  const threeWay = mergePlannerSnapshots(base, removed, base, () => 'unused');
  assert.equal(threeWay.routines[0].runs[0].deletedAt, '2026-10-14T02:00:00.000Z');
  const twoWay = mergePlannerData(base, removed, () => 'unused');
  assert.equal(twoWay.data.routines[0].runs[0].deletedAt, '2026-10-14T02:00:00.000Z');
  assert.equal(twoWay.data.routines[0].runs[0].startedAt, routine.runs[0].startedAt);
});

test('offline run histories merge by run and step without duplicating an unchanged routine', () => {
  const remote = {
    ...legacy(),
    routines: [{
      id: 'routine',
      title: 'Morning',
      steps: [{ id: 'one', title: 'Stretch' }, { id: 'two', title: 'Tea' }],
      runs: [
        { id: 'shared-run', startedAt: '2026-10-13T07:00:00.000Z', steps: [{ id: 'one', title: 'Stretch' }, { id: 'two', title: 'Tea' }], completedStepIds: ['one'] },
        { id: 'remote-run', startedAt: '2026-10-12T07:00:00.000Z', steps: [{ id: 'one', title: 'Stretch' }, { id: 'two', title: 'Tea' }], completedStepIds: ['one', 'two'], completedAt: '2026-10-12T07:10:00.000Z' },
      ],
    }],
  };
  const local = structuredClone(remote);
  local.routines[0].runs[0].completedStepIds.push('two');
  local.routines[0].runs[0].completedAt = '2026-10-13T07:10:00.000Z';
  local.routines[0].runs.push({
    id: 'local-run',
    startedAt: '2026-10-14T07:00:00.000Z',
    steps: structuredClone(remote.routines[0].steps),
    completedStepIds: [],
  });

  const merged = mergePlannerData(remote, local, () => 'unexpected-conflict');
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.data.routines.length, 1);
  assert.deepEqual(merged.data.routines[0].steps.map((step) => step.id), ['one', 'two']);
  assert.deepEqual(merged.data.routines[0].runs.map((run) => run.id), ['local-run', 'shared-run', 'remote-run']);
  assert.deepEqual(merged.data.routines[0].runs[1].completedStepIds, ['one', 'two']);
  assert.equal(merged.data.routines[0].runs[1].completedAt, '2026-10-13T07:10:00.000Z');
});

test('conflicting offline routine orders retain both definitions and each side’s run history', () => {
  const remote = {
    ...legacy(),
    routines: [{
      id: 'routine',
      title: 'Morning',
      steps: [{ id: 'two', title: 'Tea' }, { id: 'one', title: 'Stretch' }],
      runs: [{ id: 'remote-run', startedAt: '2026-10-13T07:00:00.000Z', steps: [{ id: 'two', title: 'Tea' }, { id: 'one', title: 'Stretch' }], completedStepIds: ['two'] }],
    }],
  };
  const local = structuredClone(remote);
  local.routines[0].steps.reverse();
  local.routines[0].runs.push({
    id: 'local-run',
    startedAt: '2026-10-14T07:00:00.000Z',
    steps: [{ id: 'two', title: 'Tea' }, { id: 'one', title: 'Stretch' }],
    completedStepIds: ['one'],
  });
  let nextId = 0;

  const merged = mergePlannerData(remote, local, () => `routine-conflict-${++nextId}`);
  assert.equal(merged.conflicts, 1);
  assert.deepEqual(merged.data.routines[0].steps.map((step) => step.id), ['two', 'one']);
  assert.deepEqual(merged.data.routines[1].steps.map((step) => step.id), ['one', 'two']);
  for (const routine of merged.data.routines) {
    assert.deepEqual(routine.runs.map((run) => run.id), ['local-run', 'remote-run']);
  }
});

test('three-way sync keeps both offline routine orders and all dated runs', () => {
  const base = {
    ...legacy(),
    routines: [{
      id: 'routine',
      title: 'Evening',
      steps: [{ id: 'one', title: 'Put phone away' }, { id: 'two', title: 'Read' }, { id: 'three', title: 'Set alarm' }],
      runs: [{ id: 'base-run', startedAt: '2026-10-11T20:00:00.000Z', steps: [{ id: 'one', title: 'Put phone away' }, { id: 'two', title: 'Read' }, { id: 'three', title: 'Set alarm' }], completedStepIds: ['one'] }],
    }],
  };
  const local = structuredClone(base);
  local.routines[0].steps.reverse();
  local.routines[0].runs.push({
    id: 'local-run',
    startedAt: '2026-10-13T20:00:00.000Z',
    steps: structuredClone(local.routines[0].steps),
    completedStepIds: ['three'],
  });
  const remote = structuredClone(base);
  remote.routines[0].steps = [remote.routines[0].steps[1], remote.routines[0].steps[0], remote.routines[0].steps[2]];
  remote.routines[0].runs.push({
    id: 'remote-run',
    startedAt: '2026-10-12T20:00:00.000Z',
    steps: structuredClone(remote.routines[0].steps),
    completedStepIds: ['two'],
  });
  let nextId = 0;

  const merged = mergePlannerSnapshots(base, local, remote, () => `three-way-copy-${++nextId}`);
  assert.equal(merged.routines.length, 2);
  assert.deepEqual(merged.routines[0].steps.map((step) => step.id), ['two', 'one', 'three']);
  assert.deepEqual(merged.routines[1].steps.map((step) => step.id), ['three', 'two', 'one']);
  for (const routine of merged.routines) {
    assert.deepEqual(routine.runs.map((run) => run.id), ['local-run', 'remote-run', 'base-run']);
  }
});

test('Inbox conversion atomically replaces an item and refuses stale or duplicate conversion', () => {
  const snapshot = {
    ...legacy(),
    inbox: [{ id: 'capture', title: 'Book dentist', content: 'Call the clinic', capturedAt: '2026-10-12T10:00:00Z' }],
  };
  const task = {
    id: 'task-1',
    title: 'Book dentist',
    dueDate: '',
    dueTime: '',
    tag: '',
    completed: false,
    priority: 'normal',
  };
  const converted = convertInboxItemToTask(snapshot, 'capture', task);
  assert.deepEqual(converted.inbox, []);
  assert.equal(converted.tasks[0].title, task.title);
  assert.throws(() => convertInboxItemToTask(converted, 'capture', { ...task, id: 'task-2' }), /no longer available/);
  const duplicateSnapshot = { ...snapshot, tasks: [task] };
  assert.throws(() => convertInboxItemToTask(duplicateSnapshot, 'capture', task), /already exists/);

  const note = convertInboxItemToNote(snapshot, 'capture', {
    id: 'note-1',
    title: 'Dentist',
    content: 'Call the clinic',
    date: '2026-10-12',
    tags: [],
  });
  assert.deepEqual(note.inbox, []);
  assert.equal(note.notes[0].content, 'Call the clinic');
});

test('offline Inbox conversion does not restore the captured item on conflict', () => {
  const cloud = {
    ...legacy(),
    inbox: [{ id: 'capture', title: 'Call the clinic', content: 'Ask about openings', capturedAt: '2026-10-12T10:00:00Z' }],
  };
  const local = convertInboxItemToTask(cloud, 'capture', {
    id: 'task-from-capture',
    title: 'Call the clinic',
    description: 'Ask about openings',
    dueDate: '',
    dueTime: '',
    tag: '',
    completed: false,
    priority: 'normal',
  });
  const merged = mergePlannerData(cloud, local, () => 'conflict-copy');
  assert.deepEqual(merged.data.inbox, []);
  assert.equal(merged.data.tasks[0].id, 'task-from-capture');
  assert.equal(merged.data.deletedRecords[0].id, 'capture');
});

test('offline deletion keeps the deletion, but preserves a newer cloud edit as a conflict copy', () => {
  const cloud = {
    ...legacy(),
    habits: [{ id: 'habit', title: 'Walk', completedDates: [] }],
  };
  const localDeleted = {
    ...addPlannerTombstone(cloud, 'habits', cloud.habits[0]),
    habits: [],
  };
  const newerCloud = {
    ...cloud,
    habits: [{ ...cloud.habits[0], description: 'Cloud update' }],
  };
  const merged = mergePlannerData(newerCloud, localDeleted, () => 'kept-cloud-edit');
  assert.equal(merged.conflicts, 1);
  assert.deepEqual(merged.data.habits.map((habit) => habit.title), ['Conflict copy — Walk']);
  assert.equal(merged.data.habits[0].description, 'Cloud update');
  assert.deepEqual(merged.data.deletedRecords, []);
});

test('habit schedules and streak summaries use the saved completion dates', () => {
  const habit = {
    completedDates: ['2026-10-12', '2026-10-14', '2026-10-11', '2026-10-10', '2026-10-14'],
    scheduledDays: [1, 3, 5],
  };
  assert.deepEqual(summarizePlannerHabit(habit, '2026-10-15'), {
    completedThisWeek: 2,
    weeklyTarget: 3,
    currentStreak: 2,
    plannedThisWeek: 2,
    pausedThisWeek: 0,
    skippedThisWeek: 0,
    missedThisWeek: 0,
  });
  assert.deepEqual(summarizePlannerHabit({
    completedDates: ['2026-10-12', '2026-10-11', '2026-10-10'],
    weeklyTarget: 4,
  }, '2026-10-12'), {
    completedThisWeek: 1,
    weeklyTarget: 4,
    currentStreak: 3,
    plannedThisWeek: 1,
    pausedThisWeek: 0,
    skippedThisWeek: 0,
    missedThisWeek: 0,
  });
  assert.deepEqual(summarizePlannerHabit({
    completedDates: ['2026-10-11'],
  }, '2026-10-12'), {
    completedThisWeek: 0,
    weeklyTarget: null,
    currentStreak: 1,
    plannedThisWeek: 1,
    pausedThisWeek: 0,
    skippedThisWeek: 0,
    missedThisWeek: 0,
  });
  assert.throws(() => summarizePlannerHabit({ completedDates: [] }, 'not-a-date'), /invalid/);
});

test('measurable habit progress, pause, skip, week history, and streaks share local date semantics', () => {
  const measured = {
    id: 'water',
    title: 'Drink water',
    completedDates: ['2026-10-12'],
    scheduledDays: [1, 3, 5],
    measurement: { goal: 8, unit: 'glasses' },
    progressEntries: [
      { date: '2026-10-13', value: 4, changedAt: '2026-10-13T18:00:00Z' },
      { date: '2026-10-14', value: 8, changedAt: '2026-10-14T18:00:00Z' },
    ],
    skippedDates: ['2026-10-16'],
    pausedRanges: [{ startDate: '2026-10-17', endDate: '2026-10-19' }],
  };
  const week = getPlannerHabitWeek(measured, '2026-10-16', '2026-10-16');
  assert.deepEqual(week.map(({ date, status, value }) => [date, status, value]), [
    ['2026-10-12', 'completed', null],
    ['2026-10-13', 'in-progress', 4],
    ['2026-10-14', 'completed', 8],
    ['2026-10-15', 'upcoming', null],
    ['2026-10-16', 'skipped', null],
    ['2026-10-17', 'paused', null],
    ['2026-10-18', 'paused', null],
  ]);
  assert.deepEqual(summarizePlannerHabit(measured, '2026-10-16'), {
    completedThisWeek: 2,
    weeklyTarget: 3,
    currentStreak: 2,
    plannedThisWeek: 2,
    pausedThisWeek: 0,
    skippedThisWeek: 1,
    missedThisWeek: 0,
  });
  const skippedOnly = { ...measured, skippedDates: [], skipEntries: [], pausedRanges: [] };
  assert.equal(getPlannerHabitHistory(skippedOnly, '2026-10-16', '2026-10-16', '2026-10-17')[0].status, 'missed');
  const recorded = setPlannerHabitProgress(measured, '2026-10-16', 9, '2026-10-16T19:00:00Z');
  assert.equal(getPlannerHabitHistory(recorded, '2026-10-16', '2026-10-16')[0].status, 'completed');
  const paused = pausePlannerHabit(measured, '2026-10-20', undefined, '2026-10-19T10:00:00Z');
  const resumed = resumePlannerHabit(paused, '2026-10-23', '2026-10-23T10:00:00Z');
  assert.deepEqual(resumed.pausedRanges.at(-1), { startDate: '2026-10-20', changedAt: '2026-10-23T10:00:00Z', endDate: '2026-10-22' });
  assert.deepEqual(setPlannerHabitSkipped(measured, '2026-10-16', false).skippedDates, []);
  assert.throws(() => setPlannerHabitProgress(measured, '2026-02-30', 1), /invalid/);
});

test('habit completion corrections and measurable values resolve per date across offline merges', () => {
  const legacyHabit = { id: 'read', title: 'Read', completedDates: ['2026-10-12'] };
  const base = { ...legacy(), habits: [legacyHabit] };
  const corrected = {
    ...base,
    habits: [setPlannerHabitCompleted(legacyHabit, '2026-10-12', false, '2026-10-14T12:00:00Z')],
  };
  const staleOfflineCopy = {
    ...base,
    habits: [{ ...legacyHabit, completedDates: ['2026-10-12'] }],
  };
  const merged = mergePlannerSnapshots(base, corrected, staleOfflineCopy, () => 'unused');
  assert.equal(merged.habits[0].completedDates.includes('2026-10-12'), true);
  assert.equal(merged.habits[0].completionEntries[0].completed, false);
  assert.equal(getPlannerHabitHistory(merged.habits[0], '2026-10-12', '2026-10-12', '2026-10-14')[0].status, 'missed');

  const measurable = {
    id: 'water',
    title: 'Drink water',
    completedDates: ['2026-10-12'],
    measurement: { goal: 8, unit: 'glasses' },
    progressEntries: [{ date: '2026-10-12', value: 9, changedAt: '2026-10-12T10:00:00Z' }],
  };
  const correctedValue = setPlannerHabitProgress(measurable, '2026-10-12', 3, '2026-10-14T13:00:00Z');
  assert.equal(correctedValue.progressEntries[0].value, 3);
  assert.equal(getPlannerHabitHistory(correctedValue, '2026-10-12', '2026-10-12')[0].status, 'in-progress');
  assert.deepEqual(normalizePlannerData({ ...legacy(), habits: [correctedValue] }).habits[0].completionEntries, [
    { date: '2026-10-12', completed: false, changedAt: '2026-10-14T13:00:00Z' },
  ]);

  const tieTimestamp = '2026-10-15T10:00:00Z';
  const measuredBaseHabit = { ...measurable, completedDates: [], progressEntries: [], completionEntries: [] };
  const lowerValue = setPlannerHabitProgress(measuredBaseHabit, '2026-10-12', 3, tieTimestamp);
  const higherValue = setPlannerHabitProgress(measuredBaseHabit, '2026-10-12', 10, tieTimestamp);
  const tiedMerge = mergePlannerSnapshots(
    { ...legacy(), habits: [measuredBaseHabit] },
    { ...legacy(), habits: [lowerValue] },
    { ...legacy(), habits: [higherValue] },
    () => 'unused',
  );
  const mergedDay = getPlannerHabitHistory(tiedMerge.habits[0], '2026-10-12', '2026-10-12')[0];
  assert.equal(mergedDay.status === 'completed', mergedDay.value >= measurable.measurement.goal);
});

test('paused and skipped scheduled dates do not count as misses or break the current streak', () => {
  const habit = {
    id: 'stretch',
    title: 'Stretch',
    completedDates: ['2026-10-12', '2026-10-14'],
    scheduledDays: [1, 3, 5],
    pausedRanges: [{ startDate: '2026-10-16', endDate: '2026-10-16', changedAt: '2026-10-15T10:00:00Z' }],
  };
  assert.deepEqual(summarizePlannerHabit(habit, '2026-10-16'), {
    completedThisWeek: 2,
    weeklyTarget: 3,
    currentStreak: 2,
    plannedThisWeek: 2,
    pausedThisWeek: 1,
    skippedThisWeek: 0,
    missedThisWeek: 0,
  });
  const unpaused = resumePlannerHabit(habit, '2026-10-16', '2026-10-16T11:00:00Z');
  assert.equal(getPlannerHabitHistory(unpaused, '2026-10-16', '2026-10-16')[0].status, 'planned');
});

test('concurrent habit progress histories merge, and distinct offline fields reconcile without copies', () => {
  const habit = { id: 'read', title: 'Read', completedDates: [], weeklyTarget: 3 };
  const base = { ...legacy(), habits: [habit] };
  const remote = {
    ...base,
    habits: [{
      ...habit,
      measurement: { goal: 10, unit: 'pages' },
      progressEntries: [{ date: '2026-10-12', value: 8, changedAt: '2026-10-12T10:00:00Z' }],
      pausedRanges: [{ startDate: '2026-10-15', changedAt: '2026-10-13T10:00:00Z' }],
    }],
  };
  const local = {
    ...base,
    habits: [{
      ...habit,
      description: 'A little each evening',
      progressEntries: [{ date: '2026-10-13', value: 10, changedAt: '2026-10-13T20:00:00Z' }],
      skippedDates: ['2026-10-14'],
      skipEntries: [{ date: '2026-10-14', skipped: true, changedAt: '2026-10-14T09:00:00Z' }],
    }],
  };
  const merged = mergePlannerSnapshots(base, local, remote, () => 'unused');
  assert.equal(merged.habits.length, 1);
  assert.equal(merged.habits[0].description, 'A little each evening');
  assert.deepEqual(merged.habits[0].measurement, { goal: 10, unit: 'pages' });
  assert.deepEqual(merged.habits[0].progressEntries.map((entry) => entry.date), ['2026-10-12', '2026-10-13']);
  assert.deepEqual(merged.habits[0].pausedRanges, remote.habits[0].pausedRanges);
  assert.deepEqual(merged.habits[0].skippedDates, ['2026-10-14']);

  const unskippedLocal = {
    ...local,
    habits: [setPlannerHabitSkipped(local.habits[0], '2026-10-14', false, '2026-10-15T12:00:00Z')],
  };
  const staleSkippedRemote = {
    ...remote,
    habits: [{
      ...remote.habits[0],
      skippedDates: ['2026-10-14'],
      skipEntries: [{ date: '2026-10-14', skipped: true, changedAt: '2026-10-14T09:00:00Z' }],
    }],
  };
  const resolved = mergePlannerSnapshots(base, unskippedLocal, staleSkippedRemote, () => 'unused');
  assert.deepEqual(resolved.habits[0].skippedDates, []);
  assert.equal(resolved.habits[0].skipEntries[0].skipped, false);
});

test('habit schedule edits survive offline merge conflicts and legacy habits stay optional', () => {
  const base = {
    ...legacy(),
    habits: [{ id: 'walk', title: 'Walk', completedDates: [], scheduledDays: [1, 3] }],
  };
  const localHabit = { ...base.habits[0], weeklyTarget: 4 };
  delete localHabit.scheduledDays;
  const local = { ...base, habits: [localHabit] };
  const remote = {
    ...base,
    habits: [{ ...base.habits[0], completedDates: ['2026-10-12'] }],
  };
  const merged = mergePlannerData(remote, local, () => 'schedule-conflict');
  assert.equal(merged.conflicts, 1);
  assert.deepEqual(merged.data.habits.find((habit) => habit.id === 'walk').completedDates, ['2026-10-12']);
  const localScheduleCopy = merged.data.habits.find((habit) => habit.id === 'schedule-conflict');
  assert.equal(localScheduleCopy.weeklyTarget, 4);
  assert.equal(localScheduleCopy.scheduledDays, undefined);
  assert.deepEqual(normalizePlannerData({
    ...legacy(),
    habits: [{ id: 'legacy-habit', title: 'Read', completedDates: [] }],
  }).habits[0], { id: 'legacy-habit', title: 'Read', completedDates: [] });
});

test('malformed optional Release 1 collections are rejected without changing legacy fields', () => {
  assert.throws(() => normalizePlannerData({ ...legacy(), habits: {} }), /invalid/);
  assert.throws(() => normalizePlannerData({ ...legacy(), routines: 'morning' }), /invalid/);
});

test('tasks cannot be nested more than one level or parent themselves', () => {
  const tasks = [
    { id: 'parent', title: 'Parent', dueDate: '', dueTime: '', tag: '', completed: false },
    { id: 'child', title: 'Child', dueDate: '', dueTime: '', tag: '', completed: false, parentTaskId: 'parent' },
    { id: 'other', title: 'Other', dueDate: '', dueTime: '', tag: '', completed: false },
  ];
  assert.equal(canSetTaskParent(tasks, 'parent', 'other'), true);
  assert.equal(canSetTaskParent(tasks, 'parent'), true);
  assert.equal(canSetTaskParent(tasks, 'child', 'other'), false);
  assert.equal(canSetTaskParent(tasks, 'parent', 'parent'), false);
  assert.equal(canSetTaskParent(tasks, 'other', 'parent'), false);
});

test('planner reminders resolve wall-clock times across daylight-saving changes', () => {
  assert.equal(
    new Date(resolvePlannerLocalDateTime('2026-11-01', '01:30', 'America/New_York')).toISOString(),
    '2026-11-01T05:30:00.000Z',
  );
  assert.equal(
    new Date(resolvePlannerLocalDateTime('2026-03-08', '02:30', 'America/New_York')).toISOString(),
    '2026-03-08T07:00:00.000Z',
  );
  assert.equal(
    getPlannerDateKeyInTimeZone(new Date('2026-03-08T07:30:00.000Z'), 'America/New_York'),
    '2026-03-08',
  );
  assert.equal(resolvePlannerLocalDateTime('2026-03-08', 'bad', 'America/New_York'), null);
});

test('upcoming reminders preserve occurrence time zones and ignore completed or stale tasks', () => {
  const now = new Date('2026-03-07T12:00:00.000Z');
  const tasks = [
    {
      id: 'dst-task',
      title: 'DST task',
      dueDate: '2026-03-08',
      dueTime: '03:00',
      tag: '',
      completed: false,
      reminder: { minutesBefore: 30, timeZone: 'America/New_York' },
    },
    {
      id: 'done-task',
      title: 'Done task',
      dueDate: '2026-03-08',
      dueTime: '09:00',
      tag: '',
      completed: true,
      reminder: { minutesBefore: 5, timeZone: 'America/New_York' },
    },
    {
      id: 'past-task',
      title: 'Past task',
      dueDate: '2026-03-06',
      dueTime: '09:00',
      tag: '',
      completed: false,
      reminder: { minutesBefore: 5, timeZone: 'America/New_York' },
    },
  ];
  assert.deepEqual(getPlannerReminderInstances(tasks, now), [{
    taskId: 'dst-task',
    occurrenceDate: '2026-03-08',
    title: 'DST task',
    reminderAt: Date.parse('2026-03-08T06:30:00.000Z'),
  }]);
});

test('recurring reminders keep their saved wall-clock time after a daylight-saving shift', () => {
  const instances = getPlannerReminderInstances([{
    id: 'daily',
    title: 'Daily check-in',
    dueDate: '2026-03-07',
    dueTime: '09:00',
    tag: '',
    completed: false,
    recurrence: { frequency: 'daily', timeZone: 'America/New_York' },
    reminder: { minutesBefore: 15, timeZone: 'America/New_York' },
  }], new Date('2026-03-07T12:00:00.000Z'), 1);
  assert.deepEqual(instances.map(({ occurrenceDate, reminderAt }) => [
    occurrenceDate,
    new Date(reminderAt).toISOString(),
  ]), [
    ['2026-03-07', '2026-03-07T13:45:00.000Z'],
    ['2026-03-08', '2026-03-08T12:45:00.000Z'],
  ]);
});
