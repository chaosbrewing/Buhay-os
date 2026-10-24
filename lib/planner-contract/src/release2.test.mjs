import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RELEASE_TWO_FEATURE_FLAGS,
  buildPlannerTimeline,
  findBrokenPlannerLinks,
  getGoalProgress,
  getMilestoneProgress,
  linkPlannerRecords,
  markReleaseTwoDataUsed,
  normalizeReleaseTwoData,
  plannerLinkId,
  plannerLinksFor,
  recordExists,
  repairPlannerLink,
  saveLifeReview,
  searchPlannerRecords,
  summarizeLifePeriod,
  unlinkPlannerRecord,
} from './release2.ts';
import {
  mergeReleaseTwoData,
  mergeReleaseTwoSnapshots,
} from './release2-merge.ts';

const legacy = () => ({
  tasks: [],
  notes: [],
  settings: { theme: 'light', accentHex: '#3b765e' },
  unknownField: { retained: true },
});

test('legacy planner shape stays unchanged until a Release 2 record is used', () => {
  const data = legacy();
  assert.deepEqual(normalizeReleaseTwoData(data), data);
  assert.equal('goals' in normalizeReleaseTwoData(data), false);
  assert.equal('schemaVersion' in normalizeReleaseTwoData(data), false);
  assert.equal(markReleaseTwoDataUsed(data).schemaVersion, 2);
  assert.deepEqual(markReleaseTwoDataUsed({ ...data, schemaVersion: 3 }).schemaVersion, 3);
});

test('optional Release 2 collections validate and retain unknown future fields', () => {
  const extended = {
    ...legacy(),
    goals: [{ id: 'g1', title: 'Learn piano', status: 'active' }],
    milestones: [{ id: 'm1', goalId: 'g1', title: 'Play one song', targetDate: '2026-11-01', status: 'active' }],
    lifeAreas: [{ id: 'a1', title: 'Learning', status: 'active', colorHex: '#aabbcc' }],
    links: [],
    reviews: [],
    futureReleaseField: { untouched: true },
  };
  assert.deepEqual(normalizeReleaseTwoData(extended), extended);
  assert.throws(() => normalizeReleaseTwoData({ ...extended, goals: [{ id: 'g2', title: ' ', status: 'active' }] }), /goals collection/);
  assert.throws(() => normalizeReleaseTwoData({ ...extended, links: [{ id: 'bad', source: { type: 'password', id: 'x' }, target: { type: 'task', id: 't' }, createdAt: '2026-10-13' }] }), /links collection/);
});

test('record references stay account-local, symmetric, stable, and navigable', () => {
  const data = {
    ...legacy(),
    projects: [{ id: 'p1', title: 'Garden', description: '', status: 'active' }],
    goals: [{ id: 'g1', title: 'Grow herbs', status: 'active' }],
  };
  const goal = { type: 'goal', id: 'g1' };
  const project = { type: 'project', id: 'p1' };
  const first = linkPlannerRecords(data, goal, project, '2026-10-13T10:00:00.000Z');
  const second = linkPlannerRecords(first, project, goal, '2026-10-13T11:00:00.000Z');
  assert.equal(first.links[0].id, plannerLinkId(project, goal));
  assert.equal(second.links.length, 1);
  assert.deepEqual(plannerLinksFor(second, goal), plannerLinksFor(second, project));
  assert.equal(recordExists(second, { type: 'goal', id: 'not-in-this-snapshot' }), false);
  assert.throws(() => linkPlannerRecords(data, goal, { type: 'project', id: 'other-account-id' }, '2026-10-13T10:00:00Z'), /must still exist/);
});

test('unlink is safe and broken references can be explicitly repaired', () => {
  const data = {
    ...legacy(),
    goals: [{ id: 'g1', title: 'Write a book', status: 'active' }],
    projects: [{ id: 'p1', title: 'Draft', description: '', status: 'active' }],
    tasks: [{ id: 't1', title: 'Outline chapter', dueDate: '', dueTime: '', tag: '', completed: false }],
  };
  const linked = linkPlannerRecords(data, { type: 'goal', id: 'g1' }, { type: 'project', id: 'p1' }, '2026-10-13T10:00:00Z');
  const linkId = linked.links[0].id;
  const unlinked = unlinkPlannerRecord(linked, linkId, '2026-10-13T11:00:00Z');
  assert.equal(plannerLinksFor(unlinked, { type: 'goal', id: 'g1' }).length, 0);
  assert.equal(findBrokenPlannerLinks(unlinked).length, 0);
  const broken = { ...linked, projects: [] };
  assert.equal(findBrokenPlannerLinks(broken).length, 1);
  const repaired = repairPlannerLink(
    broken,
    linkId,
    { type: 'goal', id: 'g1' },
    { type: 'task', id: 't1' },
    '2026-10-13T12:00:00Z',
  );
  assert.equal(repaired.links.filter((link) => !link.removedAt).length, 1);
  assert.equal(repaired.links.find((link) => !link.removedAt).target.type, 'task');
});

