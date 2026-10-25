import {
  normalizeReleaseTwoData,
  type ReleaseTwoPlannerData,
  type ReleaseTwoRecordType,
} from '@workspace/planner-contract/release2';

/**
 * UGNAY: BUHAY.OS's internal coordination layer. It is not a feature users
 * see; it decides which internal capability (memory, money context, advice)
 * may use which planner context, keeps every proposed change as a draft
 * until the user decides, and records what happened.
 *
 * Everything here lives inside the encrypted planner snapshot as optional
 * collections, absent until first used. Nothing in this module reads or
 * sends data anywhere; it only describes and checks permission state.
 */

export const UGNAY_SCHEMA_VERSION = 3;
export const MAX_AUDIT_EVENTS = 1000;

/** Capabilities and the scopes each one can ever be granted. */
export const UGNAY_CAPABILITIES = {
  planner: { label: 'Life Planner', scopes: ['planner.read', 'planner.write'] },
  bakas: { label: 'Memory', scopes: ['memory.read', 'memory.write', 'connected.read'] },
  tuklas: { label: 'Money context', scopes: ['commitments.read', 'commitments.write', 'finance.connected.read'] },
  ikaw: {
    label: 'Advice and summaries',
    scopes: ['planner.read', 'memory.read', 'commitments.read', 'summaries.write', 'ai.egress'],
  },
} as const;

export type UgnayCapability = keyof typeof UGNAY_CAPABILITIES;
export type UgnayScope = (typeof UGNAY_CAPABILITIES)[UgnayCapability]['scopes'][number];

export type CapabilityGrant = {
  id: string;
  capability: UgnayCapability;
  scopes: UgnayScope[];
  /** Plain-language reason shown to the user, e.g. "Use my memories when drafting plans". */
  purpose: string;
  grantedAt: string;
  changedAt: string;
  /** Once set, the grant is permanently revoked; a new grant is needed to restore access. */
  revokedAt?: string;
};

export type PlanDraftItemStatus = 'proposed' | 'approved' | 'dismissed';

export type PlanDraftItem = {
  id: string;
  action: 'create' | 'update';
  target: { type: ReleaseTwoRecordType; id?: string };
  /** Proposed field values. They never reach the planner until approved and applied. */
  fields: Record<string, unknown>;
  status: PlanDraftItemStatus;
  decidedAt?: string;
};

export type PlanDraft = {
  id: string;
  title: string;
  origin: { capability: UgnayCapability; createdAt: string };
  items: PlanDraftItem[];
  /** Derived: open until every item is decided; approved if any item was approved. */
  status: 'open' | 'approved' | 'dismissed';
  updatedAt: string;
};

export type AuditActor = 'user' | 'system' | UgnayCapability;

export type AuditEvent = {
  id: string;
  at: string;
  actor: AuditActor;
  action: string;
  subjectIds?: string[];
  /** Set when planner content left the device (e.g. to an AI provider): where to, and which fields. */
  egress?: { destination: string; fields: string[] };
};

/** Stamped on planner records created or changed from an approved draft item. */
export type PlannerProvenance = {
  capability: UgnayCapability;
  draftId: string;
  draftItemId: string;
  approvedAt: string;
};

export type UgnayPlannerData = ReleaseTwoPlannerData & {
  capabilityGrants?: CapabilityGrant[];
  planDrafts?: PlanDraft[];
  auditEvents?: AuditEvent[];
};

export const UGNAY_COLLECTION_KEYS = ['capabilityGrants', 'planDrafts', 'auditEvents'] as const;

// ---------------------------------------------------------------- validation

