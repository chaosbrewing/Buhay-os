import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getProjectProgress,
  isTaskComplete,
  mergePlannerData,
  mergePlannerSnapshots,
  normalizePlannerData,
} from './lib/planner-model.ts';
import { getPlannerHabitHistory, getTodayWidgetOrder } from '@workspace/planner-contract';

const legacySnapshot = () => ({
  tasks: [
    { id: 'root', title: 'Prepare launch', dueDate: '2026-10-13', dueTime: '', tag: '', completed: false },
    { id: 'child-a', title: 'Write release notes', dueDate: '2026-10-13', dueTime: '', tag: '', completed: true, projectId: 'launch', parentTaskId: 'root' },
    { id: 'child-b', title: 'Check migration plan', dueDate: '2026-10-13', dueTime: '', tag: '', completed: false, projectId: 'launch', parentTaskId: 'root' },
    { id: 'standalone', title: 'Review copy', dueDate: '2026-10-14', dueTime: '', tag: '', completed: true, projectId: 'launch' },
  ],
  notes: [],
  settings: { theme: 'light', accentHex: '#3b765e' },
});

test('legacy snapshots stay valid without adding empty Release 1 fields', () => {
  const legacy = legacySnapshot();
  const normalized = normalizePlannerData(legacy);
  assert.deepEqual(normalized, legacy);
  assert.equal('projects' in normalized, false);
});

test('web snapshot normalization, backup JSON, and three-way restore retain optional Release 2 data', () => {
  const snapshot = {
    ...legacySnapshot(),
    unknownFutureField: { keep: 'untouched' },
    schemaVersion: 2,
    goals: [{ id: 'goal-r2', title: 'Learn slowly', status: 'active', unknownGoalField: { retained: true } }],
    milestones: [{ id: 'milestone-r2', goalId: 'goal-r2', title: 'First lesson', status: 'active' }],
    lifeAreas: [{ id: 'area-r2', title: 'Learning', status: 'active' }],
    links: [{
      id: 'link-r2',
      source: { type: 'goal', id: 'goal-r2' },
      target: { type: 'project', id: 'launch' },
      createdAt: '2026-10-13T10:00:00Z',
      updatedAt: '2026-10-13T10:00:00Z',
    }],
    reviews: [{
      id: 'review-r2',
      period: 'week',
      startDate: '2026-10-12',
      endDate: '2026-10-18',
      reflection: 'Kept room to rest.',
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:00:00Z',
    }],
  };
  const imported = normalizePlannerData(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(imported, snapshot);
  const restored = normalizePlannerData(JSON.parse(JSON.stringify(imported)));
  assert.deepEqual(restored, snapshot);

  const local = structuredClone(snapshot);
  const remote = structuredClone(snapshot);
  local.goals[0].title = 'Learn a little each day';
  local.goals[0].unknownGoalField.localOnly = true;
  remote.goals[0].title = 'Learn with a teacher';
  remote.reviews[0].reflection = 'Made progress and rested.';
  const merged = mergePlannerSnapshots(snapshot, local, remote, () => 'web-goal-copy');
  assert.equal(merged.goals.length, 2);
  assert.equal(merged.goals[0].unknownGoalField.retained, true);
  assert.equal(merged.goals[1].unknownGoalField.localOnly, true);
  assert.equal(merged.reviews[0].reflection, 'Made progress and rested.');
  assert.deepEqual(merged.links, snapshot.links);
  assert.equal(merged.unknownFutureField.keep, 'untouched');
});

test('web Release 2 routes stay authenticated, feature gated, and locally navigable', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  for (const path of ['/goals', '/life-areas', '/timeline', '/reviews', '/search']) {
    assert.ok(app.includes(`plannerPath('${path}')`), `Missing Release 2 route ${path}`);
  }
  for (const flag of [
    'VITE_RELEASE_TWO_GOALS', 'VITE_RELEASE_TWO_LIFE_AREAS', 'VITE_RELEASE_TWO_LINKS',
    'VITE_RELEASE_TWO_TIMELINE', 'VITE_RELEASE_TWO_REVIEWS', 'VITE_RELEASE_TWO_SEARCH',
  ]) assert.ok(app.includes(flag), `Missing feature flag ${flag}`);
  assert.equal((app.match(/=== 'true'/g) ?? []).length >= 6, true, 'Release 2 flags must require explicit enablement');
  assert.match(app, /if\(!isSignedIn\)return <Redirect to="\/"\/>;return <PlannerApp key=\{userId\}\/>/);
  assert.match(app, /onOpenRecord=\{openPlannerRecord\}/);
  assert.match(app, /recordExists\(data,ref\)/);
});

test('web Today renders only the shared saved widgets in their saved order', () => {
  const order = getTodayWidgetOrder({ todayWidgetOrder: ['habits', 'tasks', 'notes'] });
  assert.deepEqual(order, ['habits', 'tasks', 'notes']);
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(app, /getTodayWidgetOrder\(data\.settings\)\.map/);
  for (const widget of order) assert.ok(app.includes(`data-testid="widget-today-${widget}"`));
});

