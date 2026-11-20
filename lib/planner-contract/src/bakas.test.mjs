import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MEMORIES,
  MAX_MEMORY_LENGTH,
  MAX_MEMORY_REVISIONS,
  correctMemory,
  createMemory,
  deleteMemory,
  keepMemoryAfterRevocation,
  listMemories,
  normalizeBakasData,
  recordMemoryAccess,
  retrieveMemories,
  revokeMemorySource,
} from './bakas.ts';
import { grantCapability, revokeCapabilityGrant } from './ugnay.ts';
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

const T = (minute) => `2026-10-26T10:${String(minute).padStart(2, '0')}:00.000Z`;
const MANUAL = { type: 'manual' };
const CALENDAR = { type: 'connected', app: 'Google Calendar', ref: 'event-9', capturedAt: T(0) };

const remember = (data, text, extra = {}, makeId = ids('r'), now = T(1)) => createMemory(data, {
  text, kind: 'fact', verification: 'user-confirmed', source: MANUAL, ...extra,
}, now, makeId);

const withGrant = (data, capability, makeId = ids('g')) =>
  grantCapability(data, { capability, scopes: ['memory.read'], purpose: 'Use my memories when I plan' }, T(0), makeId).data;

test('older snapshots load unchanged and have no memories until one is saved', () => {
  const data = normalizeBakasData(legacy());
  assert.deepEqual(data, legacy());
  assert.equal('memories' in data, false);
  assert.deepEqual(listMemories(legacy()), []);
  assert.deepEqual(retrieveMemories(legacy(), { capability: 'ikaw', query: 'anything' }), { allowed: false, missing: ['memory.read'], memories: [] });
});

test('saving a memory records its source and time, an audit entry without its text, and nothing else changes', () => {
  const makeId = ids('r');
  const { data, memory } = createMemory(legacy(), {
    text: '  I prefer morning flights  ', kind: 'preference', verification: 'user-confirmed', source: MANUAL,
  }, T(1), makeId);
  assert.deepEqual(memory, {
    id: 'r-1', text: 'I prefer morning flights', kind: 'preference', verification: 'user-confirmed',
    source: { type: 'manual' }, sensitivity: 'normal', createdAt: T(1), updatedAt: T(1),
  });
  assert.deepEqual(data.memories, [memory]);
  assert.equal(data.schemaVersion, 3);
  assert.deepEqual(data.tasks, legacy().tasks);
  assert.deepEqual(data.unknownField, { retained: true });
  const event = data.auditEvents.at(-1);
  assert.deepEqual([event.actor, event.action, event.subjectIds], ['user', 'memory.created', ['r-1']]);
  assert.equal(JSON.stringify(data.auditEvents).includes('morning flights'), false, 'the audit log must never hold memory text');

  const source = { type: 'planner', ref: { type: 'task', id: 't1' }, capturedAt: T(0) };
  const fromPlanner = remember(legacy(), 'Pack boxes before the 1st', { source, verification: 'source-verified' });
  source.ref.id = 'changed';
  assert.equal(fromPlanner.memory.source.ref.id, 't1', 'the saved source is a copy');
  assert.equal(fromPlanner.memory.verification, 'source-verified');
});

test('a guess can never pass as a fact: invalid combinations and bad input are rejected and change nothing', () => {
  const before = JSON.stringify(legacy());
  const bad = [
    [{ text: '   ' }, /needs some text/],
    [{ text: 'x'.repeat(MAX_MEMORY_LENGTH + 1) }, /at most 1000 characters/],
    [{ kind: 'rumour' }, /fact, a preference or an interpretation/],
    [{ verification: 'ai-interpretation' }, /AI interpretation must be saved as an interpretation/],
    [{ kind: 'interpretation', verification: 'source-verified', source: CALENDAR }, /confirmed by you, but not verified by a source/],
    [{ verification: 'source-verified' }, /source-verified if it has a source other than you/],
    [{ source: { type: 'connected', app: 'Google Calendar' } }, /connected source needs the app name and the time/],
    [{ source: { type: 'planner', ref: { type: 'nonsense', id: 'x' }, capturedAt: T(0) } }, /planner source needs a record/],
    [{ source: { type: 'telepathy' } }, /not supported/],
    [{ sensitivity: 'secret' }, /normal or private/],
  ];
  for (const [change, message] of bad) {
    assert.throws(() => remember(legacy(), 'A thing', change), message, JSON.stringify(change));
  }
  assert.equal(JSON.stringify(legacy()), before);
  // The allowed ways to hold an AI guess: labelled as one, or confirmed by the user.
  assert.doesNotThrow(() => remember(legacy(), 'Seems to like early starts', { kind: 'interpretation', verification: 'ai-interpretation' }));
  assert.doesNotThrow(() => remember(legacy(), 'Likes early starts', { kind: 'interpretation', verification: 'user-confirmed' }));
});

