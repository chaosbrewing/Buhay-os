import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOURNAL_DAYS,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_REVISIONS,
  MAX_JOURNAL_TEXT,
  createJournalCollection,
  createJournalEntry,
  deleteJournalEntry,
  isJournalTombstone,
  journalChapters,
  journalDayFor,
  journalDayStatus,
  journalPrompt,
  journalPromptId,
  keepDeletedJournalEntries,
  listJournalEntries,
  localDateIn,
  markHandwritten,
  mergeJournalCollections,
  normalizeJournalData,
  paperPageFor,
  updateJournalEntry,
} from './journal.ts';
import { JOURNAL_PROMPTS_V0_1 } from './journal-prompts.ts';
import { createMemory, deleteMemory } from './bakas.ts';

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
const T = (minute, day = 26) => `2026-10-${String(day).padStart(2, '0')}T10:${String(minute).padStart(2, '0')}:00.000Z`;

/** A planner with a journal that starts on 2026-01-01 (a non-leap start) in Manila time. */
const started = (start = '2026-01-01', timeZone = 'Asia/Manila') => {
  const { data, collection } = createJournalCollection(legacy(), { startLocalDate: start, timeZone }, T(0), ids('c'));
  return { data, collection };
};

const write = (data, collection, localDate, fields = {}, makeId = ids('e'), now = T(1)) =>
  createJournalEntry(data, { collectionInstanceId: collection.id, localDate, ...fields }, now, makeId);

// ---------------------------------------------------------------- prompts

test('all 365 prompts are present, numbered, unique, non-empty and in the declared chapters', () => {
  assert.equal(JOURNAL_PROMPTS_V0_1.length, JOURNAL_DAYS);
  JOURNAL_PROMPTS_V0_1.forEach((prompt, index) => {
    assert.equal(prompt.day, index + 1);
    assert.ok(prompt.prompt.trim().length > 0);
    assert.ok(prompt.theme.trim().length > 0);
  });
  assert.equal(new Set(JOURNAL_PROMPTS_V0_1.map((prompt) => prompt.prompt.toLowerCase())).size, JOURNAL_DAYS);
  assert.deepEqual(journalChapters().map((chapter) => chapter.lastDay - chapter.firstDay + 1), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.deepEqual(JOURNAL_PROMPTS_V0_1.filter((prompt) => prompt.milestone).map((prompt) => prompt.day), [30, 100, 180, 250, 300, 365]);
  assert.equal(journalPrompt(42).prompt, 'What interruption turned out better than expected?');
  assert.equal(journalPromptId(42), '365-days-of-me:v0.1:042');
  assert.equal(journalPrompt(42, '9.9'), null, 'an unknown prompt version gives no question instead of a wrong one');
});

// ------------------------------------------------------------- day mapping

test('day N is the calendar-day difference from the start plus one, and page N is day N', () => {
  assert.deepEqual(journalDayFor('2026-01-01', '2026-01-01'), { status: 'active', dayNumber: 1, paperPage: 1 });
  assert.deepEqual(journalDayFor('2026-01-01', '2026-02-11'), { status: 'active', dayNumber: 42, paperPage: 42 });
  assert.equal(journalDayFor('2026-01-01', '2026-12-31').dayNumber, 365);
  assert.deepEqual(journalDayFor('2026-01-01', '2027-01-01'), { status: 'cycle-complete' });
  assert.deepEqual(journalDayFor('2026-01-02', '2026-01-01'), { status: 'before-start' });
  for (const day of [1, 42, 365]) assert.equal(paperPageFor(day), day);
  assert.throws(() => paperPageFor(0));
  assert.throws(() => paperPageFor(366));
  assert.throws(() => paperPageFor(1.5));
});

test('leap days and a non-January start still count exact calendar days', () => {
  // 2027-03-01 is Day 366 after a 2026 start: cycle complete. A 2028 start crosses 29 February.
  assert.equal(journalDayFor('2028-02-28', '2028-02-29').dayNumber, 2);
  assert.equal(journalDayFor('2028-02-28', '2028-03-01').dayNumber, 3);
  // A leap-year journal started 1 Jan 2028 has 366 calendar days; Day 365 is 30 December and 31 December is past the cycle.
  assert.equal(journalDayFor('2028-01-01', '2028-12-30').dayNumber, 365);
  assert.equal(journalDayFor('2028-01-01', '2028-12-31').status, 'cycle-complete');
  // Starting mid-year: Day 1 is the chosen date, whatever it is.
  assert.equal(journalDayFor('2026-07-15', '2026-07-15').dayNumber, 1);
  assert.equal(journalDayFor('2026-07-15', '2027-07-14').dayNumber, 365);
  assert.equal(journalDayFor('2026-07-15', '2027-07-15').status, 'cycle-complete');
});

test('daylight saving changes cannot shift a day number', () => {
  // US spring-forward (2026-03-08) and fall-back (2026-11-01) days have 23 and 25 hours.
  assert.equal(journalDayFor('2026-03-07', '2026-03-08').dayNumber, 2);
  assert.equal(journalDayFor('2026-03-07', '2026-03-09').dayNumber, 3);
  assert.equal(journalDayFor('2026-10-31', '2026-11-01').dayNumber, 2);
  assert.equal(journalDayFor('2026-10-31', '2026-11-02').dayNumber, 3);
  // The date itself is read in the journal's time zone: the same instant is two different calendar dates.
  const instant = '2026-11-01T20:00:00.000Z';
  assert.equal(localDateIn('Asia/Manila', instant), '2026-11-02');
  assert.equal(localDateIn('America/Los_Angeles', instant), '2026-11-01');
  assert.throws(() => localDateIn('Not/AZone', instant));
});

test('impossible dates are rejected, never rolled over', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', 'yesterday', '2026-02-29']) {
    assert.throws(() => journalDayFor('2026-01-01', bad), /valid calendar date/);
  }
  assert.throws(() => createJournalCollection(legacy(), { startLocalDate: '2026-02-30', timeZone: 'Asia/Manila' }, T(0), ids()), /start date/);
  assert.throws(() => createJournalCollection(legacy(), { startLocalDate: '2026-01-01', timeZone: 'Mars/Base' }, T(0), ids()), /time zone/);
});

