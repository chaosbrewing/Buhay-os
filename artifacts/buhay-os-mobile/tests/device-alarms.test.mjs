import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createDeviceAlarmService, nativeAlarmInput, parseLocalAlarmTime } from '../lib/device-alarms-core.ts';
import { alarmSourceAvailable } from '../lib/alarm-sources.ts';

const future = Date.parse('2030-10-16T09:00:00Z');
const source = { kind: 'task', id: 'task-1' };
function fixture() {
  const values = new Map();
  const scheduled = new Map();
  const requests = [];
  let count = 0;
  const storage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  const native = {
    getPermissionsAsync: async () => ({ canScheduleExactAlarms: true, canPostNotifications: true }),
    requestPermissionsAsync: async () => ({ canScheduleExactAlarms: true, canPostNotifications: true }),
    getScheduledAlarmsAsync: async () => [...scheduled.values()],
    scheduleAlarmAsync: async (input) => {
      requests.push(input);
      scheduled.set(input.id, { id: input.id });
      return { id: input.id };
    },
    cancelAlarmAsync: async (id) => scheduled.delete(id),
  };
  const id = () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`;
  const service = createDeviceAlarmService(storage, native, id);
  return { values, scheduled, requests, native, storage, service, id };
}
test('task/habit/routine/event alarms use generic OS text and no sensitive source metadata', async () => {
  for (const kind of ['task', 'habit', 'routine', 'event']) {
    const f = fixture();
    await f.service.activateAccount('account-a');
    await f.service.schedule('account-a', { kind, id: 'opaque', title: 'Secret doctor visit', calendarId: kind === 'event' ? 'calendar' : undefined }, future);
    assert.equal(f.requests[0].title, 'HANAY alarm');
    assert.equal(f.requests[0].timestamp, future);
    assert.equal(JSON.stringify(f.requests).includes('opaque'), false);
    assert.equal(JSON.stringify(f.requests).includes('Secret'), false);
    assert.equal([...f.values.values()].join('').includes('Secret'), false);
    assert.equal(f.requests[0].android.enforceVolume, false);
    assert.equal(f.requests[0].android.fullScreen, false);
    assert.equal(f.requests[0].ios.alertActionMode, 'default');
  }
});
test('metadata and cancellation ID are durable before native scheduling', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  f.native.scheduleAlarmAsync = async (input) => {
    const manifest = JSON.parse(f.values.get('buhay.device-alarms.v1'));
    assert.ok(manifest.ids.includes(input.id));
    assert.ok(f.values.has(`buhay.alarm.${input.id}`));
    return { id: input.id };
  };
  await f.service.schedule('a', source, future);
});
test('failed storage writes cannot schedule a native alarm', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  f.storage.set = async () => { throw new Error('secure storage full'); };
  await assert.rejects(f.service.schedule('a', source, future), /storage full/);
  assert.equal(f.requests.length, 0);
});
test('native failure after registration remains recoverable and cancellable', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  const schedule = f.native.scheduleAlarmAsync;
  f.native.scheduleAlarmAsync = async (input) => {
    await schedule(input);
    throw new Error('native response lost');
  };
  await assert.rejects(f.service.schedule('a', source, future), /response lost/);
  const records = await f.service.list('a');
  assert.equal(records.length, 1);
  assert.equal(records[0].scheduled, true);
  await f.service.remove('a', records[0].id);
  assert.equal(f.scheduled.size, 0);
});
test('denied exact-alarm or notification permission never reports a scheduled alarm', async () => {
  for (const permissions of [
    { canScheduleExactAlarms: false },
    { canScheduleExactAlarms: true, canPostNotifications: false },
  ]) {
    const f = fixture();
    await f.service.activateAccount('a');
    f.native.getPermissionsAsync = async () => permissions;
    await assert.rejects(f.service.schedule('a', source, future), /permission/);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(await f.service.list('a'), []);
  }
});
test('unsupported native module rejects scheduling rather than notification fallback', async () => {
  const f = fixture();
  const service = createDeviceAlarmService(f.storage, null, f.id);
  await service.activateAccount('a');
  await assert.rejects(service.schedule('a', source, future), /custom native build/);
});
test('duplicate, invalid and past alarms are rejected', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  await f.service.schedule('a', source, future);
  await assert.rejects(f.service.schedule('a', source, future), /already has/);
  await assert.rejects(f.service.schedule('a', { kind: 'wrong', id: 'x' }, future), /available item/);
  await assert.rejects(f.service.schedule('a', source, 0), /future/);
  await assert.rejects(f.service.schedule('a', source, Infinity), /future/);
});
test('switching accounts and signing out cancel old alarms and isolate records', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  await f.service.schedule('a', source, future);
  await f.service.activateAccount('b');
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(await f.service.list('b'), []);
  await assert.rejects(f.service.list('a'), /account changed/);
  await f.service.schedule('b', source, future);
  await f.service.activateAccount(null);
  assert.equal(f.scheduled.size, 0);
});
test('account switch invalidates in-flight native scheduling and cancels its journalled ID', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  let release;
  let started;
  const wait = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  f.native.scheduleAlarmAsync = async (input) => {
    started();
    await wait;
    f.scheduled.set(input.id, { id: input.id });
    return { id: input.id };
  };
  const pending = f.service.schedule('a', source, future);
  await entered;
  const switched = f.service.activateAccount('b');
  release();
  await assert.rejects(pending, /account changed/);
  await switched;
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(await f.service.list('b'), []);
});
test('cancellation errors preserve the journal and block account cleanup until retry', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  await f.service.schedule('a', source, future);
  const cancel = f.native.cancelAlarmAsync;
  f.native.cancelAlarmAsync = async () => false;
  await assert.rejects(f.service.activateAccount('b'), /could not cancel/);
  assert.equal(JSON.parse(f.values.get('buhay.device-alarms.v1')).owner, 'a');
  assert.equal(JSON.parse(f.values.get('buhay.device-alarms.v1')).ids.length, 1);
  f.native.cancelAlarmAsync = cancel;
  await f.service.activateAccount('b');
  assert.deepEqual(await f.service.list('b'), []);
});
test('relaunch does not re-arm old alarms; orphaned native registrations are cancelled', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  const alarm = await f.service.schedule('a', source, future);
  f.scheduled.delete(alarm.id); // Simulate an alarm that rang and was stopped.
  f.scheduled.set('orphan-id', { id: 'orphan-id' });
  const relaunched = createDeviceAlarmService(f.storage, f.native, f.id);
  await relaunched.activateAccount('a');
  assert.equal(f.requests.length, 1);
  assert.equal(f.scheduled.size, 0);
  assert.equal((await relaunched.list('a'))[0].scheduled, false);
});
test('unreadable journal is not silently reset', async () => {
  const f = fixture();
  f.values.set('buhay.device-alarms.v1', '{"version":99,"ids":[]}');
  await assert.rejects(f.service.activateAccount('a'), /unreadable/);
  assert.equal(JSON.parse(f.values.get('buhay.device-alarms.v1')).version, 99);
});
test('explicit journal recovery cancels native alarms before clearing corrupt metadata', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  await f.service.schedule('a', source, future);
  f.values.set('buhay.device-alarms.v1', '{"version":99}');
  const cancel = f.native.cancelAlarmAsync;
  f.native.cancelAlarmAsync = async () => false;
  await assert.rejects(f.service.recoverJournal('a'), /could not cancel/);
  assert.equal(JSON.parse(f.values.get('buhay.device-alarms.v1')).version, 99);
  f.native.cancelAlarmAsync = cancel;
  await f.service.recoverJournal('a');
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(await f.service.list('a'), []);
});
test('24-alarm limit is explicit and old records can be removed', async () => {
  const f = fixture();
  await f.service.activateAccount('a');
  for (let i = 0; i < 24; i++) await f.service.schedule('a', { ...source, id: String(i) }, future + i);
  await assert.rejects(f.service.schedule('a', { ...source, id: 'extra' }, future), /24 per device/);
  await f.service.cancelAll('a');
  assert.deepEqual(await f.service.list('a'), []);
});
test('invalid local dates and DST gaps are rejected; overlap chooses first instant', () => {
  const core = new URL('../lib/device-alarms-core.ts', import.meta.url).href;
  for (const [tz, code] of [
    ['Australia/Sydney', `assert.throws(() => parseLocalAlarmTime('2026-10-04','02:30',0), /does not exist/); assert.equal(new Date(parseLocalAlarmTime('2026-10-16','09:00',0)).toISOString(),'2026-10-15T22:00:00.000Z');`],
    ['America/New_York', `assert.throws(() => parseLocalAlarmTime('2026-03-08','02:30',0), /does not exist/); assert.equal(new Date(parseLocalAlarmTime('2026-11-01','01:30',0)).toISOString(),'2026-11-01T05:30:00.000Z');`],
    ['UTC', `assert.throws(() => parseLocalAlarmTime('2026-02-30','10:00',0), /does not exist/); assert.throws(() => parseLocalAlarmTime('2026-10-16','25:00',0), /does not exist/);`],
  ]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
      `import assert from 'node:assert/strict'; import {parseLocalAlarmTime} from '${core}'; ${code}`],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  }
  assert.throws(() => parseLocalAlarmTime('bad', '09:00'), /YYYY/);
  assert.throws(() => parseLocalAlarmTime('2020-01-01', '09:00'), /future/);
});
test('source checks reject completed/deleted tasks and completed/skipped/paused habits', () => {
  const data = { tasks: [{ id: 'task-1', completed: false }], habits: [
    { id: 'h', completedDates: [], skippedDates: ['2030-10-16'] },
  ], routines: [{ id: 'r', title: 'Morning', steps: [] }] };
  assert.equal(alarmSourceAvailable(source, data), true);
  assert.equal(alarmSourceAvailable({ kind: 'task', id: 'missing' }, data), false);
  data.tasks[0].completed = true;
  assert.equal(alarmSourceAvailable(source, data), false);
  const habitSource = { kind: 'habit', id: 'h', occurrenceDate: '2030-10-16' };
  assert.equal(alarmSourceAvailable(habitSource, data), false);
  data.habits[0].skippedDates = [];
  data.habits[0].pausedRanges = [{ startDate: '2030-10-01' }];
  assert.equal(alarmSourceAvailable(habitSource, data), false);
  data.habits[0].pausedRanges = [];
  data.habits[0].completedDates = ['2030-10-16'];
  assert.equal(alarmSourceAvailable(habitSource, data), false);
  assert.equal(alarmSourceAvailable({ kind: 'routine', id: 'r' }, data), true);
  assert.equal(alarmSourceAvailable({ kind: 'routine', id: 'missing' }, data), false);
  assert.equal(alarmSourceAvailable({ kind: 'event', id: 'e' }, data), true);
});
test('pinned iOS patch uses a fixed date and retains records on cancellation errors (source check, not device QA)', () => {
  const swift = readFileSync(new URL('../node_modules/react-native-alarm-scheduler/ios/AlarmScheduler/AlarmSchedulerModule+Scheduling.swift', import.meta.url), 'utf8');
  assert.match(swift, /schedule = \.fixed\(Date\(timeIntervalSince1970:/);
  assert.match(swift, /fixedTimestamp: alarm.timestamp == nil \? nil : timestamp/);
  const cancellation = swift.slice(swift.indexOf('  func cancel(id:'), swift.indexOf('  func cancelNativeAndRetryAlarms('));
  assert.doesNotMatch(cancellation, /try\? AlarmManager.shared.cancel/);
  assert.match(swift, /Preserve native metadata[\s\S]*return false/);
  assert.equal(nativeAlarmInput({ id: 'id', source, at: future }).title, 'HANAY alarm');
});