test('there is a limit on memories, and a colliding id is replaced rather than overwriting', () => {
  const full = {
    ...legacy(),
    memories: Array.from({ length: MAX_MEMORIES }, (_, i) => ({
      id: `m${i}`, text: `Memory ${i}`, kind: 'fact', verification: 'user-confirmed', source: MANUAL,
      sensitivity: 'normal', createdAt: T(0), updatedAt: T(0),
    })),
  };
  assert.throws(() => remember(full, 'One too many'), /up to 2000 memories/);
  const afterDelete = deleteMemory(full, 'm0', T(2), ids('d'));
  assert.doesNotThrow(() => remember(afterDelete, 'Room again'));

  const sequence = ['dup', 'dup', 'fresh', 'audit-1'];
  const first = remember(legacy(), 'First', {}, () => 'dup');
  const second = createMemory(first.data, { text: 'Second', kind: 'fact', verification: 'user-confirmed', source: MANUAL }, T(2), () => sequence.shift());
  assert.deepEqual(second.data.memories.map((memory) => memory.id), ['dup', 'fresh']);
  assert.equal(second.data.memories[0].text, 'First');
});

test('correcting a memory keeps the earlier wording and makes the user the one who vouches for it', () => {
  const makeId = ids('c');
  const guess = remember(legacy(), 'Probably likes early starts', { kind: 'interpretation', verification: 'ai-interpretation' }, makeId, T(1));
  const corrected = correctMemory(guess.data, guess.memory.id, { text: '  Likes starting at 6am  ' }, T(5), makeId);
  const [memory] = corrected.memories;
  assert.equal(memory.text, 'Likes starting at 6am');
  assert.equal(memory.verification, 'user-confirmed');
  assert.equal(memory.kind, 'interpretation');
  assert.equal(memory.updatedAt, T(5));
  assert.equal(memory.createdAt, T(1));
  assert.deepEqual(memory.revisions, [{
    text: 'Probably likes early starts', kind: 'interpretation', verification: 'ai-interpretation', sensitivity: 'normal', changedAt: T(1),
  }]);
  assert.equal(corrected.auditEvents.at(-1).action, 'memory.corrected');

  const asFact = correctMemory(corrected, memory.id, { kind: 'fact' }, T(6), makeId);
  assert.equal(asFact.memories[0].kind, 'fact');
  assert.equal(asFact.memories[0].revisions.length, 2);

  // Only changing who may see it leaves who confirmed it alone.
  const hidden = correctMemory(guess.data, guess.memory.id, { sensitivity: 'private' }, T(7), makeId);
  assert.equal(hidden.memories[0].verification, 'ai-interpretation');
  assert.equal(hidden.memories[0].sensitivity, 'private');

  assert.deepEqual(correctMemory(corrected, memory.id, { text: 'Likes starting at 6am' }, T(8), makeId), corrected, 'no change, no new version');
  assert.throws(() => correctMemory(corrected, memory.id, { text: '  ' }, T(8), makeId), /needs some text/);
  assert.throws(() => correctMemory(corrected, 'missing', { text: 'x' }, T(8), makeId), /no longer exists/);
});

test('only the newest earlier versions are kept', () => {
  const makeId = ids('c');
  let data = remember(legacy(), 'Version 0', {}, makeId, T(0)).data;
  const id = data.memories[0].id;
  for (let i = 1; i <= MAX_MEMORY_REVISIONS + 5; i += 1) {
    data = correctMemory(data, id, { text: `Version ${i}` }, T(i), makeId);
  }
  const { revisions, text } = data.memories[0];
  assert.equal(text, `Version ${MAX_MEMORY_REVISIONS + 5}`);
  assert.equal(revisions.length, MAX_MEMORY_REVISIONS);
  assert.equal(revisions.at(-1).text, `Version ${MAX_MEMORY_REVISIONS + 4}`);
  assert.equal(revisions[0].text, 'Version 5');
});

