export type TaskPriority = 'low' | 'normal' | 'high';

export type PlannerRecurrenceRule = {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval?: number;
  /** JavaScript weekday numbers (Sunday = 0); applies to weekly rules. */
  weekdays?: number[];
  /** Inclusive local calendar date. */
  endsOn?: string;
  /** IANA timezone used to interpret the task's wall-clock time and reminder. */
  timeZone?: string;
};

export type PlannerReminderRule = {
  /** Minutes before the task time; zero means at the task time. */
  minutesBefore: number;
  timeZone: string;
};

export type PlannerTaskOccurrenceOverride = {
  /** Original occurrence date; stable even if the occurrence is moved. */
  date: string;
  changes?: Partial<Pick<PlannerTask, 'title' | 'description' | 'dueDate' | 'dueTime' | 'tag' | 'completed' | 'priority' | 'reminder'>>;
  cancelled?: boolean;
  changedAt: string;
};

export type PlannerTask = {
  id: string;
  title: string;
  description?: string;
  dueDate: string;
  dueTime: string;
  tag: string;
  completed: boolean;
  priority?: TaskPriority;
  projectId?: string;
  parentTaskId?: string;
  recurrence?: PlannerRecurrenceRule;
  reminder?: PlannerReminderRule;
  /** Private reference to a Google event created from this task. */
  calendarEventRef?: {
    calendarId: string;
    eventId: string;
    htmlLink?: string;
    idempotencyKey?: string;
  };
  /** Private stable retry key persisted before the Google write begins. */
  calendarEventRequestKey?: string;
  occurrenceOverrides?: PlannerTaskOccurrenceOverride[];
  /** Transient fields added only by expandPlannerTaskOccurrences. */
  occurrenceDate?: string;
  /** Transient series identity added only by expandPlannerTaskOccurrences. */
  seriesTaskId?: string;
};

export type PlannerNote = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
};

export type PlannerProject = {
  id: string;
  title: string;
  description: string;
  targetDate?: string;
  status: 'active' | 'archived';
};

export type InboxItem = {
  id: string;
  title: string;
  content: string;
  capturedAt: string;
};

export type PlannerHabit = {
  id: string;
  title: string;
  description?: string;
  completedDates: string[];
  /** JavaScript weekday numbers (Sunday = 0); mutually exclusive with weeklyTarget. */
  scheduledDays?: number[];
  /** Number of completions per Monday-to-Sunday week; mutually exclusive with scheduledDays. */
  weeklyTarget?: number;
  /** Optional measurable daily goal; omitted for a binary habit. */
  measurement?: { goal: number; unit: string };
  /** Saved value for a date. A value at or above measurement.goal counts as complete. */
  progressEntries?: PlannerHabitProgress[];
  /** Timestamped completion/uncompletion decisions so offline corrections survive stale copies. */
  completionEntries?: PlannerHabitCompletion[];
  /** Inclusive local date ranges. An omitted endDate means the pause is still active. */
  pausedRanges?: Array<{ startDate: string; endDate?: string; changedAt?: string }>;
  /** Planned dates the user intentionally skipped. */
  skippedDates?: string[];
  /** Timestamped skip/unskip decisions so offline merges preserve the latest choice. */
  skipEntries?: PlannerHabitSkip[];
};

export type PlannerHabitProgress = {
  date: string;
  value: number;
  changedAt?: string;
};

export type PlannerHabitCompletion = {
  date: string;
  completed: boolean;
  changedAt: string;
};

export type PlannerHabitSkip = {
  date: string;
  skipped: boolean;
  changedAt: string;
};

export type PlannerHabitSummary = {
  completedThisWeek: number;
  weeklyTarget: number | null;
  currentStreak: number;
  plannedThisWeek: number;
  pausedThisWeek: number;
  skippedThisWeek: number;
  missedThisWeek: number;
};

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeParts(timestamp: number, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year as number,
    month: values.month as number,
    day: values.day as number,
    hour: values.hour as number,
    minute: values.minute as number,
    second: values.second as number,
  };
}

/** Format an instant as a calendar date in an IANA time zone. */
export function getPlannerDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = zonedDateTimeParts(date.getTime(), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Add calendar days without depending on the device's current time zone. */
export function shiftPlannerDateKey(date: string, days: number): string {
  if (!validDateKey(date) || !Number.isInteger(days)) {
    throw new Error('The planner date offset is invalid.');
  }
  return shiftDateKey(date, days);
}

/**
 * Convert a wall-clock date and time in an IANA zone to an instant.
 * During a repeated fall-back hour, use its first occurrence. A nonexistent
 * spring-forward time is moved to the first real minute after the gap.
 */
export function resolvePlannerLocalDateTime(date: string, time: string, timeZone: string): number | null {
  if (!validDateKey(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);

  const resolveExact = (target: number): number | null => {
    const candidates = new Set<number>();
    for (let offset = -36; offset <= 36; offset += 6) {
      const sample = target + offset * 60 * 60_000;
      const local = zonedDateTimeParts(sample, timeZone);
      const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
      const candidate = target - (localAsUtc - sample);
      const actual = zonedDateTimeParts(candidate, timeZone);
      if (
        actual.year === new Date(target).getUTCFullYear() &&
        actual.month === new Date(target).getUTCMonth() + 1 &&
        actual.day === new Date(target).getUTCDate() &&
        actual.hour === new Date(target).getUTCHours() &&
        actual.minute === new Date(target).getUTCMinutes()
      ) candidates.add(candidate);
    }
    return candidates.size ? Math.min(...candidates) : null;
  };

  const exact = resolveExact(wallClock);
  if (exact !== null) return exact;
  for (let offset = 1; offset <= 180; offset += 1) {
    const nextRealMinute = resolveExact(wallClock + offset * 60_000);
    if (nextRealMinute !== null) return nextRealMinute;
  }
  return null;
}

export type PlannerReminderInstance = {
  taskId: string;
  occurrenceDate: string;
  title: string;
  reminderAt: number;
};

/** Build upcoming reminders locally; callers must not send the returned text to a server. */
export function getPlannerReminderInstances(
  tasks: PlannerTask[],
  now = new Date(),
  horizonDays = 60,
): PlannerReminderInstance[] {
  if (!Number.isInteger(horizonDays) || horizonDays < 1) {
    throw new Error('The planner reminder horizon is invalid.');
  }
  const nowMs = now.getTime();
  const results: PlannerReminderInstance[] = [];
  for (const task of tasks) {
    if (!task.dueTime || isTaskComplete(task, tasks)) continue;
    const timeZones = new Set([
      task.reminder?.timeZone,
      task.recurrence?.timeZone,
      ...(task.occurrenceOverrides ?? []).map((override) => override.changes?.reminder?.timeZone),
    ].filter((zone): zone is string => Boolean(zone)));
    if (!timeZones.size) continue;
    const byOccurrence = new Map<string, PlannerReminderInstance>();
    for (const timeZone of timeZones) {
      const startDate = getPlannerDateKeyInTimeZone(now, timeZone);
      const endDate = shiftDateKey(startDate, horizonDays);
      for (const occurrence of expandPlannerTaskOccurrences([task], startDate, endDate)) {
        const reminder = occurrence.reminder;
        if (!reminder || occurrence.completed || !occurrence.dueTime) continue;
        const reminderTimeZone = reminder.timeZone || timeZone;
        const dueAt = resolvePlannerLocalDateTime(occurrence.dueDate, occurrence.dueTime, reminderTimeZone);
        if (dueAt === null) continue;
        const reminderAt = dueAt - reminder.minutesBefore * 60_000;
        if (reminderAt <= nowMs) continue;
        byOccurrence.set(occurrence.occurrenceDate ?? occurrence.dueDate, {
          taskId: task.id,
          occurrenceDate: occurrence.occurrenceDate ?? occurrence.dueDate,
          title: occurrence.title,
          reminderAt,
        });
      }
    }
    results.push(...byOccurrence.values());
  }
  return results.sort((left, right) => left.reminderAt - right.reminderAt);
}

function previousScheduledDate(value: string, scheduledDays: number[], includeValue: boolean): string {
  const scheduled = new Set(scheduledDays);
  for (let offset = includeValue ? 0 : 1; offset <= 7; offset += 1) {
    const candidate = shiftDateKey(value, -offset);
    if (scheduled.has(new Date(`${candidate}T00:00:00.000Z`).getUTCDay())) return candidate;
  }
  return '';
}

export type PlannerHabitDayStatus = 'completed' | 'in-progress' | 'paused' | 'skipped' | 'missed' | 'planned' | 'upcoming';
export type PlannerHabitHistoryDay = {
  date: string;
  status: PlannerHabitDayStatus;
  value: number | null;
  goal: number | null;
};

function habitProgressForDate(habit: Pick<PlannerHabit, 'progressEntries'>, date: string): number | null {
  const entry = habit.progressEntries?.filter((candidate) => candidate.date === date)
    .sort((left, right) => (left.changedAt ?? '').localeCompare(right.changedAt ?? '')).at(-1);
  return entry && Number.isFinite(entry.value) ? entry.value : null;
}

function habitIsPausedOn(habit: Pick<PlannerHabit, 'pausedRanges'>, date: string): boolean {
  return (habit.pausedRanges ?? []).some((range) =>
    validDateKey(range.startDate) && date >= range.startDate &&
    (!range.endDate || (validDateKey(range.endDate) && date <= range.endDate)),
  );
}

function habitIsCompletedOn(habit: Pick<PlannerHabit, 'completedDates' | 'measurement' | 'progressEntries' | 'completionEntries'>, date: string): boolean {
  const value = habitProgressForDate(habit, date);
  if (value !== null && habit.measurement) return value >= habit.measurement.goal;
  const completionEntry = habit.completionEntries?.filter((entry) => entry.date === date)
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt)).at(-1);
  if (completionEntry) return completionEntry.completed;
  if (habit.completedDates.includes(date)) return true;
  return value !== null && Boolean(habit.measurement) && value >= habit.measurement!.goal;
}

