import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { fromByteArray, toByteArray } from 'base64-js';
import {
  decryptPlannerPayload,
  decryptPlannerPayloadWithKey,
  derivePlannerKey,
  encryptPlannerData,
  parseEncryptedPayload,
} from '../lib/crypto.ts';
import {
  addPlannerTombstone,
  canSetTaskParent,
  convertInboxItemToNote,
  convertInboxItemToTask,
  getTodayWidgetOrder,
  getPlannerHabitHistory,
} from '@workspace/planner-contract';
import { normalizeReleaseTwoData } from '@workspace/planner-contract/release2';
import {
  mergePlannerData,
  parsePlannerData,
  plannerCacheKey,
  summarizePlannerHabit,
} from '../lib/planner-data.ts';

const passphrase = 'buhay-os-cross-runtime-test-passphrase';
test('mobile Today renders the same saved widget visibility and ordering as the web client', () => {
  const order = getTodayWidgetOrder({ todayWidgetOrder: ['habits', 'tasks', 'notes'] });
  assert.deepEqual(order, ['habits', 'tasks', 'notes']);
  const screen = readFileSync(new URL('../app/(app)/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(screen, /widgetOrder\.map/);
  for (const widget of order) assert.ok(screen.includes(`testID="widget-today-${widget}"`));
});

const sample = {
  tasks: [{
    id: 'task-1',
    title: 'Protect the planner snapshot',
    dueDate: '2026-10-12',
    dueTime: '09:30',
    tag: 'private',
    completed: false,
    priority: 'high',
    projectId: 'project-1',
      recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 3], timeZone: 'America/New_York' },
      reminder: { minutesBefore: 15, timeZone: 'America/New_York' },
    futureTaskField: { preserved: true },
  }],
  notes: [{
    id: 'note-1',
    title: 'Private note',
    content: 'This must remain encrypted in storage.',
    date: '2026-10-12',
    tags: ['ideas'],
  }],
  projects: [{
    id: 'project-1',
    title: 'Quiet mornings',
    description: 'A gentler start',
    status: 'active',
  }],
  inbox: [{
    id: 'inbox-1',
    title: 'Ask about the book club',
    content: 'Check if there is room for one more',
    capturedAt: '2026-10-12T08:15:00.000Z',
  }],
  habits: [{
    id: 'habit-1',
    title: 'Take a short walk',
    description: 'Even ten minutes counts',
    completedDates: ['2026-10-11'],
    scheduledDays: [1, 3, 5],
  }],
  routines: [{
    id: 'routine-1',
    title: 'Before bed',
    steps: [
      { id: 'step-1', title: 'Put tomorrow’s notebook out' },
      { id: 'step-2', title: 'Read one page' },
    ],
  }],
  goals: [{ id: 'goal-1', title: 'Make space to learn', targetDate: '2026-12-31', status: 'active' }],
  milestones: [{ id: 'milestone-1', goalId: 'goal-1', title: 'Finish the first course', targetDate: '2026-11-30', status: 'active' }],
  lifeAreas: [{ id: 'area-1', title: 'Learning', colorHex: '#6278c9', status: 'active' }],
  links: [{
    id: 'link-1',
    source: { type: 'goal', id: 'goal-1' },
    target: { type: 'project', id: 'project-1' },
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
  }],
  reviews: [{
    id: 'review-1',
    period: 'week',
    startDate: '2026-10-05',
    endDate: '2026-10-11',
    reflection: 'Keep the plan gentle.',
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
  }],
  settings: { theme: 'light', accentHex: '#3c7760' },
  futureSnapshotField: { keep: 'me' },
};

async function encryptWithWebCrypto(data, secret, salt, iv) {
  const material = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const ciphertext = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(data)),
    ),
  );
  return {
    cryptoVersion: 1,
    kdf: 'PBKDF2-SHA256',
    salt: fromByteArray(salt),
    iv: fromByteArray(iv),
    ciphertext: fromByteArray(ciphertext),
  };
}

test('mobile decrypts a web WebCrypto snapshot without changing the format', async () => {
  const salt = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const iv = Uint8Array.from({ length: 12 }, (_, index) => 100 + index);
  const envelope = await encryptWithWebCrypto(sample, passphrase, salt, iv);
  assert.deepEqual(decryptPlannerPayload(envelope, passphrase), sample);
});