const recordTypes = new Set<string>([
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

export function isUgnayCapability(value: unknown): value is UgnayCapability {
  return typeof value === 'string' && Object.hasOwn(UGNAY_CAPABILITIES, value);
}

export function isScopeAllowed(capability: UgnayCapability, scope: unknown): scope is UgnayScope {
  return (UGNAY_CAPABILITIES[capability].scopes as readonly string[]).includes(scope as string);
}

function validGrant(entry: unknown): entry is CapabilityGrant {
  if (!isObject(entry)) return false;
  return nonEmptyString(entry.id) && isUgnayCapability(entry.capability) &&
    Array.isArray(entry.scopes) && entry.scopes.length > 0 &&
    entry.scopes.every((scope) => isScopeAllowed(entry.capability as UgnayCapability, scope)) &&
    nonEmptyString(entry.purpose) && validTimestamp(entry.grantedAt) && validTimestamp(entry.changedAt) &&
    (entry.revokedAt === undefined || validTimestamp(entry.revokedAt));
}

function validDraftItem(entry: unknown): entry is PlanDraftItem {
  if (!isObject(entry) || !isObject(entry.target) || !isObject(entry.fields)) return false;
  const target = entry.target;
  const decided = entry.status === 'approved' || entry.status === 'dismissed';
  return nonEmptyString(entry.id) && (entry.action === 'create' || entry.action === 'update') &&
    recordTypes.has(target.type as string) &&
    (entry.action === 'create' ? target.id === undefined : nonEmptyString(target.id)) &&
    (entry.status === 'proposed' || decided) &&
    (decided ? validTimestamp(entry.decidedAt) : entry.decidedAt === undefined);
}

function validDraft(entry: unknown): entry is PlanDraft {
  if (!isObject(entry) || !isObject(entry.origin)) return false;
  return nonEmptyString(entry.id) && nonEmptyString(entry.title) &&
    isUgnayCapability(entry.origin.capability) && validTimestamp(entry.origin.createdAt) &&
    Array.isArray(entry.items) && entry.items.length > 0 && entry.items.every(validDraftItem) &&
    new Set(entry.items.map((item) => (item as PlanDraftItem).id)).size === entry.items.length &&
    ['open', 'approved', 'dismissed'].includes(entry.status as string) &&
    entry.status === draftStatus(entry.items as PlanDraftItem[]) &&
    validTimestamp(entry.updatedAt);
}

function validAuditEvent(entry: unknown): entry is AuditEvent {
  if (!isObject(entry)) return false;
  const actorOk = entry.actor === 'user' || entry.actor === 'system' || isUgnayCapability(entry.actor);
  const egress = entry.egress;
  return nonEmptyString(entry.id) && validTimestamp(entry.at) && actorOk && nonEmptyString(entry.action) &&
    (entry.subjectIds === undefined ||
      (Array.isArray(entry.subjectIds) && entry.subjectIds.every(nonEmptyString))) &&
    (egress === undefined ||
      (isObject(egress) && nonEmptyString(egress.destination) &&
        Array.isArray(egress.fields) && egress.fields.every(nonEmptyString)));
}

function validateCollection(candidate: Record<string, unknown>, key: string, validate: (entry: unknown) => boolean) {
  const value = candidate[key];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => !validate(entry))) {
    throw new Error(`The encrypted planner's ${key} collection is invalid.`);
  }
  if (new Set(value.map((entry) => (entry as { id: string }).id)).size !== value.length) {
    throw new Error(`The encrypted planner's ${key} collection has duplicate IDs.`);
  }
}

/**
 * Validate a snapshot including the optional UGNAY collections. Older
 * snapshots without them pass through unchanged, unknown fields included.
 */
export function normalizeUgnayData(value: unknown): UgnayPlannerData {
  const data = normalizeReleaseTwoData(value) as UgnayPlannerData;
  const candidate = data as Record<string, unknown>;
  validateCollection(candidate, 'capabilityGrants', validGrant);
  validateCollection(candidate, 'planDrafts', validDraft);
  validateCollection(candidate, 'auditEvents', validAuditEvent);
  return data;
}

export function hasUgnayData(value: Record<string, unknown>): boolean {
  return UGNAY_COLLECTION_KEYS.some((key) => value[key] !== undefined);
}

export function markUgnayDataUsed<T extends UgnayPlannerData>(data: T): T {
  return { ...data, schemaVersion: Math.max(data.schemaVersion ?? 1, UGNAY_SCHEMA_VERSION) };
}

// ------------------------------------------------------------------- audit

function withAuditEvent(data: UgnayPlannerData, event: Omit<AuditEvent, 'id'>, makeId: () => string): UgnayPlannerData {
  const events = [...(data.auditEvents ?? []), { id: makeId(), ...event }];
  return { ...data, auditEvents: capAuditEvents(events) };
}

function capAuditEvents(events: AuditEvent[]): AuditEvent[] {
  const ordered = [...events].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  return ordered.slice(Math.max(0, ordered.length - MAX_AUDIT_EVENTS));
}

/** Append an audit event; the log keeps the newest {@link MAX_AUDIT_EVENTS}. */
export function recordAuditEvent(value: unknown, event: Omit<AuditEvent, 'id'>, makeId: () => string): UgnayPlannerData {
  if (!validAuditEvent({ id: 'pending', ...event })) throw new Error('The audit event is invalid.');
  return markUgnayDataUsed(withAuditEvent(normalizeUgnayData(value), event, makeId));
}

// ------------------------------------------------------------------ grants

export function activeCapabilityGrants(value: unknown, capability?: UgnayCapability): CapabilityGrant[] {
  return (normalizeUgnayData(value).capabilityGrants ?? [])
    .filter((grant) => !grant.revokedAt && (!capability || grant.capability === capability));
}

/**
 * Default deny: a capability may use a scope only while an unrevoked grant
 * for that capability includes it.
 */