function habitIsPlannedOn(habit: Pick<PlannerHabit, 'scheduledDays'>, date: string): boolean {
  if (!habit.scheduledDays?.length) return true;
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return habit.scheduledDays.includes(day);
}

/** Return the saved state for every local calendar date in an inclusive range. */
export function getPlannerHabitHistory(
  habit: Pick<PlannerHabit, 'completedDates' | 'scheduledDays' | 'measurement' | 'progressEntries' | 'completionEntries' | 'pausedRanges' | 'skippedDates' | 'skipEntries'>,
  startDate: string,
  endDate: string,
  today = endDate,
): PlannerHabitHistoryDay[] {
  if (!validDateKey(startDate) || !validDateKey(endDate) || endDate < startDate || !validDateKey(today)) {
    throw new Error('The habit history date range is invalid.');
  }
  const days: PlannerHabitHistoryDay[] = [];
  for (let date = startDate; date <= endDate; date = shiftDateKey(date, 1)) {
    const skipEntry = habit.skipEntries?.filter((entry) => entry.date === date)
      .sort((left, right) => left.changedAt.localeCompare(right.changedAt)).at(-1);
    const skipped = skipEntry ? skipEntry.skipped : (habit.skippedDates ?? []).includes(date);
    const value = habitProgressForDate(habit, date);
    const planned = habitIsPlannedOn(habit, date);
    const completed = habitIsCompletedOn(habit, date);
    const status: PlannerHabitDayStatus = completed
      ? 'completed'
      : value !== null && value > 0
        ? 'in-progress'
        : habitIsPausedOn(habit, date)
          ? 'paused'
          : skipped
            ? 'skipped'
            : !planned || date > today
              ? 'upcoming'
              : date < today
                ? 'missed'
                : 'planned';
    days.push({ date, status, value, goal: habit.measurement?.goal ?? null });
  }
  return days;
}

/** Return the Monday-to-Sunday week containing anchorDate. */
export function getPlannerHabitWeek(
  habit: Parameters<typeof getPlannerHabitHistory>[0],
  anchorDate: string,
  today = anchorDate,
): PlannerHabitHistoryDay[] {
  if (!validDateKey(anchorDate)) throw new Error('The habit history date is invalid.');
  const weekday = new Date(`${anchorDate}T00:00:00.000Z`).getUTCDay();
  const startDate = shiftDateKey(anchorDate, -((weekday + 6) % 7));
  return getPlannerHabitHistory(habit, startDate, shiftDateKey(startDate, 6), today);
}

export function setPlannerHabitProgress(
  habit: PlannerHabit,
  date: string,
  value: number,
  changedAt?: string,
): PlannerHabit {
  if (!validDateKey(date) || !Number.isFinite(value) || value < 0) {
    throw new Error('The habit progress entry is invalid.');
  }
  const progressEntries = [
    ...(habit.progressEntries ?? []).filter((entry) => entry.date !== date),
    { date, value, ...(changedAt ? { changedAt } : {}) },
  ].sort((left, right) => left.date.localeCompare(right.date));
  if (!habit.measurement) return { ...habit, progressEntries };
  const completed = value >= habit.measurement.goal;
  const completedDates = completed
    ? [...new Set([...habit.completedDates, date])].sort()
    : habit.completedDates.filter((completedDate) => completedDate !== date);
  const completionEntries = [
    ...(habit.completionEntries ?? []).filter((entry) => entry.date !== date),
    { date, completed, changedAt: changedAt ?? new Date().toISOString() },
  ].sort((left, right) => left.date.localeCompare(right.date));
  return { ...habit, completedDates, progressEntries, completionEntries };
}