// ------------------------------------------------------------------- entries

test('a saved entry reopens identically, and every field except the date is optional', () => {
  const { data: base, collection } = started();
  const { data: empty, entry: bare } = write(base, collection, '2026-02-11');
  assert.equal(bare.dayNumber, 42);
  assert.equal(bare.promptId, '365-days-of-me:v0.1:042');
  assert.equal(bare.modality, 'digital');
  for (const field of ['title', 'body', 'todayInMyLife', 'promptResponse', 'smallMoment', 'tomorrowThought', 'mood']) {
    assert.equal(field in bare, false, `${field} is left out, not stored empty`);
  }
  assert.equal(listJournalEntries(empty).length, 1);

  const fields = {
    title: 'A quiet one',
    todayInMyLife: 'Rain, rice, and an unexpected call.',
    promptResponse: 'The call that ran long.',
    smallMoment: 'Steam on the window.',
    tomorrowThought: 'Write back to Ana.',
    body: 'Free writing — with "quotes", émojis 🌧️ and\nline breaks.',
    mood: { label: 'Calm', emoji: '🌧️' },
  };
  const { data, entry } = write(base, collection, '2026-02-12', fields, ids('f'));
  const roundTripped = JSON.parse(JSON.stringify(data));
  assert.deepEqual(normalizeJournalData(roundTripped).journalEntries.at(-1), entry);
  assert.deepEqual(listJournalEntries(roundTripped, { month: '2026-02' }).map((e) => e.localDate), ['2026-02-12']);
  assert.equal(listJournalEntries(roundTripped).at(0).body, fields.body);
});

test('skipping days and writing late never shifts a date, a day number or a page', () => {
  const { data: base, collection } = started();
  const { data: a } = write(base, collection, '2026-02-11', { body: 'Day 42 as it happened' }, ids('a'));
  // Day 18 is written long after Day 42, and Day 41 was never written.
  const { data: b, entry: late } = write(a, collection, '2026-01-18', { body: 'Catching up' }, ids('b'), T(5, 30));
  assert.equal(late.dayNumber, 18);
  assert.equal(paperPageFor(late.dayNumber), 18);
  const day42 = listJournalEntries(b).find((entry) => entry.localDate === '2026-02-11');
  assert.equal(day42.dayNumber, 42);
  assert.equal(journalDayStatus(b, collection.id, '2026-02-10'), 'not_recorded');
  // Editing an old day later keeps its identity.
  const edited = updateJournalEntry(b, late.id, { body: 'Catching up, rewritten' }, T(9, 31));
  const again = listJournalEntries(edited).find((entry) => entry.id === late.id);
  assert.deepEqual([again.localDate, again.dayNumber, again.promptId], ['2026-01-18', 18, '365-days-of-me:v0.1:018']);
  assert.equal(again.createdAt, late.createdAt);
  assert.equal(again.updatedAt, T(9, 31));
});