test('an incorrect planner passphrase cannot decrypt the cloud snapshot', () => {
  const salt = new Uint8Array(32).fill(11);
  const iv = new Uint8Array(12).fill(12);
  const key = derivePlannerKey(passphrase, salt);
  const envelope = encryptPlannerData(sample, key, salt, iv);

  assert.throws(
    () => decryptPlannerPayload(envelope, `${passphrase}-incorrect`),
    /passphrase did not unlock this planner snapshot/i,
  );
});

test('web WebCrypto decrypts a mobile AES-GCM snapshot', async () => {
  const salt = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 40);
  const keyBytes = derivePlannerKey(passphrase, salt);
  const envelope = encryptPlannerData(sample, keyBytes, salt, iv);
  assert.equal(JSON.stringify(envelope).includes(sample.tasks[0].title), false);
  assert.equal(JSON.stringify(envelope).includes('America/New_York'), false);
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    toByteArray(envelope.ciphertext),
  );
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), sample);
});

test('the same key decrypts repeated encrypted offline revisions', () => {
  const salt = new Uint8Array(32).fill(7);
  const key = derivePlannerKey(passphrase, salt);
  const envelope = encryptPlannerData(sample, key, salt, new Uint8Array(12).fill(3));
  assert.deepEqual(decryptPlannerPayloadWithKey(envelope, key), sample);
  assert.equal(parseEncryptedPayload(envelope)?.cryptoVersion, 1);
  assert.equal(parseEncryptedPayload({ ...envelope, cryptoVersion: 2 }), null);
});

test('Release 2 records validate and round-trip inside the existing encrypted snapshot format', () => {
  const validated = normalizeReleaseTwoData(sample);
  assert.deepEqual(validated, sample);
  const salt = new Uint8Array(32).fill(18);
  const key = derivePlannerKey(passphrase, salt);
  const envelope = encryptPlannerData(validated, key, salt, new Uint8Array(12).fill(19));
  assert.equal(envelope.cryptoVersion, 1);
  assert.deepEqual(normalizeReleaseTwoData(decryptPlannerPayloadWithKey(envelope, key)), sample);
});

test('snapshot validation and conflict merge preserve unknown and colliding data', () => {
  const remote = structuredClone(sample);
  const local = structuredClone(sample);
  remote.tasks[0].title = 'Cloud copy';
  local.tasks[0].title = 'Offline copy';
  local.tasks.push({
    id: 'task-local',
    title: 'Offline-only task',
    dueDate: '',
    dueTime: '',
    tag: '',
    completed: false,
  });
  local.futureLocalField = 'preserve too';
  let nextId = 0;

  const merged = mergePlannerData(remote, local, () => `conflict-${++nextId}`);
  assert.equal(merged.conflicts, 1);
  assert.equal(merged.data.tasks.length, 3);
  assert.equal(merged.data.tasks[0].title, 'Cloud copy');
  const conflictCopy = merged.data.tasks.find((task) => task.id === 'conflict-1');
  assert.equal(conflictCopy.title, 'Conflict copy — Offline copy');
  assert.equal(conflictCopy.futureTaskField.preserved, true);
  assert.deepEqual(merged.data.futureSnapshotField, { keep: 'me' });
  assert.equal(merged.data.futureLocalField, 'preserve too');
  assert.deepEqual(parsePlannerData(merged.data).notes, remote.notes);
});

test('offline caches are namespaced by account', () => {
  assert.notEqual(plannerCacheKey('account/a'), plannerCacheKey('account-b'));
  assert.match(plannerCacheKey('account/a'), /account%2Fa$/);
});

