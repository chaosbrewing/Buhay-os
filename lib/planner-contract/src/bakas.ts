import type { PlannerRecordRef } from '@workspace/planner-contract/release2';
import {
  checkCapabilityAccess,
  normalizeUgnayData,
  recordAuditEvent,
  type PlannerProvenance,
  type UgnayCapability,
  type UgnayPlannerData,
  type UgnayScope,
} from '@workspace/planner-contract/ugnay';

/**
 * BAKAS: what HANAY remembers about the user, and only what the user has
 * agreed it may remember. Memories live inside the encrypted planner snapshot
 * as an optional `memories` list, absent until first used. This module only
 * describes, checks and changes that data. It reads and sends nothing.
 *
 * Rules it enforces:
 *  - A fact is never mistaken for a guess: an AI interpretation must be
 *    labelled as one until the user confirms it.
 *  - Every memory keeps where it came from and when.
 *  - Corrections keep the earlier wording; deleting erases the content.
 *  - Another capability (memory, advice) reads memories only with an active
 *    UGNAY grant, never reads private ones, and never reads a memory whose
 *    source the user disconnected until the user chooses to keep it.
 */

export const MAX_MEMORY_LENGTH = 1000;
export const MAX_MEMORIES = 2000;
export const MAX_MEMORY_REVISIONS = 20;

export type MemoryKind = 'fact' | 'preference' | 'interpretation';
export type MemoryVerification = 'user-confirmed' | 'source-verified' | 'ai-interpretation';
export type MemorySensitivity = 'normal' | 'private';

export type MemorySource =
  | { type: 'manual' }
  | { type: 'planner'; ref: PlannerRecordRef; capturedAt: string }
  | { type: 'connected'; app: string; ref?: string; capturedAt: string };

/** An earlier version of a memory, kept when it is corrected. */
export type MemoryRevision = {
  text: string;
  kind: MemoryKind;
  verification: MemoryVerification;
  sensitivity: MemorySensitivity;
  /** When this version was saved. */
  changedAt: string;
};

export type PlannerMemory = {
  id: string;
  text: string;
  kind: MemoryKind;
  verification: MemoryVerification;
  source: MemorySource;
  /** `private` memories are visible to the user only and are never given to another capability. */
  sensitivity: MemorySensitivity;
  createdAt: string;
  updatedAt: string;
  revisions?: MemoryRevision[];
  /** Set when the connected app this memory came from was disconnected. */
  sourceRevokedAt?: string;
  /** Set when the user chose to keep the memory after its source was disconnected. */
  keptAt?: string;
  /** Set when the memory was created by approving a proposal. */
  provenance?: PlannerProvenance;
};

/** What remains of a deleted memory: enough to stop an older copy bringing it back, and nothing else. */
export type MemoryTombstone = { id: string; deletedAt: string };

export type MemoryEntry = PlannerMemory | MemoryTombstone;

export type BakasPlannerData = UgnayPlannerData & { memories?: MemoryEntry[] };

/** What another capability receives: enough to attribute and weigh a memory, nothing more. */
export type MemoryContext = Pick<PlannerMemory, 'id' | 'text' | 'kind' | 'verification' | 'source' | 'updatedAt'>;

// ---------------------------------------------------------------- validation

