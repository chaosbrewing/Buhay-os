import {
  getProjectProgress,
  isTaskComplete,
  normalizePlannerData,
} from '@workspace/planner-contract';
import type { PlannerData, PlannerTask } from '@workspace/planner-contract';

export const RELEASE_TWO_SCHEMA_VERSION = 2;

export const RELEASE_TWO_FEATURE_FLAGS = {
  goalsAndMilestones: true,
  lifeAreas: true,
  smartLinking: true,
  universalTimeline: true,
  lifeReviews: true,
  unifiedSearch: true,
} as const;

export type ReleaseTwoFeature = keyof typeof RELEASE_TWO_FEATURE_FLAGS;
export type ReleaseTwoRecordType =
  | 'task'
  | 'note'
  | 'project'
  | 'inbox'
  | 'habit'
  | 'routine'
  | 'goal'
  | 'milestone'
  | 'lifeArea'
  | 'review';

export type PlannerRecordRef = {
  type: ReleaseTwoRecordType;
  id: string;
};

export type PlannerGoal = {
  id: string;
  title: string;
  description?: string;
  targetDate?: string;
  status: 'active' | 'archived';
};

export type PlannerMilestone = {
  id: string;
  goalId: string;
  title: string;
  targetDate?: string;
  status: 'active' | 'archived';
};

export type PlannerLifeArea = {
  id: string;
  title: string;
  description?: string;
  colorHex?: string;
  status: 'active' | 'archived';
};

export type PlannerRecordLink = {
  id: string;
  source: PlannerRecordRef;
  target: PlannerRecordRef;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
};

export type PlannerLifeReview = {
  id: string;
  period: 'week' | 'month';
  startDate: string;
  endDate: string;
  reflection: string;
  createdAt: string;
  updatedAt: string;
  conflictCopyOf?: string;
};

export type ReleaseTwoPlannerData = PlannerData & {
  schemaVersion?: number;
  goals?: PlannerGoal[];
  milestones?: PlannerMilestone[];
  lifeAreas?: PlannerLifeArea[];
  links?: PlannerRecordLink[];
  reviews?: PlannerLifeReview[];
};

export type PlannerProgress = {
  completed: number;
  total: number;
  percent: number;
};

export type PlannerSearchFilter = ReleaseTwoRecordType | 'all';
export type PlannerSearchResult = {
  ref: PlannerRecordRef;
  title: string;
  detail: string;
  score: number;
};

export type PlannerTimelineEntry = {
  id: string;
  type: 'task' | 'note' | 'habit' | 'milestone';
  title: string;
  date: string;
  time?: string;
  ref: PlannerRecordRef;
  completed?: boolean;
};

const recordTypes = new Set<ReleaseTwoRecordType>([
  'task', 'note', 'project', 'inbox', 'habit', 'routine',
  'goal', 'milestone', 'lifeArea', 'review',
]);

export function isPlannerDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /T/.test(value) && Number.isFinite(Date.parse(value));
}

function validRef(value: unknown): value is PlannerRecordRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Partial<PlannerRecordRef>;
  return typeof ref.type === 'string' && recordTypes.has(ref.type as ReleaseTwoRecordType) &&
    typeof ref.id === 'string' && ref.id.length > 0;
}

function validNamedRecord(value: unknown): value is { id: string; title: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as { id?: unknown; title?: unknown };
  return typeof record.id === 'string' && record.id.length > 0 &&
    typeof record.title === 'string' && record.title.trim().length > 0;
}

function validOptionalDate(value: unknown): boolean {
  return value === undefined || isPlannerDateKey(value);
}

function validateOptionalCollection<T>(
  candidate: Record<string, unknown>,
  key: string,
  validate: (entry: unknown) => entry is T,
): void {
  const value = candidate[key];
  if (value !== undefined && (!Array.isArray(value) || value.some((entry) => !validate(entry)))) {
    throw new Error(`The encrypted planner's ${key} collection is invalid.`);
  }
}

