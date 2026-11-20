import assert from 'node:assert/strict';
import test from 'node:test';

test('unit tests run in the fixed Pacific/Kiritimati zone on every OS', () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Pacific/Kiritimati');
  // UTC+14 in 2026: local midnight is still the previous UTC day.
  assert.equal(new Date('2026-10-25T00:00:00').toISOString(), '2026-10-24T10:00:00.000Z');
});