const KINDS: readonly string[] = ['fact', 'preference', 'interpretation'];
const VERIFICATIONS: readonly string[] = ['user-confirmed', 'source-verified', 'ai-interpretation'];
const SENSITIVITIES: readonly string[] = ['normal', 'private'];
const RECORD_TYPES = new Set<string>([
  'task', 'note', 'project', 'inbox', 'habit', 'routine', 'goal', 'milestone', 'lifeArea', 'review',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /T/.test(value) && Number.isFinite(Date.parse(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isMemoryTombstone(entry: MemoryEntry): entry is MemoryTombstone {
  return 'deletedAt' in entry;
}

function sourceProblem(source: unknown): string | null {
  if (!isObject(source)) return 'A memory needs a source.';
  if (source.type === 'manual') return null;
  if (source.type === 'planner') {
    const ref = source.ref;
    return isObject(ref) && RECORD_TYPES.has(ref.type as string) && nonEmptyString(ref.id) && validTimestamp(source.capturedAt)
      ? null : 'A planner source needs a record and the time it was captured.';
  }
  if (source.type === 'connected') {
    return nonEmptyString(source.app) && source.app.length <= 80 &&
      (source.ref === undefined || (typeof source.ref === 'string' && source.ref.length <= 200)) &&
      validTimestamp(source.capturedAt)
      ? null : 'A connected source needs the app name and the time it was captured.';
  }
  return 'That kind of source is not supported.';
}

/**
 * The rule that keeps guesses apart from facts: an AI interpretation is always
 * labelled as one; a "source-verified" memory needs a real source; and an
 * interpretation can be confirmed by the user but never verified by a source.
 */
function combinationProblem(kind: MemoryKind, verification: MemoryVerification, source: MemorySource): string | null {
  if (verification === 'ai-interpretation' && kind !== 'interpretation') {
    return 'An AI interpretation must be saved as an interpretation, not as a fact or preference.';
  }
  if (kind === 'interpretation' && verification === 'source-verified') {
    return 'An interpretation can be confirmed by you, but not verified by a source.';
  }
  if (verification === 'source-verified' && source.type === 'manual') {
    return 'A memory can only be source-verified if it has a source other than you typing it.';
  }
  return null;
}

function revisionProblem(entry: unknown): string | null {
  if (!isObject(entry)) return 'A saved earlier version is invalid.';
  const ok = nonEmptyString(entry.text) && entry.text.length <= MAX_MEMORY_LENGTH &&
    KINDS.includes(entry.kind as string) && VERIFICATIONS.includes(entry.verification as string) &&
    SENSITIVITIES.includes(entry.sensitivity as string) && validTimestamp(entry.changedAt);
  return ok ? null : 'A saved earlier version is invalid.';
}

function memoryProblem(entry: unknown): string | null {
  if (!isObject(entry) || !nonEmptyString(entry.id)) return 'A memory needs an id.';
  if ('deletedAt' in entry) {
    if (Object.keys(entry).some((key) => key !== 'id' && key !== 'deletedAt')) {
      return 'A deleted memory must not keep any content.';
    }
    return validTimestamp(entry.deletedAt) ? null : 'A deleted memory needs a deletion time.';
  }
  if (typeof entry.text !== 'string' || !entry.text.trim()) return 'A memory needs some text.';
  if (entry.text.length > MAX_MEMORY_LENGTH) return `A memory can be at most ${MAX_MEMORY_LENGTH} characters.`;
  if (!KINDS.includes(entry.kind as string)) return 'A memory must be a fact, a preference or an interpretation.';
  if (!VERIFICATIONS.includes(entry.verification as string)) return 'A memory needs to say who confirmed it.';
  if (!SENSITIVITIES.includes(entry.sensitivity as string)) return 'A memory must be normal or private.';
  const source = sourceProblem(entry.source);
  if (source) return source;
  const combination = combinationProblem(entry.kind as MemoryKind, entry.verification as MemoryVerification, entry.source as MemorySource);
  if (combination) return combination;
  if (!validTimestamp(entry.createdAt) || !validTimestamp(entry.updatedAt)) return 'A memory needs creation and update times.';
  if (entry.revisions !== undefined) {
    if (!Array.isArray(entry.revisions) || entry.revisions.length > MAX_MEMORY_REVISIONS * 2) return 'A memory has too many earlier versions.';
    for (const revision of entry.revisions) {
      const problem = revisionProblem(revision);
      if (problem) return problem;
    }
  }
  if (entry.sourceRevokedAt !== undefined &&
    (!validTimestamp(entry.sourceRevokedAt) || (entry.source as MemorySource).type !== 'connected')) {
    return 'Only a memory from a connected app can have a disconnected source.';
  }
  if (entry.keptAt !== undefined && (!validTimestamp(entry.keptAt) || entry.sourceRevokedAt === undefined)) {
    return 'A memory can only be kept after its source was disconnected.';
  }
  if (entry.provenance !== undefined) {
    const p = entry.provenance;
    if (!isObject(p) || !nonEmptyString(p.capability) || !nonEmptyString(p.draftId) ||
      !nonEmptyString(p.draftItemId) || !validTimestamp(p.approvedAt)) return 'The memory\'s approval record is invalid.';
  }
  return null;
}

/**
 * Validate a snapshot including the optional memories. Older snapshots without
 * them pass through unchanged. Messages never include a memory's text.
 */
export function normalizeBakasData(value: unknown): BakasPlannerData {
  const data = normalizeUgnayData(value) as BakasPlannerData;
  const memories = (data as Record<string, unknown>).memories;
  if (memories === undefined) return data;
  if (!Array.isArray(memories)) throw new Error('The encrypted planner\'s memories collection is invalid.');
  const seen = new Set<string>();
  for (const entry of memories) {
    const problem = memoryProblem(entry);
    if (problem) throw new Error(`The encrypted planner's memories collection is invalid (${problem})`);
    const id = (entry as MemoryEntry).id;
    if (seen.has(id)) throw new Error('The encrypted planner\'s memories collection has duplicate IDs.');
    seen.add(id);
  }
  return data;
}

export function hasBakasData(value: Record<string, unknown>): boolean {
  return value.memories !== undefined;
}

// ------------------------------------------------------------------ helpers

function requireTimestamp(now: string): void {
  if (!validTimestamp(now)) throw new Error('A valid time is required.');
}

function live(data: BakasPlannerData): PlannerMemory[] {
  return (data.memories ?? []).filter((entry): entry is PlannerMemory => !isMemoryTombstone(entry));
}

function findLive(data: BakasPlannerData, id: string): PlannerMemory {
  const entry = (data.memories ?? []).find((candidate) => candidate.id === id);
  if (!entry || isMemoryTombstone(entry)) throw new Error('That memory no longer exists.');
  return entry;
}

function replaceEntry(data: BakasPlannerData, entry: MemoryEntry): BakasPlannerData {
  return { ...data, memories: (data.memories ?? []).map((candidate) => (candidate.id === entry.id ? entry : candidate)) };
}

function cloneSource(source: MemorySource): MemorySource {
  return JSON.parse(JSON.stringify(source)) as MemorySource;
}

function snapshotOf(memory: PlannerMemory): MemoryRevision {
  return {
    text: memory.text,
    kind: memory.kind,
    verification: memory.verification,
    sensitivity: memory.sensitivity,
    changedAt: memory.updatedAt,
  };
}

function withRevision(memory: PlannerMemory): MemoryRevision[] {
  return [...(memory.revisions ?? []), snapshotOf(memory)].slice(-MAX_MEMORY_REVISIONS);
}

/** Memories another capability may use: not private, and not cut off from a disconnected source unless kept. */
function usableByCapabilities(memory: PlannerMemory): boolean {
  return memory.sensitivity === 'normal' && (memory.sourceRevokedAt === undefined || memory.keptAt !== undefined);
}

function audited(data: BakasPlannerData, action: string, subjectIds: string[], now: string, makeId: () => string, actor: 'user' | UgnayCapability = 'user'): BakasPlannerData {
  return recordAuditEvent(data, { at: now, actor, action, subjectIds }, makeId) as BakasPlannerData;
}

// -------------------------------------------------------------- user actions

/** The user's own view of their memories, most recently changed first. Includes private ones. */
export function listMemories(value: unknown): PlannerMemory[] {
  return [...live(normalizeBakasData(value))]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export type NewMemory = {
  text: string;
  kind: MemoryKind;
  verification: MemoryVerification;
  source: MemorySource;
  sensitivity?: MemorySensitivity;
  provenance?: PlannerProvenance;
};

/**
 * Save a memory. This is the user's own action ("remember this"), or the
 * approved application of a proposal, which passes its `provenance`. Nothing
 * else should call it.
 */
export function createMemory(
  value: unknown,
  input: NewMemory,
  now: string,
  makeId: () => string,
): { data: BakasPlannerData; memory: PlannerMemory } {
  const data = normalizeBakasData(value);
  requireTimestamp(now);
  if (live(data).length >= MAX_MEMORIES) {
    throw new Error(`You can keep up to ${MAX_MEMORIES} memories. Delete some to save more.`);
  }
  const taken = new Set((data.memories ?? []).map((entry) => entry.id));
  let id = makeId();
  for (let attempt = 0; taken.has(id); attempt += 1) {
    if (attempt > 100) throw new Error('A new memory ID could not be created.');
    id = makeId();
  }
  const memory: PlannerMemory = {
    id,
    text: input.text.trim(),
    kind: input.kind,
    verification: input.verification,
    source: cloneSource(input.source),
    sensitivity: input.sensitivity ?? 'normal',
    createdAt: now,
    updatedAt: now,
    ...(input.provenance ? { provenance: { ...input.provenance } } : {}),
  };
  const problem = memoryProblem(memory);
  if (problem) throw new Error(problem);
  const saved: BakasPlannerData = { ...data, memories: [...(data.memories ?? []), memory] };
  return { data: audited(saved, 'memory.created', [id], now, makeId), memory };
}

/**
 * Correct a memory. The earlier wording is kept. Changing the text or the kind
 * means the user now vouches for it, so it becomes user-confirmed; changing
 * only its sensitivity leaves who confirmed it alone.
 */
export function correctMemory(
  value: unknown,
  id: string,
  changes: { text?: string; kind?: MemoryKind; sensitivity?: MemorySensitivity },
  now: string,
  makeId: () => string,
): BakasPlannerData {
  const data = normalizeBakasData(value);
  requireTimestamp(now);
  const memory = findLive(data, id);
  const text = changes.text === undefined ? memory.text : changes.text.trim();
  const kind = changes.kind ?? memory.kind;
  const sensitivity = changes.sensitivity ?? memory.sensitivity;
  if (text === memory.text && kind === memory.kind && sensitivity === memory.sensitivity) return data;
  const contentChanged = text !== memory.text || kind !== memory.kind;
  const corrected: PlannerMemory = {
    ...memory,
    text,
    kind,
    sensitivity,
    verification: contentChanged ? 'user-confirmed' : memory.verification,
    updatedAt: now,
    revisions: withRevision(memory),
  };
  const problem = memoryProblem(corrected);
  if (problem) throw new Error(problem);
  return audited(replaceEntry(data, corrected), 'memory.corrected', [id], now, makeId);
}

/**
 * Delete a memory for good. Its text and every earlier version are erased,
 * leaving only a marker so an older copy on another device can't bring it back.
 */
export function deleteMemory(value: unknown, id: string, now: string, makeId: () => string): BakasPlannerData {
  const data = normalizeBakasData(value);
  requireTimestamp(now);
  const entry = (data.memories ?? []).find((candidate) => candidate.id === id);
  if (!entry) throw new Error('That memory no longer exists.');
  if (isMemoryTombstone(entry)) return data;
  return audited(replaceEntry(data, { id, deletedAt: now }), 'memory.deleted', [id], now, makeId);
}

/**
 * A connected app was disconnected: mark every memory that came from it. They
 * stay visible to the user, but no other capability uses them until the user
 * decides to keep or delete each one.
 */
export function revokeMemorySource(value: unknown, source: { app: string }, now: string, makeId: () => string): BakasPlannerData {
  const data = normalizeBakasData(value);
  requireTimestamp(now);
  const affected = live(data).filter((memory) =>
    memory.source.type === 'connected' && memory.source.app === source.app && memory.sourceRevokedAt === undefined);
  if (!affected.length) return data;
  const ids = new Set(affected.map((memory) => memory.id));
  const memories = (data.memories ?? []).map((entry) =>
    ids.has(entry.id) ? { ...(entry as PlannerMemory), sourceRevokedAt: now, updatedAt: now } : entry);
  return audited({ ...data, memories }, 'memory.source.revoked', [...ids], now, makeId);
}

/** The user chooses to keep a memory whose source was disconnected. It becomes user-confirmed. */
export function keepMemoryAfterRevocation(value: unknown, id: string, now: string, makeId: () => string): BakasPlannerData {
  const data = normalizeBakasData(value);
  requireTimestamp(now);
  const memory = findLive(data, id);
  if (memory.sourceRevokedAt === undefined) throw new Error('This memory\'s source has not been disconnected.');
  if (memory.keptAt !== undefined) return data;
  const kept: PlannerMemory = {
    ...memory,
    verification: 'user-confirmed',
    keptAt: now,
    updatedAt: now,
    revisions: withRevision(memory),
  };
  return audited(replaceEntry(data, kept), 'memory.kept', [id], now, makeId);
}

// ----------------------------------------------------------------- retrieval

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'be', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'as', 'by', 'from',
  'ang', 'ng', 'sa', 'na', 'ay', 'ko', 'mo', 'ako', 'ka', 'siya', 'kami', 'tayo',
]);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function queryTokens(query: string | undefined): string[] {
  return [...new Set(tokens(query ?? '').filter((token) => token.length >= 2 && !STOPWORDS.has(token)))];
}

function sameRef(left: PlannerRecordRef, right: PlannerRecordRef): boolean {
  return left.type === right.type && left.id === right.id;
}

export type MemoryRequest = {
  capability: UgnayCapability;
  /** Words to look for. Simple word matching for now. */
  query?: string;
  /** Planner records the request is about; memories saved from them are included. */
  relatedTo?: PlannerRecordRef[];
  limit?: number;
};

export type MemoryRetrieval = {
  allowed: boolean;
  missing: UgnayScope[];
  memories: MemoryContext[];
};

/**
 * What a capability may use right now. Default deny: it needs an active
 * `memory.read` grant. It never gets private memories, deleted memories, or
 * memories cut off from a disconnected source (unless the user kept them), and
 * it never browses: with nothing to look for it gets nothing.
 */
export function retrieveMemories(value: unknown, request: MemoryRequest): MemoryRetrieval {
  const data = normalizeBakasData(value);
  const access = checkCapabilityAccess(data, request.capability, ['memory.read']);
  if (!access.allowed) return { allowed: false, missing: access.missing, memories: [] };
  const wanted = queryTokens(request.query);
  const related = request.relatedTo ?? [];
  if (!wanted.length && !related.length) return { allowed: true, missing: [], memories: [] };
  const limit = Math.min(20, Math.max(1, Math.floor(request.limit ?? 5)));

  const scored = live(data).filter(usableByCapabilities).map((memory) => {
    const words = tokens(memory.text);
    const matched = wanted.filter((token) =>
      words.some((word) => word === token || (token.length >= 3 && word.startsWith(token)))).length;
    const linked = memory.source.type === 'planner' && related.some((ref) => sameRef(ref, (memory.source as { ref: PlannerRecordRef }).ref));
    return { memory, score: matched + (linked ? 3 : 0) };
  }).filter((candidate) => candidate.score > 0);

  scored.sort((left, right) =>
    right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt) || left.memory.id.localeCompare(right.memory.id));

  return {
    allowed: true,
    missing: [],
    memories: scored.slice(0, limit).map(({ memory }) => ({
      id: memory.id,
      text: memory.text,
      kind: memory.kind,
      verification: memory.verification,
      source: cloneSource(memory.source),
      updatedAt: memory.updatedAt,
    })),
  };
}

/**
 * Record that a capability actually used some memories. Kept separate from
 * `retrieveMemories` so merely looking doesn't change the planner; call it
 * when the memories are shown or passed on. The log holds ids, never text.
 */
export function recordMemoryAccess(
  value: unknown,
  capability: UgnayCapability,
  memoryIds: string[],
  now: string,
  makeId: () => string,
): BakasPlannerData {
  const data = normalizeBakasData(value);
  requireTimestamp(now);
  if (!memoryIds.length) return data;
  return audited(data, 'memory.accessed', [...new Set(memoryIds)], now, makeId, capability);
}

// ------------------------------------------------------------------- merge

function contentKey(version: Pick<MemoryRevision, 'text' | 'kind' | 'verification' | 'sensitivity'>): string {
  return JSON.stringify([version.text, version.kind, version.verification, version.sensitivity]);
}

function revisionKey(revision: MemoryRevision): string {
  return `${revision.changedAt}|${contentKey(revision)}`;
}

function earliest(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => value !== undefined)
    .reduce<string | undefined>((first, value) => (first === undefined || Date.parse(value) < Date.parse(first) ? value : first), undefined);
}

function latestOf(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => value !== undefined)
    .reduce<string | undefined>((last, value) => (last === undefined || Date.parse(value) > Date.parse(last) ? value : last), undefined);
}