export function normalizeReleaseTwoData(value: unknown): ReleaseTwoPlannerData {
  const data = normalizePlannerData(value) as ReleaseTwoPlannerData;
  const candidate = data as Record<string, unknown>;
  const version = candidate.schemaVersion;
  if (version !== undefined && (!Number.isInteger(version) || (version as number) < 1)) {
    throw new Error('The encrypted planner schema version is invalid.');
  }
  validateOptionalCollection(candidate, 'goals', (entry): entry is PlannerGoal =>
    validNamedRecord(entry) &&
    ['active', 'archived'].includes((entry as PlannerGoal).status) &&
    validOptionalDate((entry as PlannerGoal).targetDate) &&
    ((entry as PlannerGoal).description === undefined || typeof (entry as PlannerGoal).description === 'string'));
  validateOptionalCollection(candidate, 'milestones', (entry): entry is PlannerMilestone =>
    validNamedRecord(entry) &&
    typeof (entry as PlannerMilestone).goalId === 'string' &&
    (entry as PlannerMilestone).goalId.length > 0 &&
    ['active', 'archived'].includes((entry as PlannerMilestone).status) &&
    validOptionalDate((entry as PlannerMilestone).targetDate));
  validateOptionalCollection(candidate, 'lifeAreas', (entry): entry is PlannerLifeArea =>
    validNamedRecord(entry) &&
    ['active', 'archived'].includes((entry as PlannerLifeArea).status) &&
    ((entry as PlannerLifeArea).description === undefined || typeof (entry as PlannerLifeArea).description === 'string') &&
    ((entry as PlannerLifeArea).colorHex === undefined || /^#[\da-fA-F]{6}$/.test((entry as PlannerLifeArea).colorHex!)));
  validateOptionalCollection(candidate, 'links', (entry): entry is PlannerRecordLink => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const link = entry as PlannerRecordLink;
    return typeof link.id === 'string' && link.id.length > 0 &&
      validRef(link.source) && validRef(link.target) &&
      (link.source.type !== link.target.type || link.source.id !== link.target.id) &&
      validTimestamp(link.createdAt) && validTimestamp(link.updatedAt) &&
      (link.removedAt === undefined || validTimestamp(link.removedAt));
  });
  validateOptionalCollection(candidate, 'reviews', (entry): entry is PlannerLifeReview => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const review = entry as PlannerLifeReview;
    return typeof review.id === 'string' && review.id.length > 0 &&
      ['week', 'month'].includes(review.period) &&
      isPlannerDateKey(review.startDate) && isPlannerDateKey(review.endDate) &&
      review.startDate <= review.endDate &&
      typeof review.reflection === 'string' &&
      validTimestamp(review.createdAt) && validTimestamp(review.updatedAt) &&
      (review.conflictCopyOf === undefined || typeof review.conflictCopyOf === 'string');
  });
  return data;
}

export function markReleaseTwoDataUsed<T extends ReleaseTwoPlannerData>(data: T): T {
  return {
    ...data,
    schemaVersion: Math.max(data.schemaVersion ?? 1, RELEASE_TWO_SCHEMA_VERSION),
  };
}

export function recordExists(dataValue: unknown, ref: PlannerRecordRef): boolean {
  const data = normalizeReleaseTwoData(dataValue);
  const records: Partial<Record<ReleaseTwoRecordType, Array<{ id: string }>>> = {
    task: data.tasks,
    note: data.notes,
    project: data.projects,
    inbox: data.inbox,
    habit: data.habits,
    routine: data.routines,
    goal: data.goals,
    milestone: data.milestones,
    lifeArea: data.lifeAreas,
    review: data.reviews,
  };
  return records[ref.type]?.some((record) => record.id === ref.id) ?? false;
}

function compareRef(left: PlannerRecordRef, right: PlannerRecordRef): number {
  return `${left.type}\u0000${left.id}`.localeCompare(`${right.type}\u0000${right.id}`);
}

function normalizedPair(source: PlannerRecordRef, target: PlannerRecordRef) {
  return compareRef(source, target) <= 0
    ? { source, target }
    : { source: target, target: source };
}

export function plannerLinkId(source: PlannerRecordRef, target: PlannerRecordRef): string {
  const pair = normalizedPair(source, target);
  return `link:${encodeURIComponent(JSON.stringify([pair.source, pair.target]))}`;
}

