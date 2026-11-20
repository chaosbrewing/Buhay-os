import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournalCollection, createJournalEntry } from '@workspace/planner-contract/journal';
import { buildJournalView, shiftLocalDate, journalToday } from './journal-view.ts';

const base = { tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3b765e' } };
const NOW = '2026-10-09T01:00:00.000Z';
const ids = (prefix = 'id') => { let n = 0; return () => `${prefix}-${++n}`; };

const started = (start = '2026-10-09') => {
  const { data, collection } = createJournalCollection(base, { startLocalDate: start, timeZone: 'Pacific/Kiritimati' }, NOW, ids('c'));
  return { data, collection };
};
const write = (data, collection, localDate, fields = {}, makeId = ids('e')) =>
  createJournalEntry(data, { collectionInstanceId: collection.id, localDate, ...fields }, NOW, makeId);

test('shifting a date works across months, leap days and years without any time zone', () => {
  assert.equal(shiftLocalDate('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftLocalDate('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftLocalDate('2027-02-28', 1), '2027-03-01');
  assert.equal(shiftLocalDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftLocalDate('2026-01-01', -1), '2025-12-31');
});

test("today's date is read in the journal's own time zone", () => {
  const { collection } = started();
  // 2026-11-20T23:00Z is already the 21st at UTC+14.
  assert.equal(journalToday(collection, new Date('2026-11-20T23:00:00.000Z')), '2026-11-21');
});

test('an active day shows its number, its question and no entry until one is written', () => {
  const { data, collection } = started('2026-10-09');
  const view = buildJournalView(data, collection, null, '2026-11-19');
  assert.equal(view.state, 'active');
  assert.equal(view.viewDate, '2026-11-19');
  assert.equal(view.dayNumber, 42);
  assert.equal(view.todayNumber, 42);
  assert.ok(view.prompt && view.prompt.day === 42 && view.prompt.prompt.length > 0);
  assert.equal(view.entry, null);
  assert.equal(view.daysWritten, 0);
  assert.equal(view.canGoNext, false);
  assert.equal(view.canGoPrevious, true);
});

test('the shown date never goes ahead of today or before Day 1', () => {
  const { data, collection } = started('2026-10-09');
  assert.equal(buildJournalView(data, collection, '2027-01-01', '2026-11-19').viewDate, '2026-11-19');
  const early = buildJournalView(data, collection, '2026-01-01', '2026-11-19');
  assert.equal(early.viewDate, '2026-10-09');
  assert.equal(early.dayNumber, 1);
  assert.equal(early.canGoPrevious, false);
});

test('before the start date nothing can be written yet', () => {
  const { data, collection } = started('2026-12-01');
  const view = buildJournalView(data, collection, null, '2026-11-19');
  assert.equal(view.state, 'before-start');
  assert.equal(view.dayNumber, null);
  assert.equal(view.prompt, null);
  assert.equal(view.todayNumber, 0);
  assert.equal(view.canGoPrevious || view.canGoNext, false);
});

test('after Day 365 the journal is complete but past days can still be read', () => {
  const { data, collection } = started('2026-01-01');
  const view = buildJournalView(data, collection, null, '2027-03-01');
  assert.equal(view.state, 'cycle-complete');
  assert.equal(view.viewDate, '2026-12-31');
  assert.equal(view.dayNumber, 365);
  assert.equal(view.todayNumber, 365);
  assert.equal(view.canGoNext, false);
  assert.equal(view.canGoPrevious, true);
});

test('the newest entry for a date is shown and any others are counted, never hidden', () => {
  const { data: d0, collection } = started('2026-10-09');
  const { data: d1 } = write(d0, collection, '2026-11-19', { todayInMyLife: 'first' }, ids('a'));
  const { data: d2 } = createJournalEntry(d1, { collectionInstanceId: collection.id, localDate: '2026-11-19', todayInMyLife: 'second' }, '2026-10-09T02:00:00.000Z', ids('b'));
  const view = buildJournalView(d2, collection, null, '2026-11-19');
  assert.equal(view.entry.todayInMyLife, 'second');
  assert.equal(view.otherEntries, 1);
  assert.equal(view.daysWritten, 1);
});

test('days written counts distinct days, including paper-only days', () => {
  const { data: d0, collection } = started('2026-10-09');
  const { data: d1 } = write(d0, collection, '2026-10-10', { todayInMyLife: 'typed' }, ids('a'));
  const { data: d2 } = write(d1, collection, '2026-10-11', { modality: 'handwritten' }, ids('b'));
  assert.equal(buildJournalView(d2, collection, null, '2026-11-19').daysWritten, 2);
});