test('web habit history dates select the date used by completion, skip, and measurable corrections', () => {
  const page = readFileSync(new URL('./pages/ReleaseOnePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /button-habit-history-date-\$\{habit\.id\}-\$\{day\.date\}/);
  assert.match(page, /onToggleHabit\(habit\.id, selectedDate\)/);
  assert.match(page, /onSetHabitProgress\(habit\.id, selectedDate, amount\)/);
  assert.match(page, /onSetHabitSkipped\(habit\.id, selectedDate, !selectedSkipped\)/);
});

test('project progress counts work items, not both a parent and its subtasks', () => {
  const tasks = legacySnapshot().tasks;
  assert.deepEqual(getProjectProgress('launch', tasks), {
    completed: 2,
    total: 3,
    percent: 67,
  });
  assert.equal(isTaskComplete(tasks[0], tasks), false);
  tasks[2].completed = true;
  assert.equal(isTaskComplete(tasks[0], tasks), true);
  assert.deepEqual(getProjectProgress('launch', tasks), {
    completed: 3,
    total: 3,
    percent: 100,
  });
});

test('merge keeps unrelated projects and creates a conflict copy for concurrent edits', () => {
  const base = {
    ...legacySnapshot(),
    projects: [{ id: 'launch', title: 'Launch', description: '', status: 'active' }],
  };
  const local = {
    ...base,
    projects: [{ ...base.projects[0], title: 'Launch checklist' }],
    localMarker: 'kept',
  };
  const remote = {
    ...base,
    projects: [{ ...base.projects[0], description: 'October release' }],
    remoteMarker: 'kept',
  };
  const ids = ['copy-1'];
  const merged = mergePlannerData(base, local, remote, () => ids.shift() ?? 'copy-next');

  assert.equal(merged.projects?.length, 2);
  assert.equal(merged.projects?.[0].description, 'October release');
  assert.equal(merged.projects?.[1].title, 'Conflict copy — Launch checklist');
  assert.equal(merged.localMarker, 'kept');
  assert.equal(merged.remoteMarker, 'kept');
});

test('project progress is zero rather than NaN for an empty project', () => {
  assert.deepEqual(getProjectProgress('empty', []), {
    completed: 0,
    total: 0,
    percent: 0,
  });
});

test('web habit controls expose measurable entry, pause and skip actions, and week history', () => {
  const page = readFileSync(new URL('./pages/ReleaseOnePage.tsx', import.meta.url), 'utf8');
  for (const control of [
    'input-habit-goal',
    'input-habit-unit',
    'input-habit-progress-${habit.id}',
    'button-habit-skip-${habit.id}',
    'button-habit-pause-save-${habit.id}',
    'button-habit-history-previous',
    'history-habit-${habit.id}',
  ]) assert.ok(page.includes(control), `Missing web habit control: ${control}`);
});

test('Today habit widget uses the shared day status and handles measurable and paused habits', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  const widget = app.slice(app.indexOf('data-testid="widget-today-habits"'), app.indexOf("if(widget==='routines')"));
  assert.match(widget, /getPlannerHabitHistory\(habit,today\(\),today\(\)\)\[0\]/);
  assert.match(widget, /setHabitProgress\(habit\.id,today\(\),habit\.measurement!\.goal\)/);
  assert.match(widget, /disabled=\{paused\}/);
  assert.doesNotMatch(widget, /completedDates\.includes\(today\(\)\)/);
});

test('day status reports measurable progress, completion and pauses for the Today widget', () => {
  const habit = {
    id: 'water', title: 'Water', completedDates: [],
    measurement: { goal: 8, unit: 'glasses' },
    progressEntries: [{ date: '2026-10-20', value: 3, changedAt: '2026-10-20T08:00:00.000Z' },
      { date: '2026-10-21', value: 8, changedAt: '2026-10-21T20:00:00.000Z' }],
    pausedRanges: [{ startDate: '2026-10-22' }],
  };
  const [partial, complete, paused] = getPlannerHabitHistory(habit, '2026-10-20', '2026-10-22', '2026-10-22');
  assert.equal(partial.status, 'in-progress');
  assert.equal(partial.value, 3);
  assert.equal(complete.status, 'completed');
  assert.equal(paused.status, 'paused');
});

test('header search results open the exact task or note, not just its page', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  const panel = app.slice(app.indexOf('data-testid="panel-search-results"'));
  assert.match(panel, /openPlannerRecord\(\{type:'task',id:t\.id\}\)/);
  assert.match(panel, /openPlannerRecord\(\{type:'note',id:n\.id\}\)/);
  assert.doesNotMatch(panel.slice(0, panel.indexOf('</div>', panel.indexOf("<h4>Notes</h4>"))), /setLocation\(plannerPath\('\/notes'\)\)/);
});

test('user-facing copy says Buhay.OS, while internal daybook storage keys are preserved', () => {
  for (const file of ['./App.tsx', './CalendarPage.tsx', './pages/ReleaseOnePage.tsx', './pages/ReleaseTwoPage.tsx', './pages/ProjectsPage.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Daybook/, `${file} still shows the old Daybook name`);
  }
  const cache = readFileSync(new URL('./planner-cache.ts', import.meta.url), 'utf8');
  assert.match(cache, /'daybook\.encrypted-cache\.v1'/);
  assert.match(cache, /`daybook\.account-cache\.v2:/);
});