export function setPlannerHabitCompleted(
  habit: PlannerHabit,
  date: string,
  completed: boolean,
  changedAt = new Date().toISOString(),
): PlannerHabit {
  if (!validDateKey(date) || typeof completed !== 'boolean' || typeof changedAt !== 'string') {
    throw new Error('The habit completion entry is invalid.');
  }
  return {
    ...habit,
    completedDates: completed
      ? [...new Set([...habit.completedDates, date])].sort()
      : habit.completedDates.filter((completedDate) => completedDate !== date),
    completionEntries: [
      ...(habit.completionEntries ?? []).filter((entry) => entry.date !== date),
      { date, completed, changedAt },
    ].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export function setPlannerHabitSkipped(habit: PlannerHabit, date: string, skipped = true, changedAt = new Date().toISOString()): PlannerHabit {
  if (!validDateKey(date)) throw new Error('The habit skip date is invalid.');
  return {
    ...habit,
    skippedDates: skipped
      ? [...new Set([...(habit.skippedDates ?? []), date])].sort()
      : (habit.skippedDates ?? []).filter((candidate) => candidate !== date),
    skipEntries: [
      ...(habit.skipEntries ?? []).filter((entry) => entry.date !== date),
      { date, skipped, changedAt },
    ].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export function pausePlannerHabit(
  habit: PlannerHabit,
  startDate: string,
  endDate?: string,
  changedAt = new Date().toISOString(),
): PlannerHabit {
  if (!validDateKey(startDate) || (endDate !== undefined && (!validDateKey(endDate) || endDate < startDate))) {
    throw new Error('The habit pause date range is invalid.');
  }
  const pausedRanges = [...(habit.pausedRanges ?? []).filter((range) => range.startDate !== startDate),
    { startDate, ...(endDate ? { endDate } : {}), changedAt },
  ].sort((left, right) => left.startDate.localeCompare(right.startDate));
  return { ...habit, pausedRanges };
}

export function resumePlannerHabit(habit: PlannerHabit, resumeDate: string, changedAt = new Date().toISOString()): PlannerHabit {
  if (!validDateKey(resumeDate)) throw new Error('The habit resume date is invalid.');
  const yesterday = shiftDateKey(resumeDate, -1);
  const pausedRanges = (habit.pausedRanges ?? []).flatMap((range) => {
    if (range.startDate > resumeDate) return [range];
    if (range.startDate >= resumeDate) return [];
    if (range.endDate && range.endDate < resumeDate) return [range];
    return [{ ...range, endDate: yesterday, changedAt }];
  });
  return { ...habit, pausedRanges };
}

/** Summarize saved completion dates using a Monday-to-Sunday week. */
export function summarizePlannerHabit(
  habit: Pick<PlannerHabit, 'completedDates' | 'scheduledDays' | 'weeklyTarget' | 'measurement' | 'progressEntries' | 'completionEntries' | 'pausedRanges' | 'skippedDates' | 'skipEntries'>,
  today: string,
): PlannerHabitSummary {
  if (!validDateKey(today)) throw new Error('The habit summary date is invalid.');

  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const weekStart = shiftDateKey(today, -((weekday + 6) % 7));
  const thisWeek = Array.from({ length: 7 }, (_, index) => shiftDateKey(weekStart, index));
  const validScheduledDays = Array.isArray(habit.scheduledDays)
    ? [...new Set(habit.scheduledDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  const hasSchedule = validScheduledDays.length > 0;
  const validWeeklyTarget = Number.isInteger(habit.weeklyTarget) && habit.weeklyTarget! >= 1 && habit.weeklyTarget! <= 7
    ? habit.weeklyTarget!
    : null;

  const weekHistory = getPlannerHabitHistory(habit, weekStart, shiftDateKey(weekStart, 6), today)
    .filter((day) => !hasSchedule || validScheduledDays.includes(new Date(`${day.date}T00:00:00.000Z`).getUTCDay()));
  const completedThisWeek = weekHistory.filter((day) => day.status === 'completed').length;
  const weeklyTarget = hasSchedule ? validScheduledDays.length : validWeeklyTarget;
  const plannedThisWeek = weekHistory.filter((day) => day.date <= today && day.status !== 'paused' && day.status !== 'skipped' && day.status !== 'upcoming').length;
  const pausedThisWeek = weekHistory.filter((day) => day.date <= today && day.status === 'paused').length;
  const skippedThisWeek = weekHistory.filter((day) => day.date <= today && day.status === 'skipped').length;
  const missedThisWeek = weekHistory.filter((day) => day.status === 'missed').length;

  let currentStreak = 0;
  let streakDate = hasSchedule
    ? previousScheduledDate(today, validScheduledDays, true)
    : habitIsCompletedOn(habit, today)
      ? today
      : habitIsPausedOn(habit, today) || (habit.skippedDates ?? []).includes(today)
        ? today
        : habitIsCompletedOn(habit, shiftDateKey(today, -1)) ||
          habitIsPausedOn(habit, shiftDateKey(today, -1)) ||
          (habit.skippedDates ?? []).includes(shiftDateKey(today, -1))
        ? shiftDateKey(today, -1)
        : '';
  if (hasSchedule && streakDate === today && !habitIsCompletedOn(habit, today)) {
    streakDate = previousScheduledDate(today, validScheduledDays, false);
  }
  let streakLookback = 0;
  while (streakDate && streakLookback < 3660) {
    streakLookback += 1;
    if (habitIsCompletedOn(habit, streakDate)) {
      currentStreak += 1;
    } else if (!habitIsPausedOn(habit, streakDate) && !(habit.skippedDates ?? []).includes(streakDate)) {
      break;
    }
    streakDate = hasSchedule
      ? previousScheduledDate(streakDate, validScheduledDays, false)
      : shiftDateKey(streakDate, -1);
  }

  return { completedThisWeek, weeklyTarget, currentStreak, plannedThisWeek, pausedThisWeek, skippedThisWeek, missedThisWeek };
}

export type RoutineStep = {
  id: string;
  title: string;
};

export type PlannerRoutineRun = {
  id: string;
  startedAt: string;
  steps: RoutineStep[];
  completedStepIds: string[];
  completedAt?: string;
  /** Latest explicit completion state for steps corrected after the run was recorded. */
  stepCorrections?: Array<{ stepId: string; completed: boolean; changedAt: string }>;
  /** Deletion marker retained for conflict-safe offline sync; deleted runs are hidden in clients. */
  deletedAt?: string;
};

export type PlannerRoutine = {
  id: string;
  title: string;
  steps: RoutineStep[];
  runs?: PlannerRoutineRun[];
};

/** Start a dated run without changing the routine definition. */
export function startPlannerRoutineRun(
  routine: PlannerRoutine,
  runId: string,
  startedAt: string,
): PlannerRoutine {
  if (!routine.steps.length) return routine;
  const run: PlannerRoutineRun = {
    id: runId,
    startedAt,
    steps: routine.steps.map((step) => ({ ...step })),
    completedStepIds: [],
  };
  return { ...routine, runs: [run, ...(routine.runs ?? [])] };
}

/** Mark a step complete in a saved run; completion is monotonic for sync safety. */
export function completePlannerRoutineStep(
  routine: PlannerRoutine,
  runId: string,
  stepId: string,
  completedAt: string,
): PlannerRoutine {
  return setPlannerRoutineStepCompletion(routine, runId, stepId, true, completedAt);
}

export function isPlannerRoutineStepComplete(run: PlannerRoutineRun, stepId: string): boolean {
  const correction = run.stepCorrections?.find((entry) => entry.stepId === stepId);
  return correction ? correction.completed : run.completedStepIds.includes(stepId);
}

/** Explicit step state supports corrections while retaining a timestamped conflict winner. */
export function setPlannerRoutineStepCompletion(
  routine: PlannerRoutine,
  runId: string,
  stepId: string,
  completed: boolean,
  changedAt: string,
): PlannerRoutine {
  const runs = routine.runs;
  const run = runs?.find((candidate) => candidate.id === runId);
  if (!run || run.deletedAt || !run.steps.some((step) => step.id === stepId)) return routine;
  if (isPlannerRoutineStepComplete(run, stepId) === completed) return routine;
  const stepCorrections = [
    ...(run.stepCorrections ?? []).filter((entry) => entry.stepId !== stepId),
    { stepId, completed, changedAt },
  ];
  const completedStepIds = completed
    ? [...new Set([...run.completedStepIds, stepId])]
    : run.completedStepIds.filter((id) => id !== stepId);
  const isComplete = run.steps.every((step) =>
    step.id === stepId ? completed : isPlannerRoutineStepComplete(run, step.id),
  );
  return {
    ...routine,
    runs: runs!.map((candidate) => candidate.id === runId
      ? {
          ...candidate,
          completedStepIds,
          stepCorrections,
          ...(isComplete ? { completedAt: changedAt } : { completedAt: undefined }),
        }
      : candidate),
  };
}

export function deletePlannerRoutineRun(
  routine: PlannerRoutine,
  runId: string,
  deletedAt: string,
): PlannerRoutine {
  if (!routine.runs?.some((run) => run.id === runId && !run.deletedAt)) return routine;
  return {
    ...routine,
    runs: routine.runs.map((run) => run.id === runId ? { ...run, deletedAt } : run),
  };
}

function latestByTimestamp<T extends { changedAt: string }>(left: T, right: T): T {
  if (left.changedAt !== right.changedAt) return left.changedAt > right.changedAt ? left : right;
  return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
}

function mergeRoutineRunHistory(
  localRuns: PlannerRoutineRun[] | undefined,
  remoteRuns: PlannerRoutineRun[] | undefined,
): PlannerRoutineRun[] {
  const merged = new Map<string, PlannerRoutineRun>();
  for (const run of [...(remoteRuns ?? []), ...(localRuns ?? [])]) {
    const existing = merged.get(run.id);
    if (!existing) {
      merged.set(run.id, { ...run, steps: run.steps.map((step) => ({ ...step })), completedStepIds: [...run.completedStepIds] });
      continue;
    }
    const steps = existing.steps;
    const corrections = new Map<string, { stepId: string; completed: boolean; changedAt: string }>();
    for (const correction of [...(existing.stepCorrections ?? []), ...(run.stepCorrections ?? [])]) {
      const current = corrections.get(correction.stepId);
      corrections.set(correction.stepId, current ? latestByTimestamp(current, correction) : correction);
    }
    const stepCorrections = [...corrections.values()].filter((entry) => steps.some((step) => step.id === entry.stepId));
    const completedStepIds = [...new Set([...existing.completedStepIds, ...run.completedStepIds])]
      .filter((id) => steps.some((step) => step.id === id));
    const isComplete = steps.every((step) => {
      const correction = corrections.get(step.id);
      return correction ? correction.completed : completedStepIds.includes(step.id);
    });
    const latestCompletionChange = stepCorrections.filter((entry) => entry.completed)
      .map((entry) => entry.changedAt).sort().at(-1);
    merged.set(run.id, {
      ...existing,
      completedStepIds,
      ...(stepCorrections.length ? { stepCorrections } : {}),
      ...(existing.deletedAt || run.deletedAt ? { deletedAt: existing.deletedAt ?? run.deletedAt } : {}),
      ...(isComplete
        ? (existing.completedAt || run.completedAt || latestCompletionChange
          ? { completedAt: [existing.completedAt, run.completedAt, latestCompletionChange].filter(Boolean).sort().at(-1) }
          : {})
        : { completedAt: undefined }),
    });
  }
  return [...merged.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function sameRoutineDefinition(left: PlannerRoutine, right: PlannerRoutine): boolean {
  const { runs: _leftRuns, ...leftDefinition } = left;
  const { runs: _rightRuns, ...rightDefinition } = right;
  return sameJson(leftDefinition, rightDefinition);
}

function mergeRoutineRecords(
  local: PlannerRoutine,
  remote: PlannerRoutine,
  prefer: 'local' | 'remote' = 'remote',
): PlannerRoutine {
  const hasHistory = 'runs' in local || 'runs' in remote;
  return hasHistory
    ? { ...(prefer === 'local' ? local : remote), runs: mergeRoutineRunHistory(local.runs, remote.runs) }
    : (prefer === 'local' ? local : remote);
}

function sameTaskDefinition(left: PlannerTask, right: PlannerTask): boolean {
  const { occurrenceOverrides: _leftOverrides, occurrenceDate: _leftDate, seriesTaskId: _leftSeriesId, ...leftDefinition } = left;
  const { occurrenceOverrides: _rightOverrides, occurrenceDate: _rightDate, seriesTaskId: _rightSeriesId, ...rightDefinition } = right;
  return sameJson(leftDefinition, rightDefinition);
}

function mergeTaskOccurrences(local: PlannerTask, remote: PlannerTask): PlannerTask {
  const byDate = new Map<string, PlannerTaskOccurrenceOverride>();
  for (const entry of [...(remote.occurrenceOverrides ?? []), ...(local.occurrenceOverrides ?? [])]) {
    const existing = byDate.get(entry.date);
    byDate.set(entry.date, existing ? latestByTimestamp(existing, entry) : entry);
  }
  const result = {
    ...remote,
    ...(remote.calendarEventRef || local.calendarEventRef
      ? { calendarEventRef: remote.calendarEventRef ?? local.calendarEventRef }
      : {}),
  };
  if (byDate.size || 'occurrenceOverrides' in local || 'occurrenceOverrides' in remote) {
    result.occurrenceOverrides = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }
  return result;
}

function sameTaskExceptCalendarEvent(left: PlannerTask, right: PlannerTask): boolean {
  const strip = (task: PlannerTask) => {
    const {
      occurrenceOverrides: _overrides,
      occurrenceDate: _date,
      seriesTaskId: _seriesId,
      calendarEventRef: _eventRef,
      calendarEventRequestKey: _requestKey,
      ...definition
    } = task;
    return definition;
  };
  return sameJson(strip(left), strip(right));
}

function dateKeyAdd(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
}

function recurrenceMatches(task: PlannerTask, date: string): boolean {
  const rule = task.recurrence;
  if (!rule || !validDateKey(task.dueDate) || !validDateKey(date) || date < task.dueDate) return false;
  if (rule.endsOn && (!validDateKey(rule.endsOn) || date > rule.endsOn)) return false;
  const interval = Number.isInteger(rule.interval) && rule.interval! > 0 ? rule.interval! : 1;
  const offset = daysBetween(task.dueDate, date);
  if (rule.frequency === 'daily') return offset % interval === 0;
  if (rule.frequency === 'weekly') {
    const anchor = new Date(`${task.dueDate}T00:00:00.000Z`);
    const candidate = new Date(`${date}T00:00:00.000Z`);
    const anchorWeek = Math.floor((Date.parse(`${task.dueDate}T00:00:00.000Z`) - ((anchor.getUTCDay() + 6) % 7) * 86_400_000) / 86_400_000);
    const candidateWeek = Math.floor((Date.parse(`${date}T00:00:00.000Z`) - ((candidate.getUTCDay() + 6) % 7) * 86_400_000) / 86_400_000);
    const weekdays = rule.weekdays?.length ? rule.weekdays : [anchor.getUTCDay()];
    return (candidateWeek - anchorWeek) / 7 % interval === 0 && weekdays.includes(candidate.getUTCDay());
  }
  if (rule.frequency === 'monthly') {
    const anchor = new Date(`${task.dueDate}T00:00:00.000Z`);
    const candidate = new Date(`${date}T00:00:00.000Z`);
    const monthOffset = (candidate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + candidate.getUTCMonth() - anchor.getUTCMonth();
    return monthOffset >= 0 && monthOffset % interval === 0 && candidate.getUTCDate() === anchor.getUTCDate();
  }
  return false;
}

/** Expand a recurrence into local-calendar-date occurrences for the requested inclusive range. */
export function expandPlannerTaskOccurrences(tasks: PlannerTask[], startDate: string, endDate: string): PlannerTask[] {
  if (!validDateKey(startDate) || !validDateKey(endDate) || endDate < startDate) {
    throw new Error('The task occurrence date range is invalid.');
  }
  const expanded: PlannerTask[] = [];
  for (const task of tasks) {
    if (!task.recurrence) {
      if (task.dueDate >= startDate && task.dueDate <= endDate) expanded.push(task);
      continue;
    }
    const overrides = new Map((task.occurrenceOverrides ?? []).map((entry) => [entry.date, entry]));
    const appendOccurrence = (originDate: string) => {
      const override = overrides.get(originDate);
      if (override?.cancelled) return;
      const changes = override?.changes ?? {};
      const dueDate = changes.dueDate ?? originDate;
      if (dueDate < startDate || dueDate > endDate) return;
      expanded.push({
        ...task,
        completed: originDate === task.dueDate ? task.completed : false,
        ...changes,
        dueDate,
        id: `${task.id}::occ::${originDate}`,
        recurrence: task.recurrence,
        occurrenceDate: originDate,
        seriesTaskId: task.id,
      });
    };
    let cursor = task.dueDate < startDate ? startDate : task.dueDate;
    while (cursor <= endDate) {
      if (recurrenceMatches(task, cursor)) {
        appendOccurrence(cursor);
      }
      cursor = dateKeyAdd(cursor, 1);
    }
    for (const override of overrides.values()) {
      if (override.changes?.dueDate && override.changes.dueDate >= startDate &&
          override.changes.dueDate <= endDate && override.date < startDate) {
        appendOccurrence(override.date);
      }
    }
  }
  return expanded.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.dueTime.localeCompare(right.dueTime));
}

/** Save, correct, or cancel one occurrence without mutating the series or its other dates. */
export function updatePlannerTaskOccurrence(
  dataValue: unknown,
  taskId: string,
  date: string,
  changes: PlannerTaskOccurrenceOverride['changes'],
  changedAt: string,
  cancelled = false,
): PlannerData {
  const data = normalizePlannerData(dataValue);
  if (!validDateKey(date)) throw new Error('The task occurrence date is invalid.');
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (task.id !== taskId || !task.recurrence) return task;
      const next: PlannerTaskOccurrenceOverride = {
        date,
        ...(changes && Object.keys(changes).length ? { changes } : {}),
        ...(cancelled ? { cancelled: true } : {}),
        changedAt,
      };
      return {
        ...task,
        occurrenceOverrides: [
          ...(task.occurrenceOverrides ?? []).filter((entry) => entry.date !== date),
          next,
        ].sort((left, right) => left.date.localeCompare(right.date)),
      };
    }),
  };
}

export type PlannerSettings = {
  theme: 'light' | 'dark';
  accentHex: string;
  /** Whether locally scheduled task notifications may show task titles. */
  showTaskTitlesInReminders?: boolean;
  /** Preferred writable Google calendar; kept in the encrypted planner snapshot. */
  preferredCalendarId?: string;
  /** Ordered Today widgets; omitted snapshots use DEFAULT_TODAY_WIDGET_ORDER. */
  todayWidgetOrder?: TodayWidgetId[];
  [key: string]: unknown;
};

export const TODAY_WIDGET_IDS = ['progress', 'tasks', 'notes', 'habits', 'routines'] as const;
export type TodayWidgetId = typeof TODAY_WIDGET_IDS[number];
export const DEFAULT_TODAY_WIDGET_ORDER: TodayWidgetId[] = ['progress', 'tasks', 'notes'];

export function resolvePreferredCalendar(
  preferredCalendarId: string | undefined,
  calendars: Array<{ id: string; primary: boolean; accessRole: string }>,
  selectedCalendarIds: string[] = [],
): { calendarId: string | null; usedFallback: boolean } {
  const writable = calendars.filter((calendar) =>
    calendar.accessRole === 'owner' || calendar.accessRole === 'writer',
  );
  if (preferredCalendarId && writable.some((calendar) => calendar.id === preferredCalendarId)) {
    return { calendarId: preferredCalendarId, usedFallback: false };
  }
  const fallback = writable.find((calendar) => calendar.primary)
    ?? writable.find((calendar) => selectedCalendarIds.includes(calendar.id))
    ?? writable[0];
  return {
    calendarId: fallback?.id ?? null,
    usedFallback: Boolean(preferredCalendarId && fallback?.id !== preferredCalendarId),
  };
}

/** Read a valid, de-duplicated widget order without modifying a legacy snapshot. */
export function getTodayWidgetOrder(settings: Pick<PlannerSettings, 'todayWidgetOrder'>): TodayWidgetId[] {
  const allowed = new Set<string>(TODAY_WIDGET_IDS);
  const order = settings.todayWidgetOrder?.filter((widget, index, values) =>
    allowed.has(widget) && values.indexOf(widget) === index,
  ) ?? [];
  return order.length ? order : [...DEFAULT_TODAY_WIDGET_ORDER];
}

export type PlannerData = {
  tasks: PlannerTask[];
  notes: PlannerNote[];
  settings: PlannerSettings;
  projects?: PlannerProject[];
  inbox?: InboxItem[];
  habits?: PlannerHabit[];
  routines?: PlannerRoutine[];
  deletedRecords?: PlannerTombstone[];
  [key: string]: unknown;
};

const collectionKeys = ['tasks', 'notes', 'projects', 'inbox', 'habits', 'routines'] as const;
type CollectionKey = typeof collectionKeys[number];
export type PlannerCollectionKey = CollectionKey;
export type PlannerTombstone = {
  collection: CollectionKey;
  id: string;
  record: Record<string, unknown>;
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const habitHistoryKeys = ['completedDates', 'progressEntries', 'completionEntries', 'pausedRanges', 'skippedDates', 'skipEntries'] as const;

function sameHabitDefinition(left: PlannerHabit, right: PlannerHabit): boolean {
  const strip = (habit: PlannerHabit) => {
    const { completedDates: _completed, progressEntries: _progress, completionEntries: _completion, pausedRanges: _paused, skippedDates: _skipped, skipEntries: _skipEntries, ...definition } = habit;
    return definition;
  };
  return sameJson(strip(left), strip(right));
}

function mergeHabitHistory(local: PlannerHabit, remote: PlannerHabit): Pick<PlannerHabit, 'completedDates' | 'progressEntries' | 'completionEntries' | 'pausedRanges' | 'skippedDates' | 'skipEntries'> {
  const completedDates = [...new Set([...(remote.completedDates ?? []), ...(local.completedDates ?? [])])].sort();
  const progressByDate = new Map<string, PlannerHabitProgress>();
  for (const entry of [...(remote.progressEntries ?? []), ...(local.progressEntries ?? [])]) {
    const existing = progressByDate.get(entry.date);
    if (!existing) {
      progressByDate.set(entry.date, entry);
    } else if (existing.changedAt !== entry.changedAt) {
      progressByDate.set(entry.date, (existing.changedAt ?? '') > (entry.changedAt ?? '') ? existing : entry);
    } else {
      progressByDate.set(entry.date, JSON.stringify(existing) >= JSON.stringify(entry) ? existing : entry);
    }
  }
  const completionByDate = new Map<string, PlannerHabitCompletion>();
  for (const entry of [...(remote.completionEntries ?? []), ...(local.completionEntries ?? [])]) {
    const existing = completionByDate.get(entry.date);
    completionByDate.set(entry.date, existing ? latestByTimestamp(existing, entry) : entry);
  }
  const pausedByRange = new Map<string, NonNullable<PlannerHabit['pausedRanges']>[number]>();
  for (const range of [...(remote.pausedRanges ?? []), ...(local.pausedRanges ?? [])]) {
    const existing = pausedByRange.get(range.startDate);
    if (!existing ||
        (range.changedAt ?? '') > (existing.changedAt ?? '') ||
        ((range.changedAt ?? '') === (existing.changedAt ?? '') &&
          (range.endDate !== undefined && existing.endDate === undefined ||
            JSON.stringify(range) > JSON.stringify(existing)))) {
      pausedByRange.set(range.startDate, range);
    }
  }
  const skipByDate = new Map<string, PlannerHabitSkip>();
  for (const entry of [...(remote.skipEntries ?? []), ...(local.skipEntries ?? [])]) {
    const existing = skipByDate.get(entry.date);
    if (!existing || entry.changedAt > existing.changedAt ||
        (entry.changedAt === existing.changedAt && JSON.stringify(entry) > JSON.stringify(existing))) {
      skipByDate.set(entry.date, entry);
    }
  }
  const legacySkipped = new Set([...(remote.skippedDates ?? []), ...(local.skippedDates ?? [])]);
  for (const [date, entry] of skipByDate) {
    if (entry.skipped) legacySkipped.add(date);
    else legacySkipped.delete(date);
  }
  return {
    completedDates,
    ...(local.progressEntries !== undefined || remote.progressEntries !== undefined
      ? { progressEntries: [...progressByDate.values()].sort((left, right) => left.date.localeCompare(right.date)) }
      : {}),
    ...(local.completionEntries !== undefined || remote.completionEntries !== undefined
      ? { completionEntries: [...completionByDate.values()].sort((left, right) => left.date.localeCompare(right.date)) }
      : {}),
    ...(local.pausedRanges !== undefined || remote.pausedRanges !== undefined
      ? { pausedRanges: [...pausedByRange.values()].sort((left, right) => left.startDate.localeCompare(right.startDate)) }
      : {}),
    ...(local.skippedDates !== undefined || remote.skippedDates !== undefined || local.skipEntries !== undefined || remote.skipEntries !== undefined
      ? { skippedDates: [...legacySkipped].sort() }
      : {}),
    ...(local.skipEntries !== undefined || remote.skipEntries !== undefined
      ? { skipEntries: [...skipByDate.values()].sort((left, right) => left.date.localeCompare(right.date)) }
      : {}),
  };
}

function mergeHabitRecords(local: PlannerHabit, remote: PlannerHabit): PlannerHabit {
  return { ...remote, ...mergeHabitHistory(local, remote) };
}

function mergeHabitRecordsThreeWay(
  base: PlannerHabit,
  local: PlannerHabit,
  remote: PlannerHabit,
): PlannerHabit | undefined {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const baseRecord = base as unknown as Record<string, unknown>;
  const localRecord = local as unknown as Record<string, unknown>;
  const remoteRecord = remote as unknown as Record<string, unknown>;
  const definition: Record<string, unknown> = {};
  for (const key of keys) {
    if ((habitHistoryKeys as readonly string[]).includes(key)) continue;
    const localChanged = !sameJson(localRecord[key], baseRecord[key]);
    const remoteChanged = !sameJson(remoteRecord[key], baseRecord[key]);
    if (localChanged && remoteChanged && !sameJson(localRecord[key], remoteRecord[key])) return undefined;
    const chosen = localChanged ? localRecord[key] : remoteRecord[key];
    if (chosen !== undefined) definition[key] = chosen;
  }
  return { ...definition, ...mergeHabitHistory(local, remote) } as PlannerHabit;
}

function mergeCollection<T extends { id: string; title?: string }>(
  key: CollectionKey,
  base: T[],
  local: T[],
  remote: T[],
  makeId: () => string,
): T[] {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
  const result: T[] = [];
  const resultIds = new Set<string>();

  for (const id of ids) {
    const before = baseById.get(id);
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);
    const bothRoutineRecords = key === 'routines' && localItem && remoteItem
      ? mergeRoutineRecords(localItem as unknown as PlannerRoutine, remoteItem as unknown as PlannerRoutine) as unknown as T
      : undefined;
    const bothHabitRecords = key === 'habits' && localItem && remoteItem && sameHabitDefinition(
      localItem as unknown as PlannerHabit,
      remoteItem as unknown as PlannerHabit,
    )
      ? mergeHabitRecords(localItem as unknown as PlannerHabit, remoteItem as unknown as PlannerHabit) as unknown as T
      : undefined;
    const bothTaskRecords = key === 'tasks' && localItem && remoteItem &&
      sameTaskExceptCalendarEvent(localItem as unknown as PlannerTask, remoteItem as unknown as PlannerTask)
      ? mergeTaskOccurrences(localItem as unknown as PlannerTask, remoteItem as unknown as PlannerTask) as unknown as T
      : undefined;
    const comparable = (item: T | undefined) => {
      if (!item) return item;
      if (key === 'routines') {
        const { runs: _runs, ...definition } = item as unknown as PlannerRoutine;
        return definition;
      }
      if (key === 'tasks') {
      const { occurrenceOverrides: _overrides, occurrenceDate: _date, seriesTaskId: _seriesId, ...definition } = item as unknown as PlannerTask;
        return definition;
      }
      if (key === 'habits') {
        const { completedDates: _completed, progressEntries: _progress, completionEntries: _completion, pausedRanges: _paused, skippedDates: _skipped, skipEntries: _skipEntries, ...definition } = item as unknown as PlannerHabit;
        return definition;
      }
      return item;
    };

    if (key === 'habits' && localItem && remoteItem && before) {
      const mergedHabit = mergeHabitRecordsThreeWay(
        before as unknown as PlannerHabit,
        localItem as unknown as PlannerHabit,
        remoteItem as unknown as PlannerHabit,
      );
      if (mergedHabit) {
        result.push(mergedHabit as unknown as T);
        resultIds.add(id);
        continue;
      }
    }

    if (bothHabitRecords) {
      result.push(bothHabitRecords);
      resultIds.add(id);
      continue;
    }

    if (bothTaskRecords) {
      result.push(bothTaskRecords);
      resultIds.add(id);
      continue;
    }

    if (
      localItem && remoteItem &&
      key === 'routines' &&
      sameRoutineDefinition(localItem as unknown as PlannerRoutine, remoteItem as unknown as PlannerRoutine)
    ) {
      result.push(bothRoutineRecords!);
      resultIds.add(id);
      continue;
    }

    if (sameJson(comparable(localItem), comparable(remoteItem))) {
      const item = bothRoutineRecords ?? bothTaskRecords ?? bothHabitRecords ?? localItem ?? remoteItem;
      if (item) result.push(item);
      resultIds.add(id);
      continue;
    }

    const localChanged = !sameJson(comparable(localItem), comparable(before));
    const remoteChanged = !sameJson(comparable(remoteItem), comparable(before));

    if (!localChanged) {
      if (remoteItem) result.push(bothRoutineRecords ?? remoteItem);
      resultIds.add(id);
      continue;
    }
    if (!remoteChanged) {
      if (localItem) result.push(bothRoutineRecords ?? localItem);
      resultIds.add(id);
      continue;
    }

    // If one side deleted a record while the other edited it, keep the edit.
    if (!localItem || !remoteItem) {
      const survivingItem = localItem ?? remoteItem;
      if (survivingItem) result.push(survivingItem);
      resultIds.add(id);
      continue;
    }

    result.push(bothRoutineRecords ?? remoteItem);
    let copyId = makeId();
    while (resultIds.has(copyId) || ids.has(copyId)) copyId = makeId();
    const copyTitle =
      typeof localItem.title === 'string'
        ? `Conflict copy — ${localItem.title.replace(/^Conflict copy — /, '')}`
        : localItem.title;
    const localConflict = key === 'routines'
      ? mergeRoutineRecords(
          localItem as unknown as PlannerRoutine,
          remoteItem as unknown as PlannerRoutine,
          'local',
        ) as unknown as T
      : key === 'habits'
        ? mergeHabitRecords(localItem as unknown as PlannerHabit, remoteItem as unknown as PlannerHabit) as unknown as T
        : localItem;
    result.push({ ...localConflict, id: copyId, title: copyTitle } as T);
    resultIds.add(id);
    resultIds.add(copyId);
  }

  return result;
}

function mergeObject<T extends Record<string, unknown>>(
  base: T,
  local: T,
  remote: T,
): T {
  const merged: Record<string, unknown> = { ...remote };
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    if (!sameJson(local[key], base[key])) {
      if (key in local) merged[key] = local[key];
      else delete merged[key];
    }
  }
  return merged as T;
}

export function normalizePlannerData(value: unknown): PlannerData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The decrypted planner data is invalid.');
  }
  const candidate = value as Partial<PlannerData>;
  if (
    !Array.isArray(candidate.tasks) ||
    !Array.isArray(candidate.notes) ||
    !candidate.settings ||
    typeof candidate.settings !== 'object' ||
    Array.isArray(candidate.settings) ||
    collectionKeys.some((key) =>
      candidate[key] !== undefined && !Array.isArray(candidate[key]),
    ) ||
    (candidate.deletedRecords !== undefined &&
      (!Array.isArray(candidate.deletedRecords) ||
        candidate.deletedRecords.some((entry) =>
          !entry ||
          typeof entry !== 'object' ||
          !collectionKeys.includes(entry.collection) ||
          typeof entry.id !== 'string' ||
          !entry.record ||
          typeof entry.record !== 'object' ||
          Array.isArray(entry.record),
        ))) ||
    (candidate.settings.preferredCalendarId !== undefined &&
      (typeof candidate.settings.preferredCalendarId !== 'string' ||
        !candidate.settings.preferredCalendarId.trim())) ||
    (candidate.settings.showTaskTitlesInReminders !== undefined &&
      typeof candidate.settings.showTaskTitlesInReminders !== 'boolean') ||
    (candidate.settings.todayWidgetOrder !== undefined &&
      (!Array.isArray(candidate.settings.todayWidgetOrder) ||
        candidate.settings.todayWidgetOrder.length === 0 ||
        candidate.settings.todayWidgetOrder.some((widget) =>
          !TODAY_WIDGET_IDS.includes(widget as TodayWidgetId),
        ) ||
        new Set(candidate.settings.todayWidgetOrder).size !== candidate.settings.todayWidgetOrder.length)) ||
    candidate.tasks.some((task) => task.calendarEventRequestKey !== undefined &&
      (typeof task.calendarEventRequestKey !== 'string' || task.calendarEventRequestKey.length < 16)) ||
    candidate.tasks.some((task) => task.calendarEventRef !== undefined &&
      (!task.calendarEventRef || typeof task.calendarEventRef !== 'object' ||
        typeof task.calendarEventRef.calendarId !== 'string' || !task.calendarEventRef.calendarId.trim() ||
        typeof task.calendarEventRef.eventId !== 'string' || !task.calendarEventRef.eventId.trim() ||
        (task.calendarEventRef.htmlLink !== undefined && typeof task.calendarEventRef.htmlLink !== 'string') ||
        (task.calendarEventRef.idempotencyKey !== undefined &&
          (typeof task.calendarEventRef.idempotencyKey !== 'string' || task.calendarEventRef.idempotencyKey.length < 16)))) ||
    (candidate.habits ?? []).some((habit) =>
      !habit || typeof habit.id !== 'string' || typeof habit.title !== 'string' || !Array.isArray(habit.completedDates) ||
      (habit.measurement !== undefined &&
        (!habit.measurement || !Number.isFinite(habit.measurement.goal) || habit.measurement.goal <= 0 ||
          typeof habit.measurement.unit !== 'string' || !habit.measurement.unit.trim())) ||
      (habit.progressEntries !== undefined &&
        (!Array.isArray(habit.progressEntries) || habit.progressEntries.some((entry) =>
          !entry || !validDateKey(entry.date) || !Number.isFinite(entry.value) || entry.value < 0 ||
          (entry.changedAt !== undefined && typeof entry.changedAt !== 'string')))) ||
      (habit.completionEntries !== undefined &&
        (!Array.isArray(habit.completionEntries) || habit.completionEntries.some((entry) =>
          !entry || !validDateKey(entry.date) || typeof entry.completed !== 'boolean' || typeof entry.changedAt !== 'string'))) ||
      (habit.pausedRanges !== undefined &&
        (!Array.isArray(habit.pausedRanges) || habit.pausedRanges.some((range) =>
          !range || !validDateKey(range.startDate) ||
          (range.endDate !== undefined && (!validDateKey(range.endDate) || range.endDate < range.startDate)) ||
          (range.changedAt !== undefined && typeof range.changedAt !== 'string')))) ||
      (habit.skippedDates !== undefined &&
        (!Array.isArray(habit.skippedDates) || habit.skippedDates.some((date) => !validDateKey(date)))) ||
      (habit.skipEntries !== undefined &&
        (!Array.isArray(habit.skipEntries) || habit.skipEntries.some((entry) =>
          !entry || !validDateKey(entry.date) || typeof entry.skipped !== 'boolean' || typeof entry.changedAt !== 'string')))
    )
  ) {
    throw new Error('The decrypted planner data is invalid.');
  }

  // Keep older and future snapshot shapes intact; normalization adds no defaults.
  return {
    ...candidate,
    tasks: candidate.tasks,
    notes: candidate.notes,
    settings: candidate.settings,
  } as PlannerData;
}

function tombstoneKey(entry: PlannerTombstone): string {
  return `${entry.collection}\u0000${entry.id}`;
}

function mergeTombstones(...groups: Array<PlannerTombstone[] | undefined>): PlannerTombstone[] {
  const merged = new Map<string, PlannerTombstone>();
  for (const group of groups) {
    for (const entry of group ?? []) {
      const key = tombstoneKey(entry);
      if (!merged.has(key)) merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

export function addPlannerTombstone(
  dataValue: unknown,
  collection: CollectionKey,
  record: { id: string },
): PlannerData {
  const data = normalizePlannerData(dataValue);
  if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') {
    throw new Error('The deleted planner item is invalid.');
  }
  const entry: PlannerTombstone = {
    collection,
    id: (record as { id: string }).id,
    record: record as Record<string, unknown>,
  };
  return {
    ...data,
    deletedRecords: mergeTombstones(data.deletedRecords, [entry]),
  };
}

export function mergePlannerSnapshots(
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown,
  makeId: () => string,
): PlannerData {
  const base = normalizePlannerData(baseValue);
  const local = normalizePlannerData(localValue);
  const remote = normalizePlannerData(remoteValue);
  const knownKeys = new Set<string>(['tasks', 'notes', 'settings', 'deletedRecords', ...collectionKeys.slice(2)]);
  const mergedUnknown = mergeObject(
    Object.fromEntries(Object.entries(base).filter(([key]) => !knownKeys.has(key))),
    Object.fromEntries(Object.entries(local).filter(([key]) => !knownKeys.has(key))),
    Object.fromEntries(Object.entries(remote).filter(([key]) => !knownKeys.has(key))),
  );
  const result: Record<string, unknown> = {
    ...mergedUnknown,
    settings: mergeObject(base.settings, local.settings, remote.settings),
  };
  const deletedRecords = mergeTombstones(
    base.deletedRecords,
    local.deletedRecords,
    remote.deletedRecords,
  );
  if (deletedRecords.length || base.deletedRecords || local.deletedRecords || remote.deletedRecords) {
    result.deletedRecords = deletedRecords;
  }

  for (const key of collectionKeys) {
    const shouldWrite = key === 'tasks' || key === 'notes' ||
      base[key] !== undefined || local[key] !== undefined || remote[key] !== undefined;
    if (shouldWrite) {
      result[key] = mergeCollection(
        key,
        (base[key] ?? []) as Array<{ id: string; title?: string }>,
        (local[key] ?? []) as Array<{ id: string; title?: string }>,
        (remote[key] ?? []) as Array<{ id: string; title?: string }>,
        makeId,
      );
    }
  }

  return result as PlannerData;
}

/**
 * Two-snapshot merge used by a device cache that has no plaintext copy of the
 * previous remote revision. Preserve cloud data and add offline-only changes;
 * an ID collision becomes a labeled local copy instead of losing either edit.
 */
export function mergePlannerData(
  remoteValue: unknown,
  localValue: unknown,
  makeId: () => string,
): { data: PlannerData; conflicts: number } {
  const remote = normalizePlannerData(remoteValue);
  const local = normalizePlannerData(localValue);
  let conflicts = 0;
  const tombstones = mergeTombstones(local.deletedRecords, remote.deletedRecords);
  const consumedTombstones = new Set<string>();
  const result: Record<string, unknown> = {
    ...local,
    ...remote,
    settings: { ...local.settings, ...remote.settings },
  };
  if (tombstones.length || local.deletedRecords || remote.deletedRecords) {
    result.deletedRecords = tombstones;
  }

  for (const key of collectionKeys) {
    const hasCollection = key === 'tasks' || key === 'notes' ||
      remote[key] !== undefined || local[key] !== undefined;
    if (!hasCollection) continue;
    const remoteItems = (remote[key] ?? []) as Array<{ id: string; title?: string }>;
    const localItems = (local[key] ?? []) as Array<{ id: string; title?: string }>;
    const merged = [...remoteItems];
    const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
    const resultIds = new Set(remoteItems.map((item) => item.id));
    const suppressedIds = new Set<string>();
    const tombstoneCopies: Array<{ id: string; title?: string }> = [];
    const tombstonesForCollection = tombstones.filter((entry) => entry.collection === key);

    for (const tombstone of tombstonesForCollection) {
      const remoteItem = remoteById.get(tombstone.id);
      const localItem = localItems.find((item) => item.id === tombstone.id);
      const survivingItem = remoteItem ?? localItem;
      if (!survivingItem) continue;

      suppressedIds.add(tombstone.id);
      if (sameJson(survivingItem, tombstone.record)) continue;

      let id = makeId();
      const occupiedIds = new Set([...remoteItems, ...localItems].map((item) => item.id));
      while (occupiedIds.has(id) || resultIds.has(id)) id = makeId();
      const title = typeof survivingItem.title === 'string'
        ? `Conflict copy — ${survivingItem.title.replace(/^Conflict copy — /, '')}`
        : survivingItem.title;
      tombstoneCopies.push({ ...survivingItem, id, title });
      resultIds.add(id);
      consumedTombstones.add(tombstoneKey(tombstone));
      conflicts += 1;
    }

    for (const localItem of localItems) {
      if (suppressedIds.has(localItem.id)) continue;
      const remoteItem = remoteById.get(localItem.id);
      if (!remoteItem) {
        merged.push(localItem);
        resultIds.add(localItem.id);
        continue;
      }
      if (
        key === 'routines' &&
        sameRoutineDefinition(localItem as unknown as PlannerRoutine, remoteItem as unknown as PlannerRoutine)
      ) {
        merged[merged.indexOf(remoteItem)] = mergeRoutineRecords(
          localItem as unknown as PlannerRoutine,
          remoteItem as unknown as PlannerRoutine,
        ) as unknown as typeof remoteItem;
        continue;
      }
      if (
        key === 'tasks' &&
        sameTaskExceptCalendarEvent(localItem as unknown as PlannerTask, remoteItem as unknown as PlannerTask)
      ) {
        merged[merged.indexOf(remoteItem)] = mergeTaskOccurrences(
          localItem as unknown as PlannerTask,
          remoteItem as unknown as PlannerTask,
        ) as unknown as typeof remoteItem;
        continue;
      }
      if (sameJson(remoteItem, localItem)) continue;
      const remoteWithRuns = key === 'routines'
        ? mergeRoutineRecords(
            localItem as unknown as PlannerRoutine,
            remoteItem as unknown as PlannerRoutine,
          ) as unknown as typeof remoteItem
        : remoteItem;
      if (key === 'routines') merged[merged.indexOf(remoteItem)] = remoteWithRuns;

      let id = makeId();
      while (resultIds.has(id)) id = makeId();
      const title = typeof localItem.title === 'string'
        ? `Conflict copy — ${localItem.title.replace(/^Conflict copy — /, '')}`
        : localItem.title;
      const combined = key === 'routines'
        ? mergeRoutineRecords(
            localItem as unknown as PlannerRoutine,
            remoteItem as unknown as PlannerRoutine,
            'local',
          ) as unknown as typeof localItem
        : localItem;
      merged.push({ ...combined, id, title });
      resultIds.add(id);
      conflicts += 1;
    }
    const retainedRemote = merged.filter((item) => !suppressedIds.has(item.id));
    result[key] = [...retainedRemote, ...tombstoneCopies];
  }

  const retainedTombstones = tombstones.filter(
    (entry) => !consumedTombstones.has(tombstoneKey(entry)),
  );
  if (retainedTombstones.length || local.deletedRecords || remote.deletedRecords) {
    result.deletedRecords = retainedTombstones;
  } else {
    delete result.deletedRecords;
  }
  return { data: result as PlannerData, conflicts };
}

export function isTaskComplete(task: PlannerTask, tasks: PlannerTask[]): boolean {
  const children = tasks.filter((candidate) => candidate.parentTaskId === task.id);
  return children.length > 0
    ? children.every((child) => child.completed)
    : task.completed;
}

export function canSetTaskParent(
  tasks: PlannerTask[],
  parentTaskId: string | undefined,
  taskId?: string,
): boolean {
  if (!parentTaskId) return true;
  const parent = tasks.find((task) => task.id === parentTaskId);
  return Boolean(
    parent &&
    !parent.parentTaskId &&
    parent.id !== taskId &&
    (!taskId || !tasks.some((task) => task.parentTaskId === taskId)),
  );
}

export function getProjectProgress(projectId: string, tasks: PlannerTask[]) {
  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  const parentIds = new Set(
    projectTasks
      .filter((task) => !task.parentTaskId)
      .filter((parent) => projectTasks.some((task) => task.parentTaskId === parent.id))
      .map((parent) => parent.id),
  );
  const workItems = projectTasks.filter(
    (task) => Boolean(task.parentTaskId) || !parentIds.has(task.id),
  );
  const completed = workItems.filter((task) => isTaskComplete(task, projectTasks)).length;

  return {
    completed,
    total: workItems.length,
    percent: workItems.length ? Math.round((completed / workItems.length) * 100) : 0,
  };
}

export function convertInboxItemToTask(
  dataValue: unknown,
  inboxId: string,
  task: PlannerTask,
): PlannerData {
  const data = normalizePlannerData(dataValue);
  const item = (data.inbox ?? []).find((candidate) => candidate.id === inboxId);
  if (!item) throw new Error('This Inbox item is no longer available.');
  if (data.tasks.some((candidate) => candidate.id === task.id)) {
    throw new Error('This task already exists.');
  }
  return {
    ...addPlannerTombstone(data, 'inbox', item),
    inbox: data.inbox!.filter((candidate) => candidate.id !== inboxId),
    tasks: [task, ...data.tasks],
  };
}

export function convertInboxItemToNote(
  dataValue: unknown,
  inboxId: string,
  note: PlannerNote,
): PlannerData {
  const data = normalizePlannerData(dataValue);
  const item = (data.inbox ?? []).find((candidate) => candidate.id === inboxId);
  if (!item) throw new Error('This Inbox item is no longer available.');
  if (data.notes.some((candidate) => candidate.id === note.id)) {
    throw new Error('This note already exists.');
  }
  return {
    ...addPlannerTombstone(data, 'inbox', item),
    inbox: data.inbox!.filter((candidate) => candidate.id !== inboxId),
    notes: [note, ...data.notes],
  };
}