test('offline conflicts preserve Release 1 collections and each routine’s saved order', () => {
  const remote = structuredClone(sample);
  remote.routines[0].runs = [{
    id: 'remote-run',
    startedAt: '2026-10-12T07:00:00.000Z',
    steps: structuredClone(remote.routines[0].steps),
    completedStepIds: ['step-1'],
  }];
  const local = structuredClone(sample);
  local.routines[0].runs = [{
    id: 'local-run',
    startedAt: '2026-10-13T07:00:00.000Z',
    steps: structuredClone(local.routines[0].steps),
    completedStepIds: ['step-2'],
  }];
  remote.projects[0].description = 'Cloud description';
  local.projects[0].title = 'Offline project edit';
  remote.inbox[0].title = 'Cloud thought';
  local.inbox[0].content = 'Offline detail';
  remote.habits[0].description = 'Cloud habit detail';
  local.habits[0].completedDates.push('2026-10-12');
  remote.routines[0].steps.reverse();
  local.routines[0].steps[0].title = 'Offline routine edit';
  local.routines.push({
    id: 'routine-offline',
    title: 'A second routine',
    steps: [{ id: 'step-offline', title: 'First step' }],
  });
  let nextId = 0;
  const merged = mergePlannerData(remote, local, () => `mobile-conflict-${++nextId}`);

  assert.equal(merged.conflicts, 4);
  assert.equal(merged.data.projects.length, 2);
  assert.equal(merged.data.inbox.length, 2);
  assert.equal(merged.data.habits.length, 2);
  assert.equal(merged.data.routines.length, 3);
  assert.deepEqual(merged.data.routines[0].steps.map((step) => step.id), ['step-2', 'step-1']);
  const routineConflict = merged.data.routines.find((routine) => routine.id === 'mobile-conflict-4');
  assert.deepEqual(routineConflict.steps.map((step) => step.title), ['Offline routine edit', 'Read one page']);
  assert.deepEqual(merged.data.routines[0].runs.map((run) => run.id), ['local-run', 'remote-run']);
  assert.deepEqual(routineConflict.runs.map((run) => run.id), ['local-run', 'remote-run']);
  assert.ok(merged.data.routines.some((routine) => routine.id === 'routine-offline'));
});

test('routine run history remains inside the encrypted planner snapshot', () => {
  const snapshot = structuredClone(sample);
  snapshot.routines[0].runs = [{
    id: 'routine-run',
    startedAt: '2026-10-13T07:00:00.000Z',
    steps: structuredClone(snapshot.routines[0].steps),
    completedStepIds: ['step-1'],
    stepCorrections: [{ stepId: 'step-1', completed: false, changedAt: '2026-10-13T07:30:00.000Z' }],
    deletedAt: '2026-10-13T08:00:00.000Z',
  }];
  const salt = new Uint8Array(32).fill(31);
  const key = derivePlannerKey(passphrase, salt);
  const envelope = encryptPlannerData(snapshot, key, salt, new Uint8Array(12).fill(32));
  assert.deepEqual(decryptPlannerPayloadWithKey(envelope, key), snapshot);
  assert.deepEqual(parsePlannerData(snapshot).routines[0].runs, snapshot.routines[0].runs);
});

test('mobile sync keeps optional habit goals through encryption and offline conflicts', () => {
  const salt = new Uint8Array(32).fill(21);
  const key = derivePlannerKey(passphrase, salt);
  const encrypted = encryptPlannerData(sample, key, salt, new Uint8Array(12).fill(22));
  const decrypted = decryptPlannerPayloadWithKey(encrypted, key);
  assert.deepEqual(decrypted.habits[0].scheduledDays, [1, 3, 5]);
  assert.deepEqual(summarizePlannerHabit({
    completedDates: ['2026-10-12', '2026-10-14'],
    scheduledDays: [1, 3],
  }, '2026-10-15'), {
    completedThisWeek: 2,
    weeklyTarget: 2,
    currentStreak: 2,
    plannedThisWeek: 2,
    pausedThisWeek: 0,
    skippedThisWeek: 0,
    missedThisWeek: 0,
  });

  const oldHabit = { id: 'old-habit', title: 'Read', completedDates: [] };
  const oldSnapshot = parsePlannerData({ ...sample, habits: [oldHabit] });
  assert.deepEqual(oldSnapshot.habits[0], oldHabit);

  const remote = structuredClone(sample);
  remote.habits[0].completedDates = ['2026-10-12'];
  const local = structuredClone(sample);
  local.habits[0].weeklyTarget = 4;
  delete local.habits[0].scheduledDays;
  const merged = mergePlannerData(remote, local, () => 'mobile-habit-goal-copy');
  assert.equal(merged.conflicts, 1);
  assert.deepEqual(merged.data.habits[0].completedDates, ['2026-10-12']);
  const localCopy = merged.data.habits.find((habit) => habit.id === 'mobile-habit-goal-copy');
  assert.equal(localCopy.weeklyTarget, 4);
  assert.equal(localCopy.scheduledDays, undefined);
});

