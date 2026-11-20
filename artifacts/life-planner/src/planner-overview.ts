import {
  expandPlannerTaskOccurrences,
  isTaskComplete,
  summarizePlannerHabit,
  type PlannerHabit,
  type PlannerTask,
} from '@workspace/planner-contract';
import { getGoalProgress, type PlannerGoal, type ReleaseTwoPlannerData } from '@workspace/planner-contract/release2';

export type OverviewTask = PlannerTask & { occurrenceDate?: string; seriesTaskId?: string };

export type DayTally = { date: string; completed: number; total: number };
export type Tally = { completed: number; total: number };

export type PlannerOverview = {
  weekStart: string;
  weekEnd: string;
  /** Work tasks (a parent with subtasks is counted through its subtasks) due in the week, in date and time order. */
  tasks: OverviewTask[];
  days: DayTally[];
  tasksTally: Tally;
  habitsTally: Tally;
  /** Linked work across active goals, or null when there are no active goals. */
  goalsTally: (Tally & { goals: number }) | null;
  /** Share of this week's tasks and habit days that are done, or null when nothing is planned. */
  weekPercent: number | null;
};

const shift = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

/** The Monday on or before a date. */
export const mondayOf = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shift(date, -((weekday + 6) % 7));
};

export const shiftWeek = (weekStart: string, weeks: number): string => shift(weekStart, weeks * 7);

const percent = (completed: number, total: number) => (total ? Math.round((completed / total) * 100) : 0);
export const percentOf = (tally: Tally): number => percent(tally.completed, tally.total);

/** What the Planner screen shows for one Monday-to-Sunday week. Reads only; nothing is changed. */
export function buildPlannerOverview(data: ReleaseTwoPlannerData, weekStart: string, today: string): PlannerOverview {
  const weekEnd = shift(weekStart, 6);
  const all = expandPlannerTaskOccurrences(data.tasks, weekStart, weekEnd) as OverviewTask[];
  const tasks = all
    .filter((task) => task.parentTaskId || !data.tasks.some((child) => child.parentTaskId === task.id))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || a.title.localeCompare(b.title));
  const done = (task: OverviewTask) => isTaskComplete(task, data.tasks);

  const days: DayTally[] = Array.from({ length: 7 }, (_, index) => {
    const date = shift(weekStart, index);
    const forDay = tasks.filter((task) => task.dueDate === date);
    return { date, completed: forDay.filter(done).length, total: forDay.length };
  });
  const tasksTally = { completed: tasks.filter(done).length, total: tasks.length };

  // Habits are measured against this week's planned days, using the same rules as the Habits page.
  const reference = today >= weekStart && today <= weekEnd ? today : weekEnd;
  let habitsTally: Tally = { completed: 0, total: 0 };
  for (const habit of (data.habits ?? []) as PlannerHabit[]) {
    const summary = summarizePlannerHabit(habit, reference);
    habitsTally = { completed: habitsTally.completed + summary.completedThisWeek, total: habitsTally.total + summary.plannedThisWeek };
  }

  const activeGoals = ((data.goals ?? []) as PlannerGoal[]).filter((goal) => goal.status === 'active');
  let goalsTally: PlannerOverview['goalsTally'] = null;
  if (activeGoals.length) {
    const sums = activeGoals.reduce((sum, goal) => {
      const progress = getGoalProgress(data, goal.id);
      return { completed: sum.completed + progress.completed, total: sum.total + progress.total };
    }, { completed: 0, total: 0 });
    goalsTally = { ...sums, goals: activeGoals.length };
  }

  const planned = tasksTally.total + habitsTally.total;
  const weekPercent = planned ? percent(tasksTally.completed + habitsTally.completed, planned) : null;
  return { weekStart, weekEnd, tasks, days, tasksTally, habitsTally, goalsTally, weekPercent };
}