test('deleting a memory erases its text and every earlier version, leaving only a marker', () => {
  const makeId = ids('d');
  let data = remember(legacy(), 'My landlord is Mr Reyes', {}, makeId, T(1)).data;
  const id = data.memories[0].id;
  data = correctMemory(data, id, { text: 'My landlord is Ms Reyes' }, T(2), makeId);
  const deleted = deleteMemory(data, id, T(3), makeId);
  assert.deepEqual(deleted.memories, [{ id, deletedAt: T(3) }]);
  const everything = JSON.stringify(deleted);
  for (const secret of ['Mr Reyes', 'Ms Reyes', 'landlord']) assert.equal(everything.includes(secret), false, secret);
  assert.deepEqual(listMemories(deleted), []);
  assert.equal(deleted.auditEvents.at(-1).action, 'memory.deleted');
  assert.deepEqual(deleteMemory(deleted, id, T(4), makeId), deleted, 'deleting twice changes nothing');
  assert.throws(() => deleteMemory(deleted, 'missing', T(4), makeId), /no longer exists/);
  assert.throws(() => correctMemory(deleted, id, { text: 'x' }, T(4), makeId), /no longer exists/);
  assert.throws(() => normalizeBakasData({ ...legacy(), memories: [{ id, deletedAt: T(3), text: 'still here' }] }), /must not keep any content/);
});

test('a disconnected source cuts its memories off from other capabilities until the user chooses to keep them', () => {
  const makeId = ids('s');
  let data = withGrant(legacy(), 'ikaw');
  data = remember(data, 'Dentist on Friday at 9am', { source: CALENDAR, verification: 'source-verified' }, makeId, T(1)).data;
  data = remember(data, 'Dentist is Dr Cruz', {}, makeId, T(1)).data;
  data = remember(data, 'Dentist reminder from another app', { source: { ...CALENDAR, app: 'Other Calendar' }, verification: 'source-verified' }, makeId, T(1)).data;
  const [calendarMemory] = data.memories;
  assert.equal(retrieveMemories(data, { capability: 'ikaw', query: 'dentist' }).memories.length, 3);

  const revoked = revokeMemorySource(data, { app: 'Google Calendar' }, T(5), makeId);
  assert.deepEqual(revoked.memories.filter((memory) => memory.sourceRevokedAt).map((memory) => memory.id), [calendarMemory.id]);
  assert.equal(revoked.memories.find((memory) => memory.id === calendarMemory.id).updatedAt, T(5));
  assert.equal(revoked.auditEvents.at(-1).action, 'memory.source.revoked');
  assert.deepEqual(revoked.auditEvents.at(-1).subjectIds, [calendarMemory.id]);
  assert.deepEqual(revokeMemorySource(revoked, { app: 'Google Calendar' }, T(6), makeId), revoked, 'nothing new to revoke');
  assert.equal(revokeMemorySource(legacy(), { app: 'Nope' }, T(6), makeId).memories, undefined);

  // The user still sees it, other capabilities don't.
  assert.equal(listMemories(revoked).length, 3);
  const seen = retrieveMemories(revoked, { capability: 'ikaw', query: 'dentist' }).memories.map((memory) => memory.text);
  assert.deepEqual(seen.sort(), ['Dentist is Dr Cruz', 'Dentist reminder from another app']);

  assert.throws(() => keepMemoryAfterRevocation(revoked, data.memories[1].id, T(7), makeId), /has not been disconnected/);
  const kept = keepMemoryAfterRevocation(revoked, calendarMemory.id, T(7), makeId);
  const keptMemory = kept.memories.find((memory) => memory.id === calendarMemory.id);
  assert.deepEqual([keptMemory.verification, keptMemory.keptAt, keptMemory.sourceRevokedAt], ['user-confirmed', T(7), T(5)]);
  assert.equal(keptMemory.source.app, 'Google Calendar', 'where it came from is never rewritten');
  assert.equal(keptMemory.revisions.at(-1).verification, 'source-verified');
  assert.equal(retrieveMemories(kept, { capability: 'ikaw', query: 'dentist' }).memories.length, 3);
  assert.deepEqual(keepMemoryAfterRevocation(kept, calendarMemory.id, T(8), makeId), kept);
  assert.equal(kept.auditEvents.at(-1).action, 'memory.kept');
});