test('mobile encrypted snapshots retain all optional Release 2 collections and merge link tombstones', () => {
  const oldSnapshot = parsePlannerData({
    tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3c7760' }, unknownOldClientField: true,
  });
  assert.equal('goals' in oldSnapshot, false);
  assert.equal(oldSnapshot.unknownOldClientField, true);

  const salt = new Uint8Array(32).fill(41);
  const key = derivePlannerKey(passphrase, salt);
  const parsed = parsePlannerData(sample);
  const encrypted = encryptPlannerData(parsed, key, salt, new Uint8Array(12).fill(42));
  const opened = parsePlannerData(decryptPlannerPayloadWithKey(encrypted, key));
  for (const collection of ['goals', 'milestones', 'lifeAreas', 'links', 'reviews']) {
    assert.deepEqual(opened[collection], sample[collection]);
  }
  assert.equal(JSON.stringify(encrypted).includes('Make space to learn'), false);

  const remote = structuredClone(sample);
  const local = structuredClone(sample);
  remote.goals[0].title = 'Make time to learn';
  remote.goals[0].futureGoalField = { fromRemote: true };
  local.goals[0].title = 'Learn with care';
  local.goals[0].futureGoalField = { fromLocal: true };
  local.links[0].removedAt = '2026-10-13T12:00:00Z';
  local.links[0].updatedAt = local.links[0].removedAt;
  let nextId = 0;
  const merged = mergePlannerData(remote, local, () => `r2-mobile-conflict-${++nextId}`);
  assert.equal(merged.data.goals.length, 2);
  assert.deepEqual(merged.data.goals.find((goal) => goal.id === 'goal-1').futureGoalField, { fromRemote: true });
  const copy = merged.data.goals.find((goal) => goal.id === 'r2-mobile-conflict-1');
  assert.equal(copy.title, 'Conflict copy — Learn with care');
  assert.deepEqual(copy.futureGoalField, { fromLocal: true });
  assert.equal(merged.data.links[0].removedAt, '2026-10-13T12:00:00Z');
  assert.equal(JSON.stringify(merged.data).includes('unknownOldClientField'), false);
});

test('measurable progress, pause, skip, and history stay inside encrypted snapshots', () => {
  const advanced = {
    ...sample,
    habits: [{
      ...sample.habits[0],
      measurement: { goal: 8, unit: 'glasses' },
      progressEntries: [{ date: '2026-10-12', value: 6, changedAt: '2026-10-12T20:00:00Z' }],
      completionEntries: [{ date: '2026-10-12', completed: false, changedAt: '2026-10-12T20:00:00Z' }],
      pausedRanges: [{ startDate: '2026-10-13', endDate: '2026-10-14', changedAt: '2026-10-12T21:00:00Z' }],
      skippedDates: ['2026-10-15'],
      skipEntries: [{ date: '2026-10-15', skipped: true, changedAt: '2026-10-15T08:00:00Z' }],
    }],
  };
  const salt = new Uint8Array(32).fill(25);
  const key = derivePlannerKey(passphrase, salt);
  const encrypted = encryptPlannerData(advanced, key, salt, new Uint8Array(12).fill(26));
  assert.deepEqual(Object.keys(encrypted).sort(), ['ciphertext', 'cryptoVersion', 'iv', 'kdf', 'salt']);
  const serializedPayload = JSON.stringify(encrypted);
  assert.equal(serializedPayload.includes(advanced.habits[0].title), false);
  assert.equal(serializedPayload.includes('2026-10-15'), false);
  assert.equal(serializedPayload.includes('glasses'), false);
  assert.equal(serializedPayload.includes('progressEntries'), false);
  assert.equal(serializedPayload.includes('completionEntries'), false);
  assert.deepEqual(decryptPlannerPayloadWithKey(encrypted, key), advanced);
  const history = getPlannerHabitHistory(advanced.habits[0], '2026-10-12', '2026-10-15', '2026-10-15');
  assert.deepEqual(history.map((day) => day.status), ['in-progress', 'paused', 'paused', 'skipped']);
});

