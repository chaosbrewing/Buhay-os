import {
  getPlannerHabitHistory,
  getPlannerHabitWeek,
  summarizePlannerHabit,
} from '@workspace/planner-contract';
import {
  normalizeReleaseTwoData,
} from '@workspace/planner-contract/release2';
import {
  mergeReleaseTwoData,
} from '@workspace/planner-contract/release2-merge';
import type {
  ReleaseTwoPlannerData,
} from '@workspace/planner-contract/release2';
import type {
  PlannerNote,
  PlannerTask,
} from '@workspace/planner-contract';

export type {
  InboxItem,
  PlannerHabit,
  PlannerHabitCompletion,
  PlannerNote,
  PlannerProject,
  PlannerRoutine,
  PlannerRoutineRun,
  PlannerSettings,
  PlannerTask,
  RoutineStep,
  TaskPriority,
} from '@workspace/planner-contract';
export type {
  PlannerGoal,
  PlannerLifeArea,
  PlannerLifeReview,
  PlannerMilestone,
  PlannerRecordLink,
  PlannerRecordRef,
  ReleaseTwoPlannerData,
} from '@workspace/planner-contract/release2';
export type PlannerData = ReleaseTwoPlannerData;

export const EMPTY_PLANNER_DATA: PlannerData = {
  tasks: [],
  notes: [],
  settings: {
    theme: 'light',
    accentHex: '#3c7760',
  },
};

export function parsePlannerData(value: unknown): PlannerData {
  if (!value || typeof value !== 'object') {
    throw new Error('The decrypted planner data is invalid.');
  }
  return normalizeReleaseTwoData(value);
}

/**
 * Shared two-snapshot conflict policy for planner records, including the
 * optional Release 2 collections. Unknown fields pass through untouched.
 */
export function mergePlannerData(remote: unknown, local: unknown, makeId: () => string) {
  return mergeReleaseTwoData(remote, local, makeId);
}
export { getPlannerHabitHistory, getPlannerHabitWeek, summarizePlannerHabit };

export function plannerCacheKey(accountId: string): string {
  return `buhay.os.encrypted-cache.v1:${encodeURIComponent(accountId)}`;
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createLocalId(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 16) {
    throw new Error('An ID requires 16 random bytes.');
  }
  const bytes = [...randomBytes];
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
