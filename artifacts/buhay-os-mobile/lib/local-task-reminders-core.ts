import { getPlannerReminderInstances } from '@workspace/planner-contract';
import type { PlannerTask } from '@workspace/planner-contract';

const REMINDER_MARKER = 'buhayOsTaskReminder';
const REMINDER_CHANNEL_ID = 'planner-reminders';
const MAX_SCHEDULED_REMINDERS = 48;

type ReminderInstance = ReturnType<typeof getPlannerReminderInstances>[number];
type ReminderPlatform = 'android' | 'ios' | 'web';

type ScheduledNotification = {
  identifier: string;
  content: { data?: Record<string, unknown> | null };
};

export type LocalReminderAdapter = {
  platform: ReminderPlatform;
  getAllScheduledNotificationsAsync: () => Promise<ScheduledNotification[]>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
  setNotificationChannelAsync: (channelId: string) => Promise<void>;
  scheduleReminder: (reminder: ReminderInstance) => Promise<void>;
};

export function createLocalTaskReminderScheduler(adapter: LocalReminderAdapter) {
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (operation: () => Promise<void>) => {
    queue = queue.catch(() => undefined).then(operation);
    return queue;
  };

  const cancelMarkedReminders = async () => {
    const existing = await adapter.getAllScheduledNotificationsAsync();
    await Promise.all(existing
      .filter((request) => request.content.data?.[REMINDER_MARKER] === true)
      .map((request) => adapter.cancelScheduledNotificationAsync(request.identifier)));
  };

  return {
    reconcile(
      tasks: PlannerTask[],
      permissionGranted: boolean,
      now = new Date(),
      showTaskTitles = true,
    ): Promise<void> {
      return enqueue(async () => {
        await cancelMarkedReminders();
        if (!permissionGranted) return;

        if (adapter.platform === 'android') {
          await adapter.setNotificationChannelAsync(REMINDER_CHANNEL_ID);
        }
        const upcoming = getPlannerReminderInstances(tasks, now, 90)
          .slice(0, MAX_SCHEDULED_REMINDERS);
        for (const reminder of upcoming) {
          await adapter.scheduleReminder(
            showTaskTitles ? reminder : { ...reminder, title: 'You have a task reminder.' },
          );
        }
      });
    },

    cancelAll(): Promise<void> {
      return enqueue(cancelMarkedReminders);
    },
  };
}
