import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_AUDIT_EVENTS,
  UGNAY_SCHEMA_VERSION,
  activeCapabilityGrants,
  approvedDraftItems,
  checkCapabilityAccess,
  createPlanDraft,
  decidePlanDraftItem,
  grantCapability,
  normalizeUgnayData,
  recordAuditEvent,
  revokeCapabilityGrant,
  withProvenance,
} from './ugnay.ts';
import { mergeReleaseTwoData, mergeReleaseTwoSnapshots } from './release2-merge.ts';

const legacy = () => ({
  tasks: [{ id: 't1', title: 'Pack boxes', date: '2026-11-01', time: '', tag: '', completed: false, createdAt: 1 }],
  notes: [],
  settings: { theme: 'light', accentHex: '#3b765e' },
  unknownField: { retained: true },
});

const ids = (prefix = 'id') => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

const T = (minute) => `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`;

test('older snapshots load unchanged: no UGNAY collections are added and unknown fields survive', () => {
  const data = normalizeUgnayData(legacy());
  assert.deepEqual(data, legacy());
  for (const key of ['capabilityGrants', 'planDrafts', 'auditEvents', 'schemaVersion']) assert.equal(key in data, false);
});

test('access is denied by default and follows grants and revocation', () => {
  const makeId = ids();
  const before = checkCapabilityAccess(legacy(), 'bakas', ['memory.read']);
  assert.deepEqual(before, { allowed: false, missing: ['memory.read'] });

  const { data, grant } = grantCapability(legacy(), {
    capability: 'bakas', scopes: ['memory.read', 'memory.read'], purpose: '  Use my memories when drafting plans ',
  }, T(0), makeId);
  assert.deepEqual(grant.scopes, ['memory.read']);
  assert.equal(grant.purpose, 'Use my memories when drafting plans');
  assert.equal(data.schemaVersion, UGNAY_SCHEMA_VERSION);
  assert.deepEqual(checkCapabilityAccess(data, 'bakas', ['memory.read']), { allowed: true, missing: [] });
  assert.deepEqual(checkCapabilityAccess(data, 'bakas', ['memory.read', 'memory.write']).missing, ['memory.write']);
  // A grant for one capability gives nothing to another.
  assert.equal(checkCapabilityAccess(data, 'ikaw', ['memory.read']).allowed, false);

  const revoked = revokeCapabilityGrant(data, grant.id, T(5), makeId);
  assert.equal(checkCapabilityAccess(revoked, 'bakas', ['memory.read']).allowed, false);
  assert.deepEqual(activeCapabilityGrants(revoked), []);
  // Revoking again is a no-op: no new timestamp, no extra audit event.
  assert.deepEqual(revokeCapabilityGrant(revoked, grant.id, T(6), makeId), revoked);
  assert.deepEqual(revoked.auditEvents.map((event) => event.action), ['grant.created', 'grant.revoked']);
  assert.ok(revoked.auditEvents.every((event) => event.actor === 'user'));
  assert.deepEqual(revoked.tasks, legacy().tasks);
});

test('grants are limited to the scopes registered for each capability', () => {
  const makeId = ids();
  assert.throws(() => grantCapability(legacy(), { capability: 'tuklas', scopes: ['memory.read'], purpose: 'x' }, T(0), makeId), /invalid/);
  assert.throws(() => grantCapability(legacy(), { capability: 'bakas', scopes: [], purpose: 'x' }, T(0), makeId), /invalid/);
  assert.throws(() => grantCapability(legacy(), { capability: 'bakas', scopes: ['memory.read'], purpose: '   ' }, T(0), makeId), /invalid/);
  assert.equal(checkCapabilityAccess(legacy(), 'tuklas', ['memory.read']).allowed, false);
});