test('another capability gets nothing without an active grant, and only what it is allowed to see', () => {
  const makeId = ids('q');
  let data = legacy();
  for (const [text, extra] of [
    ['I prefer morning flights', { kind: 'preference' }],
    ['Flights to Cebu are cheaper on Tuesdays', {}],
    ['Doctor flights test results are private', { sensitivity: 'private' }],
    ['Gusto ko ng kape sa umaga', {}],
    ['Lives near Cañete', {}],
    ['Old flights note', {}],
  ]) data = remember(data, text, extra, makeId, T(Math.min(59, data.memories?.length ?? 0) + 1)).data;
  data = deleteMemory(data, data.memories.at(-1).id, T(30), makeId);

  const denied = retrieveMemories(data, { capability: 'ikaw', query: 'flights' });
  assert.deepEqual(denied, { allowed: false, missing: ['memory.read'], memories: [] });

  const granted = withGrant(data, 'ikaw');
  const flights = retrieveMemories(granted, { capability: 'ikaw', query: 'flights' });
  assert.equal(flights.allowed, true);
  // Both match one word; the more recently saved one comes first.
  assert.deepEqual(flights.memories.map((memory) => memory.text), ['Flights to Cebu are cheaper on Tuesdays', 'I prefer morning flights']);
  assert.equal(flights.memories.some((memory) => /private|Doctor|Old flights/.test(memory.text)), false, 'private and deleted memories never come back');
  assert.deepEqual(Object.keys(flights.memories[0]).sort(), ['id', 'kind', 'source', 'text', 'updatedAt', 'verification']);

  assert.deepEqual(retrieveMemories(granted, { capability: 'ikaw', query: 'KAPE' }).memories.map((memory) => memory.text), ['Gusto ko ng kape sa umaga']);
  assert.deepEqual(retrieveMemories(granted, { capability: 'ikaw', query: 'cañete' }).memories.length, 1);
  assert.deepEqual(retrieveMemories(granted, { capability: 'ikaw', query: 'mor' }).memories.map((memory) => memory.text), ['I prefer morning flights']);
  assert.equal(retrieveMemories(granted, { capability: 'ikaw', query: 'the and of' }).memories.length, 0, 'filler words match nothing');
  assert.deepEqual(retrieveMemories(granted, { capability: 'ikaw' }), { allowed: true, missing: [], memories: [] }, 'no browsing without something to look for');
  assert.equal(retrieveMemories(granted, { capability: 'ikaw', query: 'flights', limit: 1 }).memories.length, 1);

  // Grants are per capability and can be taken back.
  assert.equal(retrieveMemories(granted, { capability: 'bakas', query: 'flights' }).allowed, false);
  for (const capability of ['tuklas', 'planner']) {
    assert.deepEqual(retrieveMemories(granted, { capability, query: 'flights' }), { allowed: false, missing: ['memory.read'], memories: [] });
  }
  const grantId = granted.capabilityGrants[0].id;
  const taken = revokeCapabilityGrant(granted, grantId, T(40), makeId);
  assert.equal(retrieveMemories(taken, { capability: 'ikaw', query: 'flights' }).allowed, false);
  assert.equal(listMemories(taken).length, 5, 'the user still sees all of their own, private ones included');
});

test('memories saved from a planner record are found when that record is the subject', () => {
  const makeId = ids('l');
  const source = { type: 'planner', ref: { type: 'task', id: 't1' }, capturedAt: T(0) };
  let data = withGrant(legacy(), 'bakas');
  data = remember(data, 'Boxes are in the garage', { source, verification: 'source-verified' }, makeId).data;
  data = remember(data, 'Tape is in the drawer', {}, makeId).data;
  assert.deepEqual(retrieveMemories(data, { capability: 'bakas', relatedTo: [{ type: 'task', id: 't1' }] }).memories.map((memory) => memory.text), ['Boxes are in the garage']);
  assert.deepEqual(retrieveMemories(data, { capability: 'bakas', relatedTo: [{ type: 'task', id: 'other' }] }).memories, []);
  const both = retrieveMemories(data, { capability: 'bakas', query: 'tape', relatedTo: [{ type: 'task', id: 't1' }] });
  assert.deepEqual(both.memories.map((memory) => memory.text), ['Boxes are in the garage', 'Tape is in the drawer']);
});

