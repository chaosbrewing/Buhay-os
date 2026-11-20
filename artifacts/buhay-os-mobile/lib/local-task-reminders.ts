import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PlannerReminderInstance, PlannerTask } from '@workspace/planner-contract';
import { createLocalTaskReminderScheduler } from '@/lib/local-task-reminders-core';

export type ReminderPermissionState = {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
};

const REMINDER_MARKER = 'buhayOsTaskReminder';
const REMINDER_CHANNEL_ID = 'planner-reminders';

async function ensureReminderChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Task reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

const scheduler = createLocalTaskReminderScheduler({
  platform: Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web',
  getAllScheduledNotificationsAsync: () => Notifications.getAllScheduledNotificationsAsync(),
  cancelScheduledNotificationAsync: async (identifier) => {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },
  setNotificationChannelAsync: async (channelId) => {
    await Notifications.setNotificationChannelAsync(channelId, {
      name: 'Task reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  scheduleReminder: async (reminder: PlannerReminderInstance) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Buhay.OS reminder',
        body: reminder.title,
        data: {
          [REMINDER_MARKER]: true,
          taskId: reminder.taskId,
          occurrenceDate: reminder.occurrenceDate,
        },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.reminderAt),
        ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
    });
  },
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function readReminderPermission(): Promise<ReminderPermissionState> {
  const response = await Notifications.getPermissionsAsync();
  return {
    granted: response.granted,
    canAskAgain: response.canAskAgain,
    status: response.status,
  };
}

export async function askForReminderPermission(): Promise<ReminderPermissionState> {
  await ensureReminderChannel();
  const response = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return {
    granted: response.granted,
    canAskAgain: response.canAskAgain,
    status: response.status,
  };
}

export function reconcileLocalTaskReminders(
  tasks: PlannerTask[],
  permissionGranted: boolean,
  now = new Date(),
  showTaskTitles = true,
): Promise<void> {
  return scheduler.reconcile(tasks, permissionGranted, now, showTaskTitles);
}

export function cancelLocalTaskReminders(): Promise<void> {
  return scheduler.cancelAll();
}
