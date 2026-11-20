import type { ReleaseTwoPlannerData } from './lib/planner-model';

type MemoryLike = { id: string; deletedAt?: string };

/**
 * Restoring a backup replaces the planner, so it must not bring back a memory the person has since deleted.
 * Any memory deleted in the current planner stays deleted (as a content-free marker) in the restored one.
 */
export function keepDeletedMemories(
  restored: ReleaseTwoPlannerData,
  current: ReleaseTwoPlannerData,
): ReleaseTwoPlannerData {
  const currentMemories = ((current as { memories?: MemoryLike[] }).memories ?? []);
  const deleted = new Map(currentMemories.filter((m) => m.deletedAt !== undefined).map((m) => [m.id, m.deletedAt!]));
  if (!deleted.size) return restored;
  const restoredMemories = ((restored as { memories?: MemoryLike[] }).memories ?? []);
  const kept = restoredMemories.map((m) => (deleted.has(m.id) ? { id: m.id, deletedAt: deleted.get(m.id)! } : m));
  const known = new Set(restoredMemories.map((m) => m.id));
  for (const [id, deletedAt] of deleted) if (!known.has(id)) kept.push({ id, deletedAt });
  return { ...restored, memories: kept } as ReleaseTwoPlannerData;
}