test('dates outside the journal are refused with a plain message', () => {
  const { data, collection } = started();
  assert.throws(() => write(data, collection, '2025-12-31'), /before this journal starts/);
  assert.throws(() => write(data, collection, '2027-01-01'), /complete/);
  assert.throws(() => createJournalEntry(data, { collectionInstanceId: 'nope', localDate: '2026-01-02' }, T(1), ids()), /does not exist/);
});

test('marking a page handwritten invents no text', () => {
  const { data: base, collection } = started();
  const data = markHandwritten(base, { collectionInstanceId: collection.id, localDate: '2026-02-11' }, T(1), ids('h'));
  const [entry] = listJournalEntries(data);
  assert.equal(entry.modality, 'handwritten');
  assert.equal(entry.dayNumber, 42);
  for (const field of ['title', 'body', 'todayInMyLife', 'promptResponse', 'smallMoment', 'tomorrowThought', 'mood']) {
    assert.equal(field in entry, false);
  }
  assert.equal(journalDayStatus(data, collection.id, '2026-02-11'), 'handwritten');
  // With a typed entry on the same date it becomes "both", and the typed text is untouched.
  const { data: typed } = write(base, collection, '2026-02-12', { body: 'Typed words' }, ids('t'));
  const both = markHandwritten(typed, { collectionInstanceId: collection.id, localDate: '2026-02-12' }, T(2), ids('x'));
  assert.equal(journalDayStatus(both, collection.id, '2026-02-12'), 'both');
  assert.equal(listJournalEntries(both)[0].body, 'Typed words');
  // Marking again changes nothing.
  assert.deepEqual(markHandwritten(both, { collectionInstanceId: collection.id, localDate: '2026-02-12' }, T(3), ids('y')), both);
});

test('whitespace-only text is treated as blank and does not block a save', () => {
  const { data: base, collection } = started();
  const { entry } = write(base, collection, '2026-01-05', { body: '   \n ', title: '' });
  assert.equal('body' in entry, false);
  assert.equal('title' in entry, false);
});

test('entry text is limited to 50,000 characters in total, and the limit is not enforced by cutting text off', () => {
  const { data: base, collection } = started();
  const ok = write(base, collection, '2026-01-05', { body: 'x'.repeat(MAX_JOURNAL_TEXT) });
  assert.equal(ok.entry.body.length, MAX_JOURNAL_TEXT);
  assert.throws(() => write(base, collection, '2026-01-06', { body: 'x'.repeat(MAX_JOURNAL_TEXT + 1) }), /at most 50000 characters/);
  assert.throws(() => write(base, collection, '2026-01-06', { body: 'x'.repeat(40_000), smallMoment: 'y'.repeat(10_001) }), /at most 50000 characters/);
  assert.throws(() => write(base, collection, '2026-01-06', { title: 't'.repeat(201) }), /title/);
  assert.throws(() => updateJournalEntry(ok.data, ok.entry.id, { smallMoment: 'one more' }, T(2)), /at most 50000 characters/);
  // The failed edit left the saved text exactly as it was.
  assert.equal(listJournalEntries(ok.data)[0].body.length, MAX_JOURNAL_TEXT);
});

test('there is a limit on live entries', () => {
  const { data: base, collection } = started();
  const full = {
    ...base,
    journalEntries: Array.from({ length: MAX_JOURNAL_ENTRIES }, (_, i) => ({
      id: `e${i}`, collectionInstanceId: collection.id, localDate: '2026-01-02', dayNumber: 2,
      promptId: journalPromptId(2), modality: 'digital', createdAt: T(0), updatedAt: T(0),
    })),
  };
  assert.throws(() => write(full, collection, '2026-01-03'), /up to 5000/);
});

