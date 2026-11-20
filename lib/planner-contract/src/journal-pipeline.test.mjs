import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createJournalCollection,
  createJournalEntry,
  deleteJournalEntry,
  isJournalTombstone,
  listJournalEntries,
  normalizeJournalData,
  updateJournalEntry,
} from './journal.ts';
import { mergeReleaseTwoData, mergeReleaseTwoSnapshots } from './release2-merge.ts';
import { normalizeReleaseTwoData } from './release2.ts';

const legacy = () => ({
  tasks: [{ id: 't1', title: 'Pack boxes', dueDate: '2026-11-01', dueTime: '', tag: '', completed: false }],
  notes: [],
  settings: { theme: 'light', accentHex: '#3b765e' },
});
const ids = (prefix = 'id') => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const T = (minute, day = 26) => `2026-10-${String(day).padStart(2, '0')}T10:${String(minute).padStart(2, '0')}:00.000Z`;

const started = () => createJournalCollection(legacy(), { startLocalDate: '2026-01-01', timeZone: 'Asia/Manila' }, T(0), ids('c'));
const write = (data, collection, localDate, fields, makeId, now) =>
  createJournalEntry(data, { collectionInstanceId: collection.id, localDate, ...fields }, now, makeId);

const everyWay = (base, a, b, makeId = ids('m')) => [
  mergeReleaseTwoData(b, a, makeId).data,
  mergeReleaseTwoData(a, b, makeId).data,
  mergeReleaseTwoSnapshots(base, a, b, makeId),
  mergeReleaseTwoSnapshots(base, b, a, makeId),
];

test('older planners without a journal merge exactly as before and gain no journal fields', () => {
  for (const merged of [mergeReleaseTwoData(legacy(), legacy(), ids()).data, mergeReleaseTwoSnapshots(legacy(), legacy(), legacy(), ids())]) {
    assert.equal('journalCollections' in merged, false);
    assert.equal('journalEntries' in merged, false);
  }
});

test('a journal written on one device survives a merge with a device that has none', () => {
  const { data: base, collection } = started();
  const { data: withEntry, entry } = write(base, collection, '2026-02-11', { body: 'Kept' }, ids('e'), T(1));
  for (const merged of everyWay(legacy(), withEntry, legacy())) {
    assert.equal(listJournalEntries(merged)[0]?.id, entry.id);
    assert.equal(listJournalEntries(merged)[0]?.body, 'Kept');
    assert.equal(merged.journalCollections?.[0]?.id, collection.id);
  }
});

test('entries written on two devices are both kept, in every merge direction', () => {
  const { data: base, collection } = started();
  const { data: a, entry: first } = write(base, collection, '2026-02-11', { body: 'From the phone' }, ids('a'), T(2));
  const { data: b, entry: second } = write(base, collection, '2026-02-11', { body: 'From the laptop' }, ids('b'), T(3));
  for (const merged of everyWay(base, a, b)) {
    const found = listJournalEntries(merged).map((entry) => entry.id).sort();
    assert.deepEqual(found, [first.id, second.id].sort());
  }
});

test('a deletion on one device is final, and no merge brings the text back', () => {
  const { data: base0, collection } = started();
  const { data: base, entry } = write(base0, collection, '2026-02-11', { body: 'SECRET-JOURNAL-TEXT' }, ids('e'), T(1));
  const deleted = deleteJournalEntry(base, entry.id, T(5));
  const edited = updateJournalEntry(base, entry.id, { body: 'SECRET-JOURNAL-TEXT, newer edit' }, T(9));
  for (const merged of everyWay(base, deleted, edited)) {
    const record = merged.journalEntries.find((item) => item.id === entry.id);
    assert.ok(isJournalTombstone(record));
    assert.ok(!JSON.stringify(merged).includes('SECRET-JOURNAL-TEXT'));
  }
});

test('a merged snapshot is still valid and independent of the order of the copies', () => {
  const { data: base, collection } = started();
  const { data: a } = write(base, collection, '2026-02-11', { body: 'A' }, ids('a'), T(2));
  const { data: b } = write(base, collection, '2026-02-12', { body: 'B' }, ids('b'), T(3));
  const [one, two, three, four] = everyWay(base, a, b);
  for (const merged of [one, two, three, four]) assert.doesNotThrow(() => normalizeJournalData(merged));
  assert.deepEqual(one, two);
  assert.deepEqual(three, four);
});

test('the release-two normaliser keeps journal fields instead of dropping them', () => {
  const { data: base, collection } = started();
  const { data } = write(base, collection, '2026-02-11', { body: 'Still here' }, ids('e'), T(1));
  const roundTripped = normalizeReleaseTwoData(JSON.parse(JSON.stringify(data)));
  assert.equal(roundTripped.journalEntries?.length, 1);
  assert.equal(roundTripped.journalCollections?.length, 1);
});
