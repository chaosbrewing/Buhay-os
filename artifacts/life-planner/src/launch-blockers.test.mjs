import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { accountCacheKey, readAccountCache, readLegacyCache, writeAccountCache, reconcilePlannerCopies, preserveRecoveryCopies } from './planner-cache.ts';
import { deriveKey, randomBase64, encryptSnapshot, decryptSnapshot } from './planner-crypto.ts';
import { createWebReminderScheduler } from './web-reminders.ts';

const planner = () => ({
  settings: { theme: 'light', accentHex: '#3b765e' },
  tasks: [{ id: 't1', title: 'Original', dueDate: '2026-10-15', dueTime: '09:30', tag: '', completed: false }],
  notes: [],
  futureField: { keep: 'unknown data' },
});
function memoryStorage() {
  const map = new Map();
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}
test('encrypted offline copy and baseline roundtrip without leaking plaintext or changing envelope', async () => {
  const salt = randomBase64(32), key = await deriveKey('test-only-long-passphrase', salt);
  const base = planner(), local = structuredClone(base);
  local.tasks[0].title = 'Private offline edit';
  const payload = await encryptSnapshot(local, key, salt), basePayload = await encryptSnapshot(base, key, salt);
  const storage = memoryStorage();
  writeAccountCache(storage, { version: 2, ownerId: 'A', payload, basePayload, baseRevision: 5, dirty: true });
  const saved = readAccountCache(storage, 'A');
  assert.equal(saved.dirty, true);
  assert.equal(saved.payload.cryptoVersion, 1);
  assert.equal(JSON.stringify([...storage.map.values()]).includes('Private offline edit'), false);
  assert.deepEqual(await decryptSnapshot(saved.payload, key), local);
  assert.deepEqual(await decryptSnapshot(saved.basePayload, key), base);
  assert.equal(readAccountCache(storage, 'B'), null);
  await assert.rejects(decryptSnapshot(payload, await deriveKey('different-test-passphrase', salt)));
});
test('account ownership, damaged metadata and legacy cache remain explicit, never silently replaced', () => {
  const payload = { cryptoVersion: 1, kdf: 'PBKDF2-SHA256', salt: 's', iv: 'i', ciphertext: 'c' };
  const storage = memoryStorage();
  storage.setItem('daybook.encrypted-cache.v1', JSON.stringify(payload));
  assert.deepEqual(readLegacyCache(storage), payload);
  storage.setItem(accountCacheKey('B'), JSON.stringify({ version: 2, ownerId: 'A', payload, baseRevision: 1, dirty: true }));
  assert.throws(() => readAccountCache(storage, 'B'));
  storage.setItem(accountCacheKey('A'), '{broken');
  assert.throws(() => readAccountCache(storage, 'A'));
  assert.equal(storage.getItem(accountCacheKey('A')), '{broken');
});
test('two offline clients reconcile independent edits and preserve conflicting same-record edits', () => {
  const base = planner(), local = structuredClone(base), cloud = structuredClone(base);
  local.tasks[0].title = 'Offline title';
  cloud.tasks[0].title = 'Other device title';
  cloud.notes.push({ id: 'n1', title: 'Cloud note', date: '2026-10-15', content: 'Keep', tags: [] });
  let id = 0;
  const result = reconcilePlannerCopies(base, local, cloud, () => `conflict-${++id}`);
  assert.equal(result.tasks.length, 2);
  assert.ok(result.tasks.some(task => task.title.includes('Offline title')));
  assert.ok(result.tasks.some(task => task.title === 'Other device title'));
  assert.equal(result.notes[0].title, 'Cloud note');
  assert.deepEqual(result.futureField, base.futureField);
  assert.equal(result.goals, undefined);
});
test('common-baseline deletion is not resurrected; baseline-free recovery preserves both copies', () => {
  const base = planner(), local = structuredClone(base), cloud = structuredClone(base);
  local.tasks = [];
  assert.equal(reconcilePlannerCopies(base, local, cloud, () => 'copy').tasks.length, 0);
  local.tasks = [{ ...base.tasks[0], title: 'Legacy edit' }];
  assert.equal(reconcilePlannerCopies(null, local, cloud, () => 'copy').tasks.length, 2);
});
test('recovery checkpoints are unique and failure aborts instead of destroying either input', () => {
  const storage = memoryStorage(), payload = { cryptoVersion: 1, kdf: 'PBKDF2-SHA256', salt: 's', iv: 'i', ciphertext: 'c' };
  assert.notEqual(preserveRecoveryCopies(storage, 'A', payload), preserveRecoveryCopies(storage, 'A', payload));
  assert.equal(storage.map.size, 2);
  assert.throws(() => preserveRecoveryCopies({ setItem: () => { throw new Error('quota'); } }, 'A', payload));
});
for (const [zone, instant, expected] of [
  ['Australia/Sydney', '2026-10-14T13:30:00Z', '2026-10-15'],
  ['Australia/Melbourne', '2026-10-14T13:30:00Z', '2026-10-15'],
  ['America/Los_Angeles', '2026-10-16T00:30:00Z', '2026-10-15'],
  ['Pacific/Kiritimati', '2026-10-14T10:30:00Z', '2026-10-15'],
]) {
  test(`Today uses the local day in ${zone}`, () => {
    const script = `import {localDateKey} from ${JSON.stringify(new URL('./local-date.ts', import.meta.url).href)}; console.log(localDateKey(new Date(${JSON.stringify(instant)})));`;
    assert.equal(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script],
      { env: { ...process.env, TZ: zone }, encoding: 'utf8' }).trim(), expected);
  });
}
for (const [zone, from, expected] of [
  ['America/Los_Angeles', '2026-03-07', '2026-03-08'],
  ['America/Los_Angeles', '2026-10-31', '2026-11-01'],
  ['Australia/Sydney', '2026-10-03', '2026-10-04'],
  ['Australia/Sydney', '2026-04-04', '2026-04-05'],
  ['Pacific/Kiritimati', '2026-12-31', '2027-01-01'],
]) {
  test(`day/week navigation is DST/calendar correct in ${zone} on ${from}`, () => {
    const script = `import {shiftLocalDate,localMonday} from ${JSON.stringify(new URL('./local-date.ts', import.meta.url).href)}; console.log(JSON.stringify([shiftLocalDate('${from}',1),localMonday(new Date('${expected}T00:30:00'))]));`;
    const [next, monday] = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script],
      { env: { ...process.env, TZ: zone }, encoding: 'utf8' }));
    assert.equal(next, expected);
    assert.equal(new Date(`${monday}T12:00:00Z`).getUTCDay(), 1);
  });
}
test('reminder callbacks use latest privacy, are silent after lock, and remain cancelled after re-unlock', () => {
  let state = { active: true, tasks: [{ ...planner().tasks[0], dueTime: '09:30', reminder: { minutesBefore: 0, timeZone: 'UTC' } }], showTitles: true };
  const callbacks = [], notifications = [], cancelled = [];
  const scheduler = createWebReminderScheduler({
    state: () => state, permitted: () => true, now: () => Date.parse('2026-10-15T09:00:00Z'),
    schedule: callback => { callbacks.push(callback); return callbacks.length; },
    cancel: timer => cancelled.push(timer), notify: item => notifications.push(item),
  });
  scheduler.reconcile();
  assert.ok(callbacks.length);
  state.showTitles = false; callbacks[0]();
  assert.equal(notifications[0].body, 'You have a task reminder.');
  state.active = false; callbacks[0]();
  assert.equal(notifications.length, 1);
  state.active = true; state.tasks = []; callbacks[0]();
  assert.equal(notifications.length, 1, 'a deleted task cannot fire a stale scheduled callback');
  scheduler.dispose(); state.active = true; callbacks[0]();
  assert.equal(notifications.length, 1);
  assert.ok(cancelled.length);
});