// --------------------------------------------------------- earlier copies

test('editing keeps the earlier content as a recoverable copy, at most five', () => {
  const { data: base, collection } = started();
  let { data, entry } = write(base, collection, '2026-01-10', { body: 'v0', mood: { label: 'Tired' } });
  for (let i = 1; i <= 8; i += 1) data = updateJournalEntry(data, entry.id, { body: `v${i}` }, T(i));
  const [now] = listJournalEntries(data);
  assert.equal(now.body, 'v8');
  assert.equal(now.revisions.length, MAX_JOURNAL_REVISIONS);
  assert.deepEqual(now.revisions.map((revision) => revision.body), ['v3', 'v4', 'v5', 'v6', 'v7']);
  assert.deepEqual(now.revisions[0].mood, { label: 'Tired' });
  // An edit that changes nothing is not an edit.
  assert.deepEqual(updateJournalEntry(data, entry.id, { body: 'v8' }, T(30)), data);
  // Clearing a field is remembered too.
  const cleared = updateJournalEntry(data, entry.id, { mood: null, body: null }, T(31));
  const [after] = listJournalEntries(cleared);
  assert.equal('body' in after, false);
  assert.equal('mood' in after, false);
  assert.equal(after.revisions.at(-1).body, 'v8');
});

// ------------------------------------------------------------- tombstones

test('deleting erases all content, including earlier copies, and leaves only a marker', () => {
  const { data: base, collection } = started();
  let { data, entry } = write(base, collection, '2026-01-10', { body: 'SECRET-TEXT', smallMoment: 'SECRET-MOMENT' });
  data = updateJournalEntry(data, entry.id, { body: 'SECRET-TEXT-2' }, T(2));
  const deleted = deleteJournalEntry(data, entry.id, T(3));
  assert.deepEqual(deleted.journalEntries, [{ id: entry.id, deletedAt: T(3) }]);
  assert.equal(JSON.stringify(deleted).includes('SECRET'), false);
  assert.deepEqual(listJournalEntries(deleted), []);
  assert.equal(journalDayStatus(deleted, collection.id, '2026-01-10'), 'not_recorded');
  assert.deepEqual(deleteJournalEntry(deleted, entry.id, T(9)), deleted, 'deleting twice is a no-op');
  assert.throws(() => updateJournalEntry(deleted, entry.id, { body: 'back' }, T(9)), /no longer exists/);
  assert.throws(() => deleteJournalEntry(data, 'missing', T(9)), /no longer exists/);
  // A tombstone that kept content is rejected on load.
  assert.throws(() => normalizeJournalData({ ...deleted, journalEntries: [{ id: entry.id, deletedAt: T(3), body: 'x' }] }), /must not keep any content/);
});

test('a stale copy cannot bring a deleted entry back through a merge', () => {
  const { data: base, collection } = started();
  const { data: both, entry } = write(base, collection, '2026-01-10', { body: 'keep me out' });
  const deletedHere = deleteJournalEntry(both, entry.id, T(5));
  const editedThere = updateJournalEntry(both, entry.id, { body: 'edited on another device' }, T(9));
  for (const copies of [[both, deletedHere, editedThere], [editedThere, both, deletedHere], [deletedHere, editedThere, both]]) {
    const { journalEntries } = mergeJournalCollections(copies);
    assert.deepEqual(journalEntries, [{ id: entry.id, deletedAt: T(5) }]);
  }
  assert.equal(isJournalTombstone(mergeJournalCollections([deletedHere, both]).journalEntries[0]), true);
});

