import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalTaskReminderScheduler } from '../lib/local-task-reminders-core.ts';

const now = new Date('2026-10-14T00:00:00.000Z');

function task(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Review the plan',
    dueDate: '2026-10-15',
    dueTime: '09:00',
    tag: '',
    completed: false,
    reminder: { minutesBefore: 15, timeZone: 'UTC' },
    ...overrides,
  };
}

function createAdapter(platform = 'ios') {
  const scheduled = [{
    identifier: 'unrelated',
    content: { data: { otherFeature: true } },
  }];
  const cancelled = [];
  const remindersScheduled = [];
  const channels = [];

  const scheduler = createLocalTaskReminderScheduler({
    platform,
    getAllScheduledNotificationsAsync: async () => [...scheduled],
    cancelScheduledNotificationAsync: async (identifier) => {
      cancelled.push(identifier);
      const index = scheduled.findIndex((item) => item.identifier === identifier);
      if (index !== -1) scheduled.splice(index, 1);
    },
    setNotificationChannelAsync: async (channelId) => {
      channels.push(channelId);
    },
    scheduleReminder: async (reminder) => {
      remindersScheduled.push(reminder);
      scheduled.push({
        identifier: `reminder-${remindersScheduled.length}`,
        content: { data: { buhayOsTaskReminder: true } },
      });
    },
  });

  return { scheduler, scheduled, cancelled, remindersScheduled, channels };
}

test('declining notifications clears old Buhay.OS alerts and keeps unrelated notifications', async () => {
  const state = createAdapter();
  await state.scheduler.reconcile([task()], true, now);
  assert.equal(state.remindersScheduled.length, 1);

  await state.scheduler.reconcile([task()], false, now);
  assert.deepEqual(state.cancelled, ['reminder-1']);
  assert.deepEqual(state.scheduled.map((item) => item.identifier), ['unrelated']);
  assert.equal(state.remindersScheduled.length, 1);
});

test('editing, turning off, completing, or deleting a task replaces or removes its old alert', async () => {
  const state = createAdapter();
  await state.scheduler.reconcile([task()], true, now);
  assert.equal(state.scheduled.some((item) => item.identifier === 'reminder-1'), true);

  await state.scheduler.reconcile([task({
    title: 'Updated plan',
    dueDate: '2026-10-16',
    dueTime: '10:00',
    reminder: { minutesBefore: 30, timeZone: 'UTC' },
  })], true, now);
  assert.deepEqual(state.cancelled, ['reminder-1']);
  assert.equal(state.remindersScheduled.at(-1).title, 'Updated plan');
  assert.equal(state.scheduled.filter((item) => item.content.data?.buhayOsTaskReminder).length, 1);

  await state.scheduler.reconcile([task({ reminder: undefined })], true, now);
  assert.equal(state.scheduled.some((item) => item.content.data?.buhayOsTaskReminder), false);

  await state.scheduler.reconcile([task({ completed: true })], true, now);
  assert.equal(state.scheduled.some((item) => item.content.data?.buhayOsTaskReminder), false);

  await state.scheduler.reconcile([], true, now);
  assert.equal(state.scheduled.some((item) => item.content.data?.buhayOsTaskReminder), false);
  assert.deepEqual(state.scheduled.map((item) => item.identifier), ['unrelated']);
});

test('hiding task titles schedules generic reminder text, then restores task text when enabled', async () => {
  const state = createAdapter();
  await state.scheduler.reconcile([task()], true, now, false);
  assert.equal(state.remindersScheduled.at(-1).title, 'You have a task reminder.');

  await state.scheduler.reconcile([task()], true, now, true);
  assert.equal(state.remindersScheduled.at(-1).title, 'Review the plan');
  assert.deepEqual(state.cancelled, ['reminder-1']);
});

test('Android configures its notification channel while iOS does not', async () => {
  const android = createAdapter('android');
  const ios = createAdapter('ios');

  await android.scheduler.reconcile([task()], true, now);
  await ios.scheduler.reconcile([task()], true, now);

  assert.deepEqual(android.channels, ['planner-reminders']);
  assert.deepEqual(ios.channels, []);
});

test('reminder schedule instants keep the saved wall-clock time through the daylight-saving change', async () => {
  const state = createAdapter();
  await state.scheduler.reconcile([task({
    title: 'Daily check-in',
    dueDate: '2026-03-07',
    dueTime: '09:00',
    reminder: { minutesBefore: 15, timeZone: 'America/New_York' },
    recurrence: { frequency: 'daily', timeZone: 'America/New_York' },
  })], true, new Date('2026-03-07T12:00:00.000Z'));

  assert.deepEqual(state.remindersScheduled.slice(0, 2).map(({ occurrenceDate, reminderAt }) => [
    occurrenceDate,
    new Date(reminderAt).toISOString(),
  ]), [
    ['2026-03-07', '2026-03-07T13:45:00.000Z'],
    ['2026-03-08', '2026-03-08T12:45:00.000Z'],
  ]);
});

test('back-to-back task changes are serialized so the final schedule reflects the latest data', async () => {
  const state = createAdapter();
  await Promise.all([
    state.scheduler.reconcile([task()], true, now),
    state.scheduler.reconcile([], true, now),
  ]);

  assert.equal(state.scheduled.some((item) => item.content.data?.buhayOsTaskReminder), false);
});