test('drafts write nothing to the planner; only explicit, final user decisions approve items', () => {
  const makeId = ids();
  assert.throws(() => createPlanDraft(legacy(), {
    capability: 'ikaw', title: 'Move plan', items: [{ action: 'create', target: { type: 'task' }, fields: { title: 'Book movers' } }],
  }, T(0), makeId), /no active permission/);

  const granted = grantCapability(legacy(), { capability: 'ikaw', scopes: ['planner.read'], purpose: 'Suggest next steps' }, T(0), makeId).data;
  const { data, draft } = createPlanDraft(granted, {
    capability: 'ikaw',
    title: 'Move to a new city',
    items: [
      { action: 'create', target: { type: 'task' }, fields: { title: 'Book movers' } },
      { action: 'update', target: { type: 'task', id: 't1' }, fields: { date: '2026-11-02' } },
    ],
  }, T(1), makeId);
  assert.equal(draft.status, 'open');
  assert.deepEqual(data.tasks, legacy().tasks, 'creating a draft must not touch planner records');
  assert.equal(data.auditEvents.at(-1).actor, 'ikaw');

  const one = decidePlanDraftItem(data, draft.id, draft.items[0].id, 'approved', T(2), makeId);
  assert.equal(one.planDrafts[0].status, 'open');
  const both = decidePlanDraftItem(one, draft.id, draft.items[1].id, 'dismissed', T(3), makeId);
  const decided = both.planDrafts[0];
  assert.equal(decided.status, 'approved');
  assert.deepEqual(both.tasks, legacy().tasks, 'approval alone still writes nothing');
  assert.throws(() => decidePlanDraftItem(both, draft.id, draft.items[1].id, 'approved', T(4), makeId), /already been decided/);

  const approved = approvedDraftItems(decided);
  assert.deepEqual(approved.map((item) => item.fields.title), ['Book movers']);
  const record = withProvenance({ id: 't2', title: 'Book movers' }, decided, approved[0]);
  assert.deepEqual(record.provenance, { capability: 'ikaw', draftId: draft.id, draftItemId: approved[0].id, approvedAt: T(2) });
  assert.throws(() => withProvenance({ id: 'x' }, decided, decided.items[1]), /Only an approved item/);

  const allDismissed = decidePlanDraftItem(
    decidePlanDraftItem(data, draft.id, draft.items[0].id, 'dismissed', T(2), makeId),
    draft.id, draft.items[1].id, 'dismissed', T(3), makeId);
  assert.equal(allDismissed.planDrafts[0].status, 'dismissed');
});

test('the audit log records egress details and keeps only the newest events', () => {
  const makeId = ids('ev');
  let data = recordAuditEvent(legacy(), {
    at: T(0), actor: 'ikaw', action: 'context.sent', egress: { destination: 'ai-relay', fields: ['task.title'] },
  }, makeId);
  assert.deepEqual(data.auditEvents[0].egress, { destination: 'ai-relay', fields: ['task.title'] });
  assert.throws(() => recordAuditEvent(legacy(), { at: 'yesterday', actor: 'user', action: 'x' }, makeId), /invalid/);
  const events = Array.from({ length: MAX_AUDIT_EVENTS + 5 }, (_, i) => ({
    id: `e${String(i).padStart(5, '0')}`, at: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), actor: 'system', action: 'tick',
  }));
  data = recordAuditEvent({ ...legacy(), auditEvents: events.slice(0, MAX_AUDIT_EVENTS) }, { at: T(59), actor: 'user', action: 'last' }, makeId);
  assert.equal(data.auditEvents.length, MAX_AUDIT_EVENTS);
  assert.equal(data.auditEvents.at(-1).action, 'last');
  assert.equal(data.auditEvents[0].id, 'e00001');
});

test('invalid UGNAY collections are rejected instead of silently repaired', () => {
  const draft = {
    id: 'd1', title: 'Plan', origin: { capability: 'ikaw', createdAt: T(0) }, status: 'open', updatedAt: T(0),
    items: [{ id: 'i1', action: 'create', target: { type: 'task' }, fields: {}, status: 'proposed' }],
  };
  assert.doesNotThrow(() => normalizeUgnayData({ ...legacy(), planDrafts: [draft] }));
  assert.throws(() => normalizeUgnayData({ ...legacy(), planDrafts: [{ ...draft, status: 'approved' }] }), /planDrafts/);
  assert.throws(() => normalizeUgnayData({ ...legacy(), planDrafts: [{ ...draft, items: [{ ...draft.items[0], status: 'approved' }] }] }), /planDrafts/);
  assert.throws(() => normalizeUgnayData({ ...legacy(), planDrafts: [{ ...draft, items: [{ ...draft.items[0], target: { type: 'task', id: 't1' } }] }] }), /planDrafts/);
  assert.throws(() => normalizeUgnayData({ ...legacy(), planDrafts: [draft, draft] }), /duplicate/);
  assert.throws(() => normalizeUgnayData({ ...legacy(), capabilityGrants: [{ id: 'g', capability: 'unknown', scopes: ['x'], purpose: 'p', grantedAt: T(0), changedAt: T(0) }] }), /capabilityGrants/);
});