test('looking is free, using is logged: retrieval changes nothing and the access log holds ids only', () => {
  const makeId = ids('a');
  let data = withGrant(legacy(), 'ikaw');
  const saved = remember(data, 'Allergic to peanuts', {}, makeId);
  data = saved.data;
  const before = JSON.stringify(data);
  const found = retrieveMemories(data, { capability: 'ikaw', query: 'peanuts' });
  assert.equal(JSON.stringify(data), before);
  const used = recordMemoryAccess(data, 'ikaw', found.memories.map((memory) => memory.id), T(9), makeId);
  const event = used.auditEvents.at(-1);
  assert.deepEqual([event.actor, event.action, event.subjectIds], ['ikaw', 'memory.accessed', [saved.memory.id]]);
  assert.equal(JSON.stringify(used.auditEvents).includes('peanuts'), false);
  assert.deepEqual(recordMemoryAccess(data, 'ikaw', [], T(9), makeId), data);
});

test('invalid memory data is rejected without echoing the memory', () => {
  const memory = { id: 'm1', text: 'SECRET-TEXT-XYZ', kind: 'fact', verification: 'user-confirmed', source: MANUAL, sensitivity: 'normal', createdAt: T(0), updatedAt: T(0) };
  assert.doesNotThrow(() => normalizeBakasData({ ...legacy(), memories: [memory] }));
  const broken = [
    { ...memory, kind: 'rumour' },
    { ...memory, verification: 'ai-interpretation' },
    { ...memory, sourceRevokedAt: T(1) },
    { ...memory, source: CALENDAR, verification: 'source-verified', keptAt: T(1) },
    { ...memory, revisions: [{ text: '', kind: 'fact', verification: 'user-confirmed', sensitivity: 'normal', changedAt: T(0) }] },
    { ...memory, createdAt: 'yesterday' },
  ];
  for (const entry of broken) {
    assert.throws(() => normalizeBakasData({ ...legacy(), memories: [entry] }), (error) => /memories collection is invalid/.test(error.message) && !error.message.includes('SECRET-TEXT-XYZ'));
  }
  assert.throws(() => normalizeBakasData({ ...legacy(), memories: [memory, memory] }), /duplicate IDs/);
  assert.throws(() => normalizeBakasData({ ...legacy(), memories: 'nope' }), /memories collection is invalid/);
});

// ------------------------------------------------------------------- merging

const twoDevices = () => {
  const base = remember(legacy(), 'The lease ends in January', {}, ids('base'), T(1));
  return { base: base.data, id: base.memory.id };
};

const bothWays = (base, a, b, makeId = ids('m')) => [
  mergeReleaseTwoData(b, a, makeId).data,
  mergeReleaseTwoData(a, b, makeId).data,
  mergeReleaseTwoSnapshots(base, a, b, makeId),
  mergeReleaseTwoSnapshots(base, b, a, makeId),
];

test('a deletion on one device is final, even against a newer edit on another', () => {
  const { base, id } = twoDevices();
  const deviceA = deleteMemory(base, id, T(5), ids('a'));
  const deviceB = correctMemory(base, id, { text: 'The lease ends on 31 January' }, T(9), ids('b'));
  for (const merged of bothWays(base, deviceA, deviceB)) {
    assert.deepEqual(merged.memories, [{ id, deletedAt: T(5) }]);
    const everything = JSON.stringify(merged);
    assert.equal(everything.includes('lease'), false, 'no copy of the deleted text survives the merge');
  }
});

