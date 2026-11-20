import { normalizePlannerData } from './lib/planner-model';
import type { ReleaseTwoPlannerData } from './lib/planner-model';

export function serializePlannerBackup(data: ReleaseTwoPlannerData): string {
  return JSON.stringify(data, null, 2);
}

export function parsePlannerBackup(serialized: string): ReleaseTwoPlannerData {
  return normalizePlannerData(JSON.parse(serialized));
}

export function normalizePlannerVersionSnapshot(snapshot: unknown): ReleaseTwoPlannerData {
  return normalizePlannerData(snapshot);
}