test('restoring a stale backup keeps entries and memories deleted since the backup', () => {
  const { data: base, collection } = started();
  const { data: backup, entry } = write(base, collection, '2026-01-10', { body: 'DELETE-ME-TEXT' });
  const { data: withKeeper, entry: keeper } = write(backup, collection, '2026-01-11', { body: 'KEEP' }, ids('k'));
  const current = deleteJournalEntry(withKeeper, entry.id, T(7));
  const restored = keepDeletedJournalEntries(withKeeper, current);
  assert.deepEqual(restored.journalEntries.find((record) => record.id === entry.id), { id: entry.id, deletedAt: T(7) });
  assert.equal(restored.journalEntries.find((record) => record.id === keeper.id).body, 'KEEP');
  assert.equal(JSON.stringify(restored).includes('DELETE-ME-TEXT'), false);
  // A deletion the backup has never heard of is kept too.
  const onlyCurrent = keepDeletedJournalEntries({ ...base }, current);
  assert.deepEqual(onlyCurrent.journalEntries, [{ id: entry.id, deletedAt: T(7) }]);
  // Nothing deleted: the backup is returned untouched.
  assert.equal(keepDeletedJournalEntries(backup, backup), backup);
  // The memory safeguard from BAKAS still works alongside it.
  const { data: remembered, memory } = createMemory(backup, { text: 'M', kind: 'fact', verification: 'user-confirmed', source: { type: 'manual' } }, T(1), ids('m'));
  const forgotten = deleteMemory(remembered, memory.id, T(2), ids('a'));
  assert.deepEqual(forgotten.memories, [{ id: memory.id, deletedAt: T(2) }]);
  assert.equal(normalizeJournalData(forgotten).journalEntries.length, 1);
});

// ------------------------------------------------------ conflicts (option A)

test('two offline edits of one entry never lose one: the newer wins, the older is kept', () => {
  const { data: base, collection } = started();
  const { data: shared, entry } = write(base, collection, '2026-01-12', { body: 'Original', mood: { label: 'Okay' } });
  const phone = updateJournalEntry(shared, entry.id, { body: 'Phone edit' }, T(10));
  const laptop = updateJournalEntry(shared, entry.id, { body: 'Laptop edit', mood: { label: 'Happy' } }, T(20));
  const results = [[shared, phone, laptop], [laptop, shared, phone], [phone, laptop, shared]]
    .map((copies) => mergeJournalCollections(copies).journalEntries);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2], 'the result does not depend on the order of the copies');
  const [merged] = results[0];
  assert.equal(merged.body, 'Laptop edit');
  const kept = merged.revisions.map((revision) => revision.body);
  assert.ok(kept.includes('Phone edit'), 'the losing edit is recoverable');
  assert.ok(kept.includes('Original'));
  assert.equal(merged.createdAt, entry.createdAt);
  assert.ok(merged.revisions.length <= MAX_JOURNAL_REVISIONS);
  assert.deepEqual(normalizeJournalData({ ...shared, journalEntries: results[0] }).journalEntries, results[0]);
});

test('merging keeps entries created independently on two devices, including two for the same date', () => {
  const { data: base, collection } = started();
  const phone = write(base, collection, '2026-01-12', { body: 'from phone' }, ids('p')).data;
  const laptop = write(base, collection, '2026-01-12', { body: 'from laptop' }, ids('l')).data;
  const { journalEntries } = mergeJournalCollections([phone, laptop]);
  assert.deepEqual(journalEntries.map((entry) => entry.body).sort(), ['from laptop', 'from phone']);
  // The user's archive shows both, and the date still counts as recorded.
  const both = { ...phone, journalEntries };
  assert.equal(listJournalEntries(both, { collectionInstanceId: collection.id }).length, 2);
  assert.equal(journalDayStatus(both, collection.id, '2026-01-12'), 'digital');
});

test('merge does not touch a copy that has no journal, and never treats a missing entry as a deletion', () => {
  const { data: withJournal, collection } = started();
  const { data: withEntry, entry } = write(withJournal, collection, '2026-01-12', { body: 'still here' });
  const olderClient = legacy(); // never heard of the journal
  assert.deepEqual(mergeJournalCollections([olderClient, olderClient]), {});
  const merged = mergeJournalCollections([withEntry, olderClient]);
  assert.equal(merged.journalEntries.length, 1);
  assert.equal(merged.journalEntries[0].body, 'still here');
  assert.equal(merged.journalCollections.length, 1);
  // A copy where the entry is simply absent doesn't remove it.
  const emptied = { ...withEntry, journalEntries: [] };
  assert.equal(mergeJournalCollections([withEntry, emptied]).journalEntries[0].id, entry.id);
});

test('a journal\'s start date and time zone cannot be changed by a merge', () => {
  const { data, collection } = started('2026-01-01', 'Asia/Manila');
  const tampered = { ...data, journalCollections: [{ ...collection, startLocalDate: '2026-03-03', createdAt: T(40) }] };
  const { journalCollections } = mergeJournalCollections([tampered, data]);
  assert.equal(journalCollections.length, 1);
  assert.equal(journalCollections[0].startLocalDate, '2026-01-01', 'the earliest-created copy is the original');
});