export function linkPlannerRecords(
  value: unknown,
  source: PlannerRecordRef,
  target: PlannerRecordRef,
  createdAt: string,
): ReleaseTwoPlannerData {
  const data = normalizeReleaseTwoData(value);
  if (!recordExists(data, source) || !recordExists(data, target)) {
    throw new Error('Both linked planner records must still exist.');
  }
  if (!validTimestamp(createdAt)) throw new Error('The link timestamp is invalid.');
  if (source.type === target.type && source.id === target.id) {
    throw new Error('A planner record cannot link to itself.');
  }
  const pair = normalizedPair(source, target);
  const id = plannerLinkId(pair.source, pair.target);
  const previous = (data.links ?? []).find((link) => link.id === id);
  const nextLink: PlannerRecordLink = {
    ...previous,
    id,
    ...pair,
    createdAt: previous?.createdAt ?? createdAt,
    updatedAt: createdAt,
  };
  delete nextLink.removedAt;
  const links = [...(data.links ?? []).filter((link) => link.id !== id), nextLink];
  return markReleaseTwoDataUsed({ ...data, links });
}

export function unlinkPlannerRecord(
  value: unknown,
  linkId: string,
  removedAt: string,
): ReleaseTwoPlannerData {
  const data = normalizeReleaseTwoData(value);
  if (!validTimestamp(removedAt)) throw new Error('The unlink timestamp is invalid.');
  const found = (data.links ?? []).some((link) => link.id === linkId);
  if (!found) throw new Error('This planner link is no longer available.');
  const links = data.links!.map((link) =>
    link.id === linkId ? { ...link, removedAt, updatedAt: removedAt } : link,
  );
  return markReleaseTwoDataUsed({ ...data, links });
}

export function plannerLinksFor(
  value: unknown,
  ref: PlannerRecordRef,
): PlannerRecordLink[] {
  const data = normalizeReleaseTwoData(value);
  return (data.links ?? []).filter((link) =>
    !link.removedAt &&
    ((link.source.type === ref.type && link.source.id === ref.id) ||
      (link.target.type === ref.type && link.target.id === ref.id)),
  );
}

export function findBrokenPlannerLinks(value: unknown): PlannerRecordLink[] {
  const data = normalizeReleaseTwoData(value);
  return (data.links ?? []).filter((link) =>
    !link.removedAt && (!recordExists(data, link.source) || !recordExists(data, link.target)),
  );
}

export function repairPlannerLink(
  value: unknown,
  linkId: string,
  source: PlannerRecordRef,
  target: PlannerRecordRef,
  updatedAt: string,
): ReleaseTwoPlannerData {
  const data = normalizeReleaseTwoData(value);
  const existing = (data.links ?? []).find((link) => link.id === linkId && !link.removedAt);
  if (!existing) throw new Error('This planner link is no longer available.');
  if (!recordExists(data, source) || !recordExists(data, target)) {
    throw new Error('Choose two records that still exist in this planner.');
  }
  if (!validTimestamp(updatedAt)) throw new Error('The link timestamp is invalid.');
  const withoutOld = {
    ...data,
    links: (data.links ?? []).map((link) => link.id === linkId ? { ...link, removedAt: updatedAt, updatedAt } : link),
  };
  return linkPlannerRecords(withoutOld, source, target, updatedAt);
}

function activeLinksFor(data: ReleaseTwoPlannerData, ref: PlannerRecordRef): PlannerRecordLink[] {
  return (data.links ?? []).filter((link) =>
    !link.removedAt &&
    ((link.source.type === ref.type && link.source.id === ref.id) ||
      (link.target.type === ref.type && link.target.id === ref.id)),
  );
}

function taskWorkItems(tasks: PlannerTask[], selectedIds: Set<string>): PlannerTask[] {
  const selected = tasks.filter((task) => selectedIds.has(task.id));
  const result = new Map<string, PlannerTask>();
  for (const task of selected) {
    const children = tasks.filter((candidate) => candidate.parentTaskId === task.id);
    if (children.length) {
      for (const child of children) result.set(child.id, child);
    } else {
      result.set(task.id, task);
    }
  }
  return [...result.values()];
}

