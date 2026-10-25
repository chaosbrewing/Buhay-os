import {
  mergePlannerData as mergeBasePlannerData,
  mergePlannerSnapshots as mergeBasePlannerSnapshots,
} from '@workspace/planner-contract';
import {
  normalizeReleaseTwoData,
  type PlannerLifeArea,
  type PlannerLifeReview,
  type PlannerMilestone,
  type PlannerGoal,
  type PlannerRecordLink,
  type ReleaseTwoPlannerData,
} from '@workspace/planner-contract/release2';
import {
  hasBakasData,
  mergeMemoryCollections,
  normalizeBakasData,
  type BakasPlannerData,
} from '@workspace/planner-contract/bakas';
import { hasUgnayData, mergeUgnayCollections } from '@workspace/planner-contract/ugnay';

type ReleaseTwoCollectionKey = 'goals' | 'milestones' | 'lifeAreas' | 'links' | 'reviews';
type ReleaseTwoRecord = PlannerGoal | PlannerMilestone | PlannerLifeArea | PlannerRecordLink | PlannerLifeReview;
const collectionKeys: ReleaseTwoCollectionKey[] = ['goals', 'milestones', 'lifeAreas', 'links', 'reviews'];

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function titleOf(record: ReleaseTwoRecord): string | undefined {
  return 'title' in record ? record.title : undefined;
}

function conflictCopy<T extends ReleaseTwoRecord>(record: T, id: string): T {
  const title = titleOf(record);
  if (typeof title === 'string') {
    return { ...record, id, title: `Conflict copy — ${title.replace(/^Conflict copy — /, '')}` } as T;
  }
  if ('reflection' in record) {
    return { ...record, id, conflictCopyOf: record.id } as T;
  }
  return { ...record, id } as T;
}

function mergeLinkState(local: PlannerRecordLink, remote: PlannerRecordLink): PlannerRecordLink {
  const localTime = Date.parse(local.updatedAt || local.createdAt);
  const remoteTime = Date.parse(remote.updatedAt || remote.createdAt);
  if (localTime > remoteTime) return local;
  if (remoteTime > localTime) return remote;
  if (local.removedAt && !remote.removedAt) return local;
  if (remote.removedAt && !local.removedAt) return remote;
  return remote;
}

function makeConflictId(makeId: () => string, occupied: Set<string>) {
  let id = makeId();
  while (occupied.has(id)) id = makeId();
  occupied.add(id);
  return id;
}

function mergeTwoCollection<T extends ReleaseTwoRecord>(
  key: ReleaseTwoCollectionKey,
  remoteItems: T[],
  localItems: T[],
  makeId: () => string,
): T[] {
  const merged = [...remoteItems];
  const byId = new Map(remoteItems.map((record) => [record.id, record]));
  const occupied = new Set([...remoteItems, ...localItems].map((record) => record.id));
  for (const local of localItems) {
    const remote = byId.get(local.id);
    if (!remote) {
      merged.push(local);
      byId.set(local.id, local);
      continue;
    }
    if (sameJson(local, remote)) continue;
    if (key === 'links') {
      const winner = mergeLinkState(local as PlannerRecordLink, remote as PlannerRecordLink) as T;
      merged[merged.indexOf(remote)] = winner;
      byId.set(local.id, winner);
      continue;
    }
    const copy = conflictCopy(local, makeConflictId(makeId, occupied));
    merged.push(copy);
  }
  return merged;
}

function mergeThreeWayCollection<T extends ReleaseTwoRecord>(
  key: ReleaseTwoCollectionKey,
  baseItems: T[],
  localItems: T[],
  remoteItems: T[],
  makeId: () => string,
): T[] {
  const base = new Map(baseItems.map((record) => [record.id, record]));
  const local = new Map(localItems.map((record) => [record.id, record]));
  const remote = new Map(remoteItems.map((record) => [record.id, record]));
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const occupied = new Set(ids);
  const output: T[] = [];
  for (const id of ids) {
    const before = base.get(id);
    const localItem = local.get(id);
    const remoteItem = remote.get(id);
    if (sameJson(localItem, remoteItem)) {
      const item = remoteItem ?? localItem;
      if (item) output.push(item);
      continue;
    }
    const localChanged = !sameJson(localItem, before);
    const remoteChanged = !sameJson(remoteItem, before);
    if (!localChanged) {
      if (remoteItem) output.push(remoteItem);
      continue;
    }
    if (!remoteChanged) {
      if (localItem) output.push(localItem);
      continue;
    }
    if (!localItem || !remoteItem) {
      const survivor = localItem ?? remoteItem;
      if (survivor) output.push(survivor);
      continue;
    }
    if (key === 'links') {
      output.push(mergeLinkState(localItem as PlannerRecordLink, remoteItem as PlannerRecordLink) as T);
      continue;
    }
    output.push(remoteItem);
    output.push(conflictCopy(localItem, makeConflictId(makeId, occupied)));
  }
  return output;
}