// ---------------------------------------------------------- compatibility

test('older snapshots load unchanged and gain no empty journal until one is used', () => {
  const data = normalizeJournalData(legacy());
  assert.equal('journalCollections' in data, false);
  assert.equal('journalEntries' in data, false);
  assert.deepEqual(listJournalEntries(legacy()), []);
  assert.equal(journalDayStatus(legacy(), 'any', '2026-01-01'), 'not_recorded');
  const { data: started1 } = started();
  assert.equal('journalEntries' in started1, false, 'starting a journal does not add an empty entries list');
  assert.deepEqual(started1.unknownField, { retained: true });
  assert.equal(started1.tasks[0].title, 'Pack boxes');
});

test('unknown fields on entries and elsewhere survive a round trip and an edit', () => {
  const { data: base, collection } = started();
  const { data, entry } = write(base, collection, '2026-01-12', { body: 'hello' });
  const future = {
    ...data,
    futureFeature: { keep: 1 },
    journalEntries: data.journalEntries.map((record) => ({ ...record, futureField: 'from a newer app' })),
  };
  const edited = updateJournalEntry(JSON.parse(JSON.stringify(future)), entry.id, { body: 'hello again' }, T(3));
  assert.deepEqual(edited.futureFeature, { keep: 1 });
  assert.equal(edited.journalEntries[0].futureField, 'from a newer app');
});

test('malformed journal data is rejected without echoing any journal text', () => {
  const { data: base, collection } = started();
  const { data, entry } = write(base, collection, '2026-01-12', { body: 'PRIVATE-WORDS' });
  const broken = (patch) => ({ ...data, journalEntries: [{ ...data.journalEntries[0], ...patch }] });
  for (const patch of [
    { localDate: '2026-02-30' }, { dayNumber: 0 }, { dayNumber: 366 }, { dayNumber: 1.5 }, { promptId: 'x' },
    { promptId: journalPromptId(7) }, { modality: 'telepathy' }, { createdAt: 'yesterday' }, { body: 123 },
    { mood: { label: '' } }, { revisions: 'no' }, { collectionInstanceId: '' },
  ]) {
    assert.throws(() => normalizeJournalData(broken(patch)), (error) => /journal entries are invalid/.test(error.message) && !error.message.includes('PRIVATE-WORDS'));
  }
  assert.throws(() => normalizeJournalData({ ...data, journalEntries: [entry, entry] }), /duplicate/);
  assert.throws(() => normalizeJournalData({ ...data, journalEntries: 'x' }), /invalid/);
  assert.throws(() => normalizeJournalData({ ...data, journalCollections: [{ ...collection, collectionId: 'other' }] }), /not supported/);
  assert.throws(() => normalizeJournalData({ ...data, journalCollections: [collection, collection] }), /duplicate/);
  assert.throws(() => normalizeJournalData({ ...data, journalCollections: [{ ...collection, timeZone: 'Mars/Base' }] }), /time zone/);
});

test('a journal contains nothing that points at an AI provider or another app', () => {
  const { data: base, collection } = started();
  const { data } = write(base, collection, '2026-01-12', { body: 'hi' });
  const text = JSON.stringify([data.journalCollections, data.journalEntries]);
  assert.equal(/https?:|capabilityGrants|memories/.test(text), false);
});

test('journal archive filters by journal and month, newest date first', () => {
  const { data: base, collection } = started();
  let data = write(base, collection, '2026-01-30', {}, ids('a')).data;
  data = write(data, collection, '2026-02-02', {}, ids('b')).data;
  data = write(data, collection, '2026-02-15', {}, ids('c')).data;
  assert.deepEqual(listJournalEntries(data).map((entry) => entry.localDate), ['2026-02-15', '2026-02-02', '2026-01-30']);
  assert.deepEqual(listJournalEntries(data, { month: '2026-02' }).map((entry) => entry.localDate), ['2026-02-15', '2026-02-02']);
  assert.deepEqual(listJournalEntries(data, { collectionInstanceId: 'other' }), []);
});