function progressForRefs(data: ReleaseTwoPlannerData, refs: PlannerRecordRef[]): PlannerProgress {
  const projectIds = new Set(refs.filter((ref) => ref.type === 'project').map((ref) => ref.id));
  const selectedTaskIds = new Set(
    refs.filter((ref) => ref.type === 'task').map((ref) => ref.id),
  );
  for (const task of data.tasks) {
    if (task.projectId && projectIds.has(task.projectId)) selectedTaskIds.add(task.id);
  }
  const selectedTasks = taskWorkItems(data.tasks, selectedTaskIds)
    .filter((task) => !task.projectId || !projectIds.has(task.projectId));
  let completed = selectedTasks.filter((task) => isTaskComplete(task, data.tasks)).length;
  let total = selectedTasks.length;
  for (const projectId of projectIds) {
    const progress = getProjectProgress(projectId, data.tasks);
    completed += progress.completed;
    total += progress.total;
  }
  return { completed, total, percent: total ? Math.round(completed / total * 100) : 0 };
}

function linksTo(data: ReleaseTwoPlannerData, ref: PlannerRecordRef): PlannerRecordRef[] {
  return activeLinksFor(data, ref).map((link) =>
    link.source.type === ref.type && link.source.id === ref.id ? link.target : link.source,
  );
}

export function getMilestoneProgress(
  value: unknown,
  milestoneId: string,
): PlannerProgress {
  const data = normalizeReleaseTwoData(value);
  return progressForRefs(data, linksTo(data, { type: 'milestone', id: milestoneId }));
}

export function getGoalProgress(value: unknown, goalId: string): PlannerProgress {
  const data = normalizeReleaseTwoData(value);
  const goalRef: PlannerRecordRef = { type: 'goal', id: goalId };
  const refs = linksTo(data, goalRef);
  for (const milestone of data.milestones ?? []) {
    if (milestone.goalId === goalId && milestone.status === 'active') {
      refs.push(...linksTo(data, { type: 'milestone', id: milestone.id }));
    }
  }
  return progressForRefs(data, refs);
}

export function buildPlannerTimeline(
  value: unknown,
  startDate: string,
  endDate: string,
): PlannerTimelineEntry[] {
  if (!isPlannerDateKey(startDate) || !isPlannerDateKey(endDate) || startDate > endDate) {
    throw new Error('The timeline date range is invalid.');
  }
  const data = normalizeReleaseTwoData(value);
  const entries: PlannerTimelineEntry[] = [];
  const inRange = (date: string) => date >= startDate && date <= endDate;
  for (const task of data.tasks) {
    if (isPlannerDateKey(task.dueDate) && inRange(task.dueDate)) {
      entries.push({
        id: `task:${task.id}`,
        type: 'task',
        title: task.title,
        date: task.dueDate,
        ...(task.dueTime && /^\d{2}:\d{2}$/.test(task.dueTime) ? { time: task.dueTime } : {}),
        ref: { type: 'task', id: task.id },
        completed: isTaskComplete(task, data.tasks),
      });
    }
  }
  for (const note of data.notes) {
    if (isPlannerDateKey(note.date) && inRange(note.date)) {
      entries.push({ id: `note:${note.id}`, type: 'note', title: note.title, date: note.date, ref: { type: 'note', id: note.id } });
    }
  }
  for (const habit of data.habits ?? []) {
    for (const date of new Set(habit.completedDates)) {
      if (isPlannerDateKey(date) && inRange(date)) {
        entries.push({ id: `habit:${habit.id}:${date}`, type: 'habit', title: habit.title, date, ref: { type: 'habit', id: habit.id }, completed: true });
      }
    }
  }
  for (const milestone of data.milestones ?? []) {
    if (milestone.status === 'active' && isPlannerDateKey(milestone.targetDate) && inRange(milestone.targetDate)) {
      entries.push({ id: `milestone:${milestone.id}`, type: 'milestone', title: milestone.title, date: milestone.targetDate, ref: { type: 'milestone', id: milestone.id } });
    }
  }
  return entries.sort((left, right) =>
    left.date.localeCompare(right.date) ||
    (left.time ?? '').localeCompare(right.time ?? '') ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id),
  );
}

