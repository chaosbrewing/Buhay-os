import test from 'node:test';
import assert from 'node:assert/strict';
import { keepDeletedMemories } from './backup-restore.ts';

const base = { tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3b765e' } };
const T = '2026-11-01T00:00:00.000Z';
const live = (id) => ({ id, text: `text ${id}`, kind: 'fact', verification: 'user-confirmed', sensitivity: 'private', source: { type: 'manual' }, createdAt: T, updatedAt: T });

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
