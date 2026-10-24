import { getPlannerReminderInstances, type PlannerTask } from '@workspace/planner-contract';

type State = { active: boolean; tasks: PlannerTask[]; showTitles: boolean };
type NotificationData = { body: string; tag: string };
export function createWebReminderScheduler(options: {
  state: () => State; permitted: () => boolean; now: () => number;
  schedule: (callback: () => void, delay: number) => number; cancel: (timer: number) => void;
  notify: (notification: NotificationData) => void;
}) {
  let disposed = false;
  let timers: number[] = [];
  const clear = () => { timers.forEach(options.cancel); timers = []; };
  const reconcile = () => {
    clear();
    const current = options.state();
    if (disposed || !current.active || !options.permitted()) return;
    const now = options.now();
    for (const reminder of getPlannerReminderInstances(current.tasks, new Date(now), 60)) {
      const delay = reminder.reminderAt - now;
      if (delay <= 0 || delay > 21 * 24 * 60 * 60_000) continue;
      timers.push(options.schedule(() => {
        const latest = options.state();
        // Check live state and disposal even if a cancelled callback is already queued.
        if (disposed || !latest.active || !options.permitted()) return;
        const stillScheduled = getPlannerReminderInstances(latest.tasks, new Date(reminder.reminderAt - 1), 60)
          .some(item => item.taskId === reminder.taskId && item.occurrenceDate === reminder.occurrenceDate
            && item.reminderAt === reminder.reminderAt);
        if (!stillScheduled) return;
        try { options.notify({ body: latest.showTitles ? reminder.title : 'You have a task reminder.',
          tag: `buhay-${reminder.taskId}-${reminder.occurrenceDate}` }); }
        catch { /* Permission/display can fail without compromising the planner. */ }
        reconcile();
      }, delay));
    }
  };
  return { reconcile, dispose: () => { disposed = true; clear(); } };
}