test('relinking a tombstoned record relationship preserves unknown link metadata', () => {
  const data = {
    ...legacy(),
    goals: [{ id: 'g1', title: 'Write a book', status: 'active' }],
    projects: [{ id: 'p1', title: 'Draft', description: '', status: 'active' }],
    links: [{
      id: plannerLinkId({ type: 'goal', id: 'g1' }, { type: 'project', id: 'p1' }),
      source: { type: 'goal', id: 'g1' },
      target: { type: 'project', id: 'p1' },
      createdAt: '2026-10-13T10:00:00Z',
      updatedAt: '2026-10-13T10:00:00Z',
      removedAt: '2026-10-13T11:00:00Z',
      futureLinkField: { preserved: true },
    }],
  };
  const restored = linkPlannerRecords(
    data,
    { type: 'goal', id: 'g1' },
    { type: 'project', id: 'p1' },
    '2026-10-13T12:00:00Z',
  );
  assert.equal(restored.links.length, 1);
  assert.equal('removedAt' in restored.links[0], false);
  assert.deepEqual(restored.links[0].futureLinkField, { preserved: true });
});

test('goal and milestone progress counts verified work once, including one-level subtasks', () => {
  const data = {
    ...legacy(),
    goals: [{ id: 'g1', title: 'Ship a garden bed', status: 'active' }],
    milestones: [{ id: 'm1', goalId: 'g1', title: 'Prepare the plan', status: 'active' }],
    projects: [{ id: 'p1', title: 'Build bed', description: '', status: 'active' }],
    tasks: [
      { id: 'parent', title: 'Build frame', dueDate: '', dueTime: '', tag: '', completed: false, projectId: 'p1' },
      { id: 'child1', title: 'Measure boards', dueDate: '', dueTime: '', tag: '', completed: true, projectId: 'p1', parentTaskId: 'parent' },
      { id: 'child2', title: 'Cut boards', dueDate: '', dueTime: '', tag: '', completed: false, projectId: 'p1', parentTaskId: 'parent' },
      { id: 'other', title: 'Buy soil', dueDate: '', dueTime: '', tag: '', completed: true },
    ],
  };
  let linked = linkPlannerRecords(data, { type: 'goal', id: 'g1' }, { type: 'milestone', id: 'm1' }, '2026-10-13T10:00:00Z');
  linked = linkPlannerRecords(linked, { type: 'milestone', id: 'm1' }, { type: 'project', id: 'p1' }, '2026-10-13T10:00:00Z');
  const withWork = linkPlannerRecords(linked, { type: 'milestone', id: 'm1' }, { type: 'task', id: 'child1' }, '2026-10-13T10:00:00Z');
  const milestoneProgress = getMilestoneProgress(withWork, 'm1');
  assert.deepEqual(milestoneProgress, { completed: 1, total: 2, percent: 50 });
  assert.deepEqual(getGoalProgress(withWork, 'g1'), milestoneProgress);
});

test('timeline uses saved date keys, deduplicates habit dates, and does not invent legacy completion times', () => {
  const data = {
    ...legacy(),
    tasks: [
      { id: 't1', title: 'Call back', dueDate: '2026-10-13', dueTime: '09:30', tag: '', completed: true },
      { id: 't2', title: 'Old task', dueDate: '', dueTime: '', tag: '', completed: true },
    ],
    notes: [{ id: 'n1', title: 'Thought', content: 'A note', date: '2026-10-13', tags: [] }],
    habits: [{ id: 'h1', title: 'Walk', completedDates: ['2026-10-13', '2026-10-13', 'bad-date'] }],
    goals: [{ id: 'g1', title: 'Learn', status: 'active' }],
    milestones: [{ id: 'm1', goalId: 'g1', title: 'First lesson', targetDate: '2026-10-13', status: 'active' }],
  };
  const entries = buildPlannerTimeline(data, '2026-10-13', '2026-10-13');
  assert.deepEqual(entries.map((entry) => entry.type).sort(), ['habit', 'milestone', 'note', 'task']);
  assert.equal(entries.find((entry) => entry.id === 'task:t1').time, '09:30');
  assert.equal(entries.some((entry) => entry.id === 'task:t2'), false);
  assert.equal(buildPlannerTimeline(data, '2026-10-14', '2026-10-15').length, 0);
  assert.throws(() => buildPlannerTimeline(data, '2026-10-15', '2026-10-14'), /date range/);
});

