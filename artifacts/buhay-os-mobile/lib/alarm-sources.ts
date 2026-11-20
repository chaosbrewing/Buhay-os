import { expandPlannerTaskOccurrences, getPlannerHabitHistory } from '@workspace/planner-contract';
import type { PlannerData } from './planner-data';
import type { AlarmSource } from './device-alarms-core';

/** Only inspect unlocked local data. Never fetch decrypted planner text for the OS. */
export function alarmSourceAvailable(source: AlarmSource, data: PlannerData): boolean {
  if (source.kind === 'event') return true; // Calendar data cannot be verified from an E2EE snapshot.
  if (source.kind === 'task') {
    const task = data.tasks.find((item) => item.id === source.id);
    if (!task) return false;
    if (task.recurrence && source.occurrenceDate) {
      return expandPlannerTaskOccurrences([task], source.occurrenceDate, source.occurrenceDate)
        .some((occurrence) => !occurrence.completed);
    }
    return !task.completed;
  }
  if (source.kind === 'habit') {
    const habit = data.habits?.find((item) => item.id === source.id);
    if (!habit) return false;
    if (!source.occurrenceDate) return true;
    const status = getPlannerHabitHistory(habit, source.occurrenceDate, source.occurrenceDate)[0]?.status;
    return !['completed', 'paused', 'skipped'].includes(status);
  }
  return Boolean(data.routines?.some((item) => item.id === source.id));
}