test('mobile habit screen exposes matching measurable, pause, skip, and weekly-history controls', () => {
  const screen = readFileSync(new URL('../app/(app)/(tabs)/organize.tsx', import.meta.url), 'utf8');
  for (const control of [
    'mobile-habit-goal',
    'mobile-habit-unit',
    'mobile-habit-progress-${habit.id}',
    'mobile-habit-skip-${habit.id}',
    'mobile-habit-pause-save-${habit.id}',
    'mobile-habit-history-previous',
    'mobile-habit-history-${habit.id}',
    'mobile-habit-history-date-${habit.id}-${entry.date}',
    'mobile-toggle-habit-${habit.id}',
    'mobile-selected-habit-date-${habit.id}',
  ]) assert.ok(screen.includes(control), `Missing mobile habit control: ${control}`);
});

test('Inbox converts once into a task or note without dropping captured context', () => {
  const taskSnapshot = convertInboxItemToTask(sample, 'inbox-1', {
    id: 'task-from-inbox',
    title: sample.inbox[0].title,
    description: sample.inbox[0].content,
    dueDate: '',
    dueTime: '',
    tag: '',
    completed: false,
    priority: 'normal',
  });
  assert.equal(taskSnapshot.inbox.length, 0);
  assert.equal(taskSnapshot.tasks[0].description, sample.inbox[0].content);

  const noteSnapshot = convertInboxItemToNote(sample, 'inbox-1', {
    id: 'note-from-inbox',
    title: sample.inbox[0].title,
    content: sample.inbox[0].content,
    date: '2026-10-12',
    tags: [],
  });
  assert.equal(noteSnapshot.inbox.length, 0);
  assert.equal(noteSnapshot.notes[0].content, sample.inbox[0].content);
  assert.throws(() => convertInboxItemToNote(noteSnapshot, 'inbox-1', {
    id: 'duplicate',
    title: 'Duplicate',
    content: '',
    date: '',
    tags: [],
  }), /no longer available/);
});

test('offline mobile deletion tombstones prevent converted captures from reappearing after a merge', () => {
  const converted = convertInboxItemToNote(sample, 'inbox-1', {
    id: 'note-from-inbox',
    title: sample.inbox[0].title,
    content: sample.inbox[0].content,
    date: '2026-10-12',
    tags: [],
  });
  const merged = mergePlannerData(sample, converted, () => 'unused-conflict');
  assert.equal(merged.data.inbox.length, 0);
  assert.equal(merged.data.notes.find((note) => note.id === 'note-from-inbox').content, sample.inbox[0].content);
  assert.equal(merged.data.deletedRecords[0].id, 'inbox-1');

  const deletedHabit = {
    ...addPlannerTombstone(sample, 'habits', sample.habits[0]),
    habits: [],
  };
  const mergeDeleted = mergePlannerData(sample, deletedHabit, () => 'unused-conflict');
  assert.equal(mergeDeleted.data.habits.length, 0);
});

test('deletion markers travel only inside the encrypted offline snapshot', () => {
  const deleted = {
    ...addPlannerTombstone(sample, 'inbox', sample.inbox[0]),
    inbox: [],
  };
  const salt = new Uint8Array(32).fill(31);
  const key = derivePlannerKey(passphrase, salt);
  const encrypted = encryptPlannerData(deleted, key, salt, new Uint8Array(12).fill(19));
  assert.deepEqual(decryptPlannerPayloadWithKey(encrypted, key), deleted);
  assert.equal(JSON.stringify(encrypted).includes('Ask about the book club'), false);
});

test('mobile task relationships remain one level deep', () => {
  assert.equal(canSetTaskParent(sample.tasks, 'task-1', 'task-child'), true);
  const childTasks = [
    ...sample.tasks,
    { id: 'task-child', title: 'Child', dueDate: '', dueTime: '', tag: '', completed: false, parentTaskId: 'task-1' },
  ];
  assert.equal(canSetTaskParent(childTasks, 'task-child', 'task-grandchild'), false);
  assert.equal(canSetTaskParent(childTasks, 'task-1', 'task-1'), false);
});