function maxSchemaVersion(...data: ReleaseTwoPlannerData[]) {
  const versions = data.map((item) => item.schemaVersion ?? 1);
  return Math.max(...versions);
}

function mergeOptionalCollections(
  target: ReleaseTwoPlannerData,
  groups: ReleaseTwoPlannerData[][],
  makeId: () => string,
  threeWay: boolean,
): ReleaseTwoPlannerData {
  const result: Record<string, unknown> = { ...target };
  for (const key of collectionKeys) {
    const shouldWrite = groups.some((group) => group.some((item) => item[key] !== undefined));
    if (!shouldWrite) {
      delete result[key];
      continue;
    }
    const items = groups.map((group) => (group[group.length - 1]?.[key] ?? []) as ReleaseTwoRecord[]);
    result[key] = threeWay
      ? mergeThreeWayCollection(key, items[0], items[1], items[2], makeId)
      : mergeTwoCollection(key, items[0], items[1], makeId);
  }
  const version = maxSchemaVersion(...groups.flat());
  if (version > 1 || 'schemaVersion' in result) result.schemaVersion = version;
  // UGNAY's grants, drafts and audit log, and BAKAS's memories, would otherwise
  // be taken whole from one copy. Only runs when some copy has them, so older
  // snapshots merge exactly as before.
  const copies = groups.flat() as BakasPlannerData[];
  if (copies.some((copy) => hasUgnayData(copy as Record<string, unknown>) || hasBakasData(copy as Record<string, unknown>))) {
    return normalizeBakasData({ ...result, ...mergeUgnayCollections(copies), ...mergeMemoryCollections(copies) });
  }
  return normalizeReleaseTwoData(result);
}

/**
 * Three-way merge with record-level handling for Release 2's optional lists.
 * Existing planner collection policy remains owned by the original contract.
 */
export function mergeReleaseTwoSnapshots(
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown,
  makeId: () => string,
): ReleaseTwoPlannerData {
  const base = normalizeReleaseTwoData(baseValue);
  const local = normalizeReleaseTwoData(localValue);
  const remote = normalizeReleaseTwoData(remoteValue);
  const merged = mergeBasePlannerSnapshots(base, local, remote, makeId) as ReleaseTwoPlannerData;
  return mergeOptionalCollections(merged, [[base], [local], [remote]], makeId, true);
}

/**
 * Offline two-snapshot merge. A concurrent same-ID edit is retained as a
 * conflict copy; a link's latest explicit active/unlinked state is monotonic.
 */
export function mergeReleaseTwoData(
  remoteValue: unknown,
  localValue: unknown,
  makeId: () => string,
): { data: ReleaseTwoPlannerData; conflicts: number } {
  const remote = normalizeReleaseTwoData(remoteValue);
  const local = normalizeReleaseTwoData(localValue);
  const merged = mergeBasePlannerData(remote, local, makeId);
  const data = mergeOptionalCollections(merged.data as ReleaseTwoPlannerData, [[remote], [local]], makeId, false);
  const conflicts = collectionKeys.reduce((count, key) => {
    if (key === 'links') return count;
    const remoteById = new Map(((remote[key] ?? []) as ReleaseTwoRecord[]).map((item) => [item.id, item]));
    return count + ((local[key] ?? []) as ReleaseTwoRecord[]).filter((item) => {
      const remoteItem = remoteById.get(item.id);
      return Boolean(remoteItem && !sameJson(remoteItem, item));
    }).length;
  }, merged.conflicts);
  return { data, conflicts };
}