test('period summary reports known task state without creating a performance score', () => {
  const data = {
    ...legacy(),
    tasks: [
      { id: 'done', title: 'Done', dueDate: '2026-10-13', dueTime: '', tag: '', completed: true },
      { id: 'open', title: 'Open', dueDate: '2026-10-14', dueTime: '', tag: '', completed: false },
    ],
    habits: [{ id: 'h1', title: 'Read', completedDates: ['2026-10-13'] }],
    notes: [{ id: 'n1', title: 'Review note', content: '', date: '2026-10-13', tags: [] }],
  };
  assert.deepEqual(summarizeLifePeriod(data, '2026-10-13', '2026-10-14'), {
    tasks: { completed: 1, unfinished: 1, total: 2 },
    habitCompletions: 1,
    milestones: 0,
    notes: 1,
  });
});

test('local search covers planner modules, ranks titles first, and respects filters', () => {
  const data = {
    ...legacy(),
    tasks: [{ id: 't1', title: 'Project planning', description: '', dueDate: '', dueTime: '', tag: '', completed: false }],
    notes: [{ id: 'n1', title: 'A thought', content: 'Project planning details', date: '', tags: [] }],
    goals: [{ id: 'g1', title: 'Project planning', status: 'active' }],
  };
  const results = searchPlannerRecords(data, 'project planning');
  assert.deepEqual(results.slice(0, 2).map((result) => result.ref.type), ['task', 'goal']);
  assert.equal(results[2].ref.type, 'note');
  assert.equal(searchPlannerRecords(data, 'project planning', 'note')[0].ref.id, 'n1');
  assert.deepEqual(searchPlannerRecords(data, 'missing'), []);
  assert.equal(RELEASE_TWO_FEATURE_FLAGS.unifiedSearch, true);
});

test('three-way Release 2 merge preserves independent records and labels concurrent edits', () => {
  const base = {
    ...legacy(),
    schemaVersion: 2,
    goals: [{ id: 'g1', title: 'Write', status: 'active' }],
    lifeAreas: [{ id: 'a1', title: 'Learning', status: 'active' }],
  };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.goals[0].title = 'Write a book';
  local.lifeAreas.push({ id: 'a2', title: 'Home', status: 'active' });
  remote.goals[0].title = 'Write a collection';
  remote.milestones = [{ id: 'm1', goalId: 'g1', title: 'Draft', status: 'active' }];
  const ids = ['local-goal-copy'];
  const merged = mergeReleaseTwoSnapshots(base, local, remote, () => ids.shift());
  assert.equal(merged.goals.length, 2);
  assert.equal(merged.goals[0].title, 'Write a collection');
  assert.equal(merged.goals[1].title, 'Conflict copy — Write a book');
  assert.equal(merged.lifeAreas.length, 2);
  assert.equal(merged.milestones[0].id, 'm1');
  assert.equal(merged.schemaVersion, 2);
});

test('offline merge uses the newest link state and preserves concurrent same-ID edits', () => {
  const base = {
    ...legacy(),
    goals: [{ id: 'g1', title: 'Build a garden', status: 'active' }],
    tasks: [{ id: 't1', title: 'Choose a site', dueDate: '', dueTime: '', tag: '', completed: false }],
  };
  const active = linkPlannerRecords(base, { type: 'goal', id: 'g1' }, { type: 'task', id: 't1' }, '2026-10-13T10:00:00Z');
  const unlinked = unlinkPlannerRecord(active, active.links[0].id, '2026-10-13T12:00:00Z');
  const mergedLink = mergeReleaseTwoData(active, unlinked, () => 'unexpected-copy');
  assert.equal(mergedLink.data.links[0].removedAt, '2026-10-13T12:00:00Z');
  assert.equal(mergedLink.conflicts, 0);

  const remote = structuredClone(base);
  const local = structuredClone(base);
  remote.goals[0].title = 'Build a garden slowly';
  local.goals[0].title = 'Build a garden this year';
  const mergedRecords = mergeReleaseTwoData(remote, local, () => 'offline-goal-copy');
  assert.equal(mergedRecords.data.goals.length, 2);
  assert.equal(mergedRecords.data.goals[1].title, 'Conflict copy — Build a garden this year');
  assert.equal(mergedRecords.conflicts, 1);
});

test('reviews are stored as optional encrypted-snapshot content and upsert by stable ID', () => {
  const initial = legacy();
  const review = {
    id: 'week:2026-10-12',
    period: 'week',
    startDate: '2026-10-12',
    endDate: '2026-10-18',
    reflection: 'Made time to rest.',
    createdAt: '2026-10-18T10:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
  };
  const saved = saveLifeReview(initial, review);
  const updated = saveLifeReview(saved, { ...review, reflection: 'Made time to rest and read.', updatedAt: '2026-10-18T11:00:00Z' });
  assert.equal(updated.reviews.length, 1);
  assert.equal(updated.reviews[0].reflection, 'Made time to rest and read.');
  assert.equal(updated.schemaVersion, 2);
  assert.equal(RELEASE_TWO_FEATURE_FLAGS.goalsAndMilestones, true);
});