test('edits on two devices converge: the newest wording wins and the other is kept as history, in any order', () => {
  const { base, id } = twoDevices();
  const deviceA = correctMemory(base, id, { text: 'The lease ends 31 Jan' }, T(5), ids('a'));
  const deviceB = correctMemory(base, id, { text: 'The lease ends 1 Feb' }, T(6), ids('b'));
  const merged = bothWays(base, deviceA, deviceB);
  for (const result of merged) {
    const [memory] = result.memories;
    assert.equal(memory.text, 'The lease ends 1 Feb');
    assert.deepEqual(memory.revisions.map((revision) => revision.text), ['The lease ends in January', 'The lease ends 31 Jan']);
  }
  assert.deepEqual(merged[0].memories, merged[1].memories);
  assert.deepEqual(merged[2].memories, merged[3].memories);
  assert.deepEqual(merged[0].memories, merged[2].memories);
});

test('a disconnected source stays disconnected, and keeping a memory sticks, whichever copy is newer', () => {
  const makeId = ids('s');
  const saved = remember(legacy(), 'Gym class on Wednesday', { source: CALENDAR, verification: 'source-verified' }, makeId, T(1));
  const base = saved.data;
  const id = saved.memory.id;
  const deviceA = revokeMemorySource(base, { app: 'Google Calendar' }, T(3), ids('a'));
  const deviceB = correctMemory(base, id, { sensitivity: 'private' }, T(8), ids('b')); // newer, but never saw the disconnect
  for (const merged of bothWays(base, deviceA, deviceB)) {
    const [memory] = merged.memories;
    assert.equal(memory.sourceRevokedAt, T(3), 'an older, unaware copy cannot undo the disconnect');
    assert.equal(memory.sensitivity, 'private');
  }
  const kept = keepMemoryAfterRevocation(deviceA, id, T(6), ids('k'));
  for (const merged of bothWays(deviceA, kept, deviceA)) {
    assert.equal(merged.memories[0].keptAt, T(6));
    assert.equal(merged.memories[0].verification, 'user-confirmed');
  }
});

test('memories saved on different devices are all kept, with grants and drafts merged alongside', () => {
  const base = withGrant(legacy(), 'ikaw', ids('base'));
  const grantId = base.capabilityGrants[0].id;
  const deviceA = remember(revokeCapabilityGrant(base, grantId, T(4), ids('a')), 'Only vegetarian food', {}, ids('mem-a'), T(5)).data;
  const deviceB = remember(base, 'Wakes at 6am', {}, ids('mem-b'), T(6)).data;
  for (const merged of bothWays(base, deviceA, deviceB)) {
    assert.deepEqual(merged.memories.map((memory) => memory.text), ['Only vegetarian food', 'Wakes at 6am']);
    assert.equal(merged.capabilityGrants[0].revokedAt, T(4), 'UGNAY data still merges');
    assert.equal(retrieveMemories(merged, { capability: 'ikaw', query: 'vegetarian' }).allowed, false);
    assert.equal(merged.auditEvents.filter((event) => event.action === 'memory.created').length, 2);
    assert.equal(merged.schemaVersion, 3);
  }
});

test('snapshots without memories merge exactly as before and gain none', () => {
  const makeId = ids('n');
  const local = { ...legacy(), notes: [{ id: 'n1', title: 'Local', content: '', tags: [], date: '2026-10-26' }] };
  for (const merged of [mergeReleaseTwoData(legacy(), local, makeId).data, mergeReleaseTwoSnapshots(legacy(), local, legacy(), makeId)]) {
    assert.equal('memories' in merged, false);
    assert.deepEqual(merged.notes.map((note) => note.id), ['n1']);
  }
});

test('the history kept for one memory stays within its limit after a merge', () => {
  const makeId = ids('h');
  let data = remember(legacy(), 'Version 0', {}, makeId, T(0)).data;
  const id = data.memories[0].id;
  let deviceA = data;
  let deviceB = data;
  for (let i = 1; i <= MAX_MEMORY_REVISIONS; i += 1) {
    deviceA = correctMemory(deviceA, id, { text: `A${i}` }, T(i), ids(`a${i}`));
    deviceB = correctMemory(deviceB, id, { text: `B${i}` }, T(i + 20), ids(`b${i}`));
  }
  const [merged] = bothWays(data, deviceA, deviceB);
  assert.equal(merged.memories[0].text, `B${MAX_MEMORY_REVISIONS}`);
  assert.equal(merged.memories[0].revisions.length, MAX_MEMORY_REVISIONS);
});