export function checkCapabilityAccess(
  value: unknown,
  capability: UgnayCapability,
  scopes: UgnayScope[],
): { allowed: boolean; missing: UgnayScope[] } {
  const granted = new Set(activeCapabilityGrants(value, capability).flatMap((grant) => grant.scopes));
  const missing = scopes.filter((scope) => !isScopeAllowed(capability, scope) || !granted.has(scope));
  return { allowed: missing.length === 0, missing };
}

export function grantCapability(
  value: unknown,
  request: { capability: UgnayCapability; scopes: UgnayScope[]; purpose: string },
  now: string,
  makeId: () => string,
): { data: UgnayPlannerData; grant: CapabilityGrant } {
  const data = normalizeUgnayData(value);
  const scopes = [...new Set(request.scopes)];
  const grant: CapabilityGrant = {
    id: makeId(),
    capability: request.capability,
    scopes,
    purpose: request.purpose.trim(),
    grantedAt: now,
    changedAt: now,
  };
  if (!validGrant(grant)) throw new Error('The capability grant is invalid for this capability.');
  const withGrant = { ...data, capabilityGrants: [...(data.capabilityGrants ?? []), grant] };
  const audited = withAuditEvent(withGrant, {
    at: now, actor: 'user', action: 'grant.created', subjectIds: [grant.id],
  }, makeId);
  return { data: markUgnayDataUsed(audited), grant };
}

/** Revoke a grant. Revocation is permanent and survives merges with older copies. */
export function revokeCapabilityGrant(value: unknown, grantId: string, now: string, makeId: () => string): UgnayPlannerData {
  const data = normalizeUgnayData(value);
  const grant = data.capabilityGrants?.find((candidate) => candidate.id === grantId);
  if (!grant || grant.revokedAt) return data;
  const capabilityGrants = data.capabilityGrants!.map((candidate) =>
    candidate.id === grantId ? { ...candidate, revokedAt: now, changedAt: now } : candidate);
  return markUgnayDataUsed(withAuditEvent({ ...data, capabilityGrants }, {
    at: now, actor: 'user', action: 'grant.revoked', subjectIds: [grantId],
  }, makeId));
}

// ------------------------------------------------------------------ drafts

function draftStatus(items: PlanDraftItem[]): PlanDraft['status'] {
  if (items.some((item) => item.status === 'proposed')) return 'open';
  return items.some((item) => item.status === 'approved') ? 'approved' : 'dismissed';
}

/**
 * Store proposed planner changes as a draft. Nothing is written to tasks,
 * goals or other records: approval is a separate, explicit user decision.
 * Capabilities other than the planner itself need an active grant.
 */
export function createPlanDraft(
  value: unknown,
  request: {
    capability: UgnayCapability;
    title: string;
    items: Array<Pick<PlanDraftItem, 'action' | 'target' | 'fields'>>;
  },
  now: string,
  makeId: () => string,
): { data: UgnayPlannerData; draft: PlanDraft } {
  const data = normalizeUgnayData(value);
  if (request.capability !== 'planner' && activeCapabilityGrants(data, request.capability).length === 0) {
    throw new Error(`${UGNAY_CAPABILITIES[request.capability].label} has no active permission to propose plans.`);
  }
  const items: PlanDraftItem[] = request.items.map((item) => ({
    id: makeId(),
    action: item.action,
    target: { ...item.target },
    fields: { ...item.fields },
    status: 'proposed',
  }));
  const draft: PlanDraft = {
    id: makeId(),
    title: request.title.trim(),
    origin: { capability: request.capability, createdAt: now },
    items,
    status: 'open',
    updatedAt: now,
  };
  if (!validDraft(draft)) throw new Error('The plan draft is invalid.');
  const withDraft = { ...data, planDrafts: [...(data.planDrafts ?? []), draft] };
  const audited = withAuditEvent(withDraft, {
    at: now, actor: request.capability, action: 'draft.created', subjectIds: [draft.id],
  }, makeId);
  return { data: markUgnayDataUsed(audited), draft };
}

/**
 * Record the user's decision on one proposed item. Decisions are final: an
 * approved or dismissed item can't be changed; propose a new draft instead.
 */
