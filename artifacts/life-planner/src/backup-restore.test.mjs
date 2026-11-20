import test from 'node:test';
import assert from 'node:assert/strict';
import { keepDeletedMemories, keepDeletedRecords } from './backup-restore.ts';

const base = { tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3b765e' } };
const T = '2026-11-01T00:00:00.000Z';
const live = (id) => ({ id, text: `text ${id}`, kind: 'fact', verification: 'user-confirmed', sensitivity: 'private', source: { type: 'manual' }, createdAt: T, updatedAt: T });
const page = (id) => ({ id, collectionInstanceId: 'c1', localDate: '2026-02-11', body: `page ${id}`, modality: 'digital', createdAt: T, updatedAt: T });

test('restoring an old backup does not bring back a memory deleted since', () => {
  const restored = { ...base, memories: [live('a'), live('b')] };
  const current = { ...base, memories: [{ id: 'a', deletedAt: T }, live('b')] };
  const out = keepDeletedMemories(restored, current);
  assert.deepEqual(out.memories.find((m) => m.id === 'a'), { id: 'a', deletedAt: T });
  assert.equal(out.memories.find((m) => m.id === 'b').text, 'text b');
  assert.ok(!JSON.stringify(out).includes('text a'));
});

test('deletions missing from the backup are still recorded; no deletions leaves the backup untouched', () => {
  const restored = { ...base, memories: [live('b')] };
  const out = keepDeletedMemories(restored, { ...base, memories: [{ id: 'z', deletedAt: T }] });
  assert.deepEqual(out.memories.map((m) => m.id).sort(), ['b', 'z']);
  assert.equal(keepDeletedMemories(restored, { ...base, memories: [live('q')] }), restored);
  assert.equal(keepDeletedMemories(restored, base), restored);
});

test('restoring an old backup does not bring back a journal entry deleted since', () => {
  const restored = { ...base, journalEntries: [page('a'), page('b')] };
  const current = { ...base, journalEntries: [{ id: 'a', deletedAt: T }, page('b')] };
  const out = keepDeletedRecords(restored, current);
  assert.deepEqual(out.journalEntries.find((e) => e.id === 'a'), { id: 'a', deletedAt: T });
  assert.equal(out.journalEntries.find((e) => e.id === 'b').body, 'page b');
  assert.ok(!JSON.stringify(out).includes('page a'));
});

test('one restore keeps both deleted memories and deleted journal entries', () => {
  const restored = { ...base, memories: [live('m1')], journalEntries: [page('j1')] };
  const current = { ...base, memories: [{ id: 'm1', deletedAt: T }], journalEntries: [{ id: 'j1', deletedAt: T }] };
  const out = keepDeletedRecords(restored, current);
  assert.deepEqual(out.memories, [{ id: 'm1', deletedAt: T }]);
  assert.deepEqual(out.journalEntries, [{ id: 'j1', deletedAt: T }]);
});

test('a planner with no journal or memories is returned untouched', () => {
  const restored = { ...base };
  assert.equal(keepDeletedRecords(restored, base), restored);
});

test('one restore keeps deleted memories, journal entries and finance entries all deleted', () => {
  const entry = (id) => ({ id, kind: 'spending', name: `spent ${id}`, amountMinor: 100, currency: 'AUD', date: '2026-11-01', category: 'Other', createdAt: T, updatedAt: T });
  const restored = { ...base, memories: [live('m1')], journalEntries: [page('j1')], financeEntries: [entry('f1'), entry('f2')] };
  const current = { ...base, memories: [{ id: 'm1', deletedAt: T }], journalEntries: [{ id: 'j1', deletedAt: T }], financeEntries: [{ id: 'f1', deletedAt: T }] };
  const out = keepDeletedRecords(restored, current);
  assert.deepEqual(out.financeEntries.find((e) => e.id === 'f1'), { id: 'f1', deletedAt: T });
  assert.equal(out.financeEntries.find((e) => e.id === 'f2').name, 'spent f2');
  assert.ok(!JSON.stringify(out).includes('spent f1'));
  assert.deepEqual(out.memories, [{ id: 'm1', deletedAt: T }]);
  assert.deepEqual(out.journalEntries, [{ id: 'j1', deletedAt: T }]);
});