export function summarizeLifePeriod(
  value: unknown,
  startDate: string,
  endDate: string,
) {
  const entries = buildPlannerTimeline(value, startDate, endDate);
  const taskEntries = entries.filter((entry) => entry.type === 'task');
  const habitEntries = entries.filter((entry) => entry.type === 'habit');
  const milestoneEntries = entries.filter((entry) => entry.type === 'milestone');
  const noteEntries = entries.filter((entry) => entry.type === 'note');
  return {
    tasks: {
      completed: taskEntries.filter((entry) => entry.completed).length,
      unfinished: taskEntries.filter((entry) => !entry.completed).length,
      total: taskEntries.length,
    },
    habitCompletions: habitEntries.length,
    milestones: milestoneEntries.length,
    notes: noteEntries.length,
  };
}

function searchableRecords(data: ReleaseTwoPlannerData) {
  return [
    ...data.tasks.map((record) => ({ type: 'task' as const, id: record.id, title: record.title, body: `${record.description ?? ''} ${record.tag} ${record.dueDate}` })),
    ...data.notes.map((record) => ({ type: 'note' as const, id: record.id, title: record.title, body: `${record.content} ${record.tags.join(' ')} ${record.date}` })),
    ...(data.projects ?? []).map((record) => ({ type: 'project' as const, id: record.id, title: record.title, body: `${record.description} ${record.targetDate ?? ''}` })),
    ...(data.inbox ?? []).map((record) => ({ type: 'inbox' as const, id: record.id, title: record.title, body: `${record.content} ${record.capturedAt}` })),
    ...(data.habits ?? []).map((record) => ({ type: 'habit' as const, id: record.id, title: record.title, body: record.description ?? '' })),
    ...(data.routines ?? []).map((record) => ({ type: 'routine' as const, id: record.id, title: record.title, body: record.steps.map((step) => step.title).join(' ') })),
    ...(data.goals ?? []).map((record) => ({ type: 'goal' as const, id: record.id, title: record.title, body: `${record.description ?? ''} ${record.targetDate ?? ''}` })),
    ...(data.milestones ?? []).map((record) => ({ type: 'milestone' as const, id: record.id, title: record.title, body: `${record.targetDate ?? ''} ${(data.goals ?? []).find((goal) => goal.id === record.goalId)?.title ?? ''}` })),
    ...(data.lifeAreas ?? []).map((record) => ({ type: 'lifeArea' as const, id: record.id, title: record.title, body: record.description ?? '' })),
    ...(data.reviews ?? []).map((record) => ({ type: 'review' as const, id: record.id, title: `${record.conflictCopyOf ? 'Conflict copy · ' : ''}${record.period === 'week' ? 'Weekly' : 'Monthly'} review · ${record.startDate}`, body: record.reflection })),
  ];
}

export function searchPlannerRecords(
  value: unknown,
  query: string,
  filter: PlannerSearchFilter = 'all',
  limit = 50,
): PlannerSearchResult[] {
  const data = normalizeReleaseTwoData(value);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length || !Number.isInteger(limit) || limit < 1) return [];
  return searchableRecords(data)
    .filter((record) => filter === 'all' || record.type === filter)
    .map((record) => {
      const title = record.title.toLocaleLowerCase();
      const body = record.body.toLocaleLowerCase();
      const full = `${title} ${body}`;
      if (!terms.every((term) => full.includes(term))) return null;
      const joined = terms.join(' ');
      const score = title === joined ? 100 : title.startsWith(joined) ? 80 :
        title.includes(joined) ? 60 : terms.reduce((sum, term) => sum + (title.includes(term) ? 8 : 0), 0) +
          terms.reduce((sum, term) => sum + (body.includes(term) ? 2 : 0), 0);
      return {
        ref: { type: record.type, id: record.id },
        title: record.title,
        detail: record.body.trim(),
        score,
      };
    })
    .filter((result): result is PlannerSearchResult => Boolean(result))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

export function saveLifeReview(
  value: unknown,
  review: PlannerLifeReview,
): ReleaseTwoPlannerData {
  const data = normalizeReleaseTwoData(value);
  const next = normalizeReleaseTwoData({ ...data, reviews: [...(data.reviews ?? []).filter((item) => item.id !== review.id), review] });
  return markReleaseTwoDataUsed(next);
}