export function decidePlanDraftItem(
  value: unknown,
  draftId: string,
  itemId: string,
  decision: 'approved' | 'dismissed',
  now: string,
  makeId: () => string,
): UgnayPlannerData {
  const data = normalizeUgnayData(value);
  const draft = data.planDrafts?.find((candidate) => candidate.id === draftId);
  const item = draft?.items.find((candidate) => candidate.id === itemId);
  if (!draft || !item) throw new Error('That draft item no longer exists.');
  if (item.status !== 'proposed') throw new Error('That draft item has already been decided.');
  const items = draft.items.map((candidate) =>
    candidate.id === itemId ? { ...candidate, status: decision, decidedAt: now } : candidate);
  const updated: PlanDraft = { ...draft, items, status: draftStatus(items), updatedAt: now };
  const planDrafts = data.planDrafts!.map((candidate) => candidate.id === draftId ? updated : candidate);
  return markUgnayDataUsed(withAuditEvent({ ...data, planDrafts }, {
    at: now, actor: 'user', action: `draft.item.${decision}`, subjectIds: [draftId, itemId],
  }, makeId));
}

/** The items a user approved; only these may ever be applied to the planner. */
export function approvedDraftItems(draft: PlanDraft): PlanDraftItem[] {
  return draft.items.filter((item) => item.status === 'approved');
}

/** Stamp a planner record with where an approved change came from. */
export function withProvenance<T extends object>(
  record: T,
  draft: PlanDraft,
  item: PlanDraftItem,
): T & { provenance: PlannerProvenance } {
  if (item.status !== 'approved' || !item.decidedAt || !draft.items.some((candidate) => candidate.id === item.id)) {
    throw new Error('Only an approved item from this draft can be applied.');
  }
  return {
    ...record,
    provenance: {
      capability: draft.origin.capability,
      draftId: draft.id,
      draftItemId: item.id,
      approvedAt: item.decidedAt,
    },
  };
}

// ------------------------------------------------------------------- merge

function latest<T>(items: T[], time: (item: T) => string): T {
  return items.reduce((winner, item) => (Date.parse(time(item)) > Date.parse(time(winner)) ? item : winner));
}

function mergeGrants(versions: CapabilityGrant[]): CapabilityGrant {
  const winner = latest(versions, (grant) => grant.changedAt);
  const revocations = versions.map((grant) => grant.revokedAt).filter((at): at is string => Boolean(at));
  if (!revocations.length) return winner;
  // Revocation is sticky: an older, unrevoked copy can never restore access.
  const revokedAt = revocations.reduce((first, at) => (Date.parse(at) < Date.parse(first) ? at : first));
  return { ...winner, revokedAt, changedAt: latest(versions, (grant) => grant.changedAt).changedAt };
}

function mergeDraftItems(versions: PlanDraftItem[]): PlanDraftItem {
  const decided = versions.filter((item) => item.status !== 'proposed');
  if (!decided.length) return versions[0];
  // The first decision stands; a stale proposed copy can't undo it.
  return decided.reduce((first, item) =>
    Date.parse(item.decidedAt!) < Date.parse(first.decidedAt!) ? item : first);
}

function mergeDrafts(versions: PlanDraft[]): PlanDraft {
  const base = latest(versions, (draft) => draft.updatedAt);
  const ids = [...new Set(versions.flatMap((draft) => draft.items.map((item) => item.id)))];
  const items = ids.map((id) =>
    mergeDraftItems(versions.flatMap((draft) => draft.items.filter((item) => item.id === id))));
  return { ...base, items, status: draftStatus(items), updatedAt: base.updatedAt };
}

function groupById<T extends { id: string }>(collections: Array<T[] | undefined>): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const collection of collections) {
    for (const item of collection ?? []) groups.set(item.id, [...(groups.get(item.id) ?? []), item]);
  }
  return groups;
}

/**
 * Merge the UGNAY collections of any number of snapshot copies (base, local,
 * remote). These records are only ever added or moved forward (grants get
 * revoked, items get decided, events get appended), so a union with the
 * rules above converges regardless of order. Only keys present in some copy
 * are returned.
 */
export function mergeUgnayCollections(copies: UgnayPlannerData[]): Partial<UgnayPlannerData> {
  const result: Partial<UgnayPlannerData> = {};
  if (copies.some((copy) => copy.capabilityGrants !== undefined)) {
    result.capabilityGrants = [...groupById(copies.map((copy) => copy.capabilityGrants)).values()]
      .map(mergeGrants)
      .sort((left, right) => left.grantedAt.localeCompare(right.grantedAt) || left.id.localeCompare(right.id));
  }
  if (copies.some((copy) => copy.planDrafts !== undefined)) {
    result.planDrafts = [...groupById(copies.map((copy) => copy.planDrafts)).values()]
      .map(mergeDrafts)
      .sort((left, right) =>
        left.origin.createdAt.localeCompare(right.origin.createdAt) || left.id.localeCompare(right.id));
  }
  if (copies.some((copy) => copy.auditEvents !== undefined)) {
    result.auditEvents = capAuditEvents([...groupById(copies.map((copy) => copy.auditEvents)).values()]
      .map((versions) => versions[0]));
  }
  return result;
}