test('offline merges keep both devices\' grants, drafts and events; revocation and first decisions stick', () => {
  const makeId = ids('m');
  const shared = grantCapability(legacy(), { capability: 'ikaw', scopes: ['planner.read'], purpose: 'Suggest next steps' }, T(0), makeId);
  const drafted = createPlanDraft(shared.data, {
    capability: 'ikaw', title: 'Weekend', items: [{ action: 'create', target: { type: 'task' }, fields: { title: 'Rest' } }],
  }, T(1), makeId);
  const itemId = drafted.draft.items[0].id;

  // Device A revokes the grant and approves the item; device B, offline, adds its own grant.
  const deviceA = decidePlanDraftItem(revokeCapabilityGrant(drafted.data, shared.grant.id, T(2), makeId), drafted.draft.id, itemId, 'approved', T(3), makeId);
  const deviceB = grantCapability(drafted.data, { capability: 'bakas', scopes: ['memory.read'], purpose: 'Remember preferences' }, T(4), makeId).data;

  for (const merged of [
    mergeReleaseTwoData(deviceB, deviceA, makeId).data,
    mergeReleaseTwoData(deviceA, deviceB, makeId).data,
    mergeReleaseTwoSnapshots(drafted.data, deviceA, deviceB, makeId),
    mergeReleaseTwoSnapshots(drafted.data, deviceB, deviceA, makeId),
  ]) {
    const grants = Object.fromEntries(merged.capabilityGrants.map((grant) => [grant.capability, grant]));
    assert.equal(grants.ikaw.revokedAt, T(2), 'an older unrevoked copy must not restore access');
    assert.equal(grants.bakas.revokedAt, undefined);
    assert.equal(merged.planDrafts[0].items[0].status, 'approved');
    assert.equal(merged.planDrafts[0].status, 'approved');
    const actions = merged.auditEvents.map((event) => event.action);
    for (const action of ['grant.created', 'draft.created', 'grant.revoked', 'draft.item.approved']) assert.ok(actions.includes(action), action);
    assert.equal(actions.filter((action) => action === 'grant.created').length, 2);
    assert.equal(merged.schemaVersion, UGNAY_SCHEMA_VERSION);
    assert.deepEqual(merged.unknownField, { retained: true });
  }

  // Two devices decide the same item differently: the earlier decision stands.
  const approveLate = decidePlanDraftItem(drafted.data, drafted.draft.id, itemId, 'approved', T(9), makeId);
  const dismissEarly = decidePlanDraftItem(drafted.data, drafted.draft.id, itemId, 'dismissed', T(8), makeId);
  for (const merged of [
    mergeReleaseTwoData(approveLate, dismissEarly, makeId).data,
    mergeReleaseTwoData(dismissEarly, approveLate, makeId).data,
  ]) {
    assert.equal(merged.planDrafts[0].items[0].status, 'dismissed');
    assert.equal(merged.planDrafts[0].status, 'dismissed');
  }
});

test('merges of snapshots without UGNAY data are unchanged', () => {
  const makeId = ids('n');
  const local = { ...legacy(), notes: [{ id: 'n1', title: 'Local', content: '', tags: [], date: '2026-10-25' }] };
  const remote = legacy();
  const twoWay = mergeReleaseTwoData(remote, local, makeId).data;
  const threeWay = mergeReleaseTwoSnapshots(legacy(), local, remote, makeId);
  for (const merged of [twoWay, threeWay]) {
    for (const key of ['capabilityGrants', 'planDrafts', 'auditEvents', 'schemaVersion']) assert.equal(key in merged, false, key);
    assert.deepEqual(merged.notes.map((note) => note.id), ['n1']);
  }
});