function newerVersion(left: PlannerMemory, right: PlannerMemory): PlannerMemory {
  const byTime = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  if (byTime !== 0) return byTime > 0 ? left : right;
  return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
}

function mergeMemoryVersions(versions: MemoryEntry[]): MemoryEntry {
  const tombstones = versions.filter(isMemoryTombstone);
  if (tombstones.length) {
    // Deletion is final: a stale copy that still has the memory can never restore it.
    return { id: tombstones[0].id, deletedAt: earliest(tombstones.map((entry) => entry.deletedAt))! };
  }
  const memories = versions as PlannerMemory[];
  const winner = memories.reduce(newerVersion);
  const merged: PlannerMemory = { ...winner };
  merged.createdAt = earliest(memories.map((memory) => memory.createdAt))!;

  // Disconnecting a source can't be undone by an older copy; keeping a memory afterwards sticks too.
  const sourceRevokedAt = earliest(memories.map((memory) => memory.sourceRevokedAt));
  const keptAt = sourceRevokedAt === undefined ? undefined : latestOf(memories.map((memory) => memory.keptAt));
  delete merged.sourceRevokedAt;
  delete merged.keptAt;
  if (sourceRevokedAt !== undefined) merged.sourceRevokedAt = sourceRevokedAt;
  if (keptAt !== undefined) merged.keptAt = keptAt;

  // Every earlier wording survives, including what a device that lost the race had saved.
  const revisions = new Map<string, MemoryRevision>();
  for (const memory of memories) for (const revision of memory.revisions ?? []) revisions.set(revisionKey(revision), revision);
  const known = new Set([...revisions.values()].map(contentKey));
  for (const memory of memories) {
    if (memory === winner || contentKey(memory) === contentKey(winner)) continue;
    const derived = snapshotOf(memory);
    if (!revisions.has(revisionKey(derived)) && !known.has(contentKey(derived))) revisions.set(revisionKey(derived), derived);
  }
  const ordered = [...revisions.values()]
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt) || contentKey(left).localeCompare(contentKey(right)))
    .slice(-MAX_MEMORY_REVISIONS);
  delete merged.revisions;
  if (ordered.length) merged.revisions = ordered;
  return merged;
}

/**
 * Merge the memories of any number of snapshot copies (base, local, remote).
 * The result doesn't depend on the order of the copies. Deletions are final,
 * the newest wording wins while older wording is kept as history, and a
 * disconnected source stays disconnected.
 */
export function mergeMemoryCollections(copies: BakasPlannerData[]): { memories?: MemoryEntry[] } {
  if (!copies.some((copy) => copy.memories !== undefined)) return {};
  const groups = new Map<string, MemoryEntry[]>();
  for (const copy of copies) {
    for (const entry of copy.memories ?? []) groups.set(entry.id, [...(groups.get(entry.id) ?? []), entry]);
  }
  const sortKey = (entry: MemoryEntry) => (isMemoryTombstone(entry) ? entry.deletedAt : entry.createdAt);
  const memories = [...groups.values()].map(mergeMemoryVersions)
    .sort((left, right) => sortKey(left).localeCompare(sortKey(right)) || left.id.localeCompare(right.id));
  return { memories };
}
