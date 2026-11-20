import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  MAX_MEMORY_LENGTH,
  correctMemory,
  createMemory,
  deleteMemory,
  keepMemoryAfterRevocation,
  listMemories,
  retrieveMemories,
  revokeMemorySource,
} from '@workspace/planner-contract/bakas';
import { grantCapability } from '@workspace/planner-contract/ugnay';
import {
  CREATABLE_KINDS,
  describeSource,
  earlierWordings,
  kindLabel,
  needsSourceDecision,
  prefillFromRecord,
  sourceForRecord,
  verificationLabel,
} from './memories.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('./App.tsx');
const hook = read('./useMemories.ts');
const helpers = read('./memories.ts');
const dialog = read('./components/MemoryDialog.tsx');
const page = read('./pages/MemoryPage.tsx');
const modal = read('./components/useModalBehavior.ts');
const inboxPage = read('./pages/ReleaseOnePage.tsx');
const nav = read('./components/PlannerNav.tsx');
const replitConfig = readFileSync(new URL('../../../.replit', import.meta.url), 'utf8');

const T = '2026-10-26T10:00:00.000Z';
const ids = () => { let n = 0; return () => `id-${++n}`; };
const empty = () => ({ tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3b765e' } });

test('labels keep a guess visibly different from something the user confirmed', () => {
  assert.deepEqual(['fact', 'preference', 'interpretation'].map(kindLabel), ['Fact', 'Preference', 'Interpretation']);
  assert.equal(verificationLabel('user-confirmed'), 'You confirmed this');
  assert.equal(verificationLabel('source-verified'), 'Verified from its source');
  assert.match(verificationLabel('ai-interpretation'), /guess, not confirmed/);
  assert.equal(new Set(['user-confirmed', 'source-verified', 'ai-interpretation'].map(verificationLabel)).size, 3);
});

test('a person can only create facts and preferences, never an interpretation', () => {
  assert.deepEqual([...CREATABLE_KINDS], ['fact', 'preference']);
});

test('sources are described in plain words, naming the record only while it still exists', () => {
  const titles = { 'note:n1': 'Landlord', 'inbox:in1': 'Dentist moved' };
  const titleOf = (ref) => titles[`${ref.type}:${ref.id}`];
  assert.equal(describeSource({ type: 'manual' }, titleOf), 'Added by you');
  assert.equal(describeSource({ type: 'connected', app: 'Google Calendar', capturedAt: T }, titleOf), 'From Google Calendar');
  assert.equal(describeSource(sourceForRecord('note', 'n1', T), titleOf), 'From your note: “Landlord”');
  assert.equal(describeSource(sourceForRecord('inbox', 'in1', T), titleOf), 'From your Inbox thought: “Dentist moved”');
  assert.equal(describeSource(sourceForRecord('note', 'gone', T), titleOf), 'From a note that is no longer in your planner');
  assert.equal(describeSource({ type: 'planner', ref: { type: 'goal', id: 'g' }, capturedAt: T }, () => undefined), 'From a goal that is no longer in your planner');
});

test('"Remember this" offers the body if there is one, the title otherwise, and never more than fits', () => {
  assert.equal(prefillFromRecord({ title: 'Landlord', content: '  Mr Reyes prefers email  ' }), 'Mr Reyes prefers email');
  assert.equal(prefillFromRecord({ title: ' Packing list ', content: '' }), 'Packing list');
  assert.equal(prefillFromRecord({ title: 'Packing list', content: '   ' }), 'Packing list');
  assert.equal(prefillFromRecord({ title: 'Packing list' }), 'Packing list');
  const long = prefillFromRecord({ title: 'x', content: 'a'.repeat(MAX_MEMORY_LENGTH + 500) });
  assert.equal(long.length, MAX_MEMORY_LENGTH);
  assert.ok(long.endsWith('…'));
  const exact = prefillFromRecord({ title: 'x', content: 'b'.repeat(MAX_MEMORY_LENGTH) });
  assert.equal(exact.length, MAX_MEMORY_LENGTH);
  assert.equal(exact.endsWith('…'), false);
});

test('what the screens save is accepted by the memory rules and behaves as the screens promise', () => {
  const makeId = ids();
  let data = empty();
  const note = createMemory(data, {
    text: prefillFromRecord({ title: 'Landlord', content: 'Mr Reyes prefers email' }),
    kind: 'preference', verification: 'user-confirmed', source: sourceForRecord('note', 'n1', T), sensitivity: 'normal',
  }, T, makeId);
  const typed = createMemory(note.data, {
    text: 'The boiler is serviced every March', kind: 'fact', verification: 'user-confirmed', source: { type: 'manual' }, sensitivity: 'private',
  }, T, makeId);
  data = typed.data;
  assert.deepEqual(listMemories(data).map((memory) => memory.sensitivity).sort(), ['normal', 'private']);
  assert.ok(listMemories(data).every((memory) => memory.verification === 'user-confirmed'));

  // Correct, privacy toggle (both ways) and delete are exactly the contract's.
  data = correctMemory(data, note.memory.id, { text: 'Mr Reyes prefers email, not calls', kind: 'preference', sensitivity: 'normal' }, '2026-10-26T11:00:00.000Z', makeId);
  assert.equal(listMemories(data).find((memory) => memory.id === note.memory.id).revisions.length, 1);
  data = correctMemory(data, note.memory.id, { sensitivity: 'private' }, '2026-10-26T12:00:00.000Z', makeId);
  data = correctMemory(data, note.memory.id, { sensitivity: 'normal' }, '2026-10-26T13:00:00.000Z', makeId);
  data = deleteMemory(data, typed.memory.id, '2026-10-26T14:00:00.000Z', makeId);
  assert.equal(JSON.stringify(data).includes('boiler'), false);
  assert.deepEqual(listMemories(data).map((memory) => memory.id), [note.memory.id]);
});

test('earlier versions list each different earlier wording once, never repeating the current text', () => {
  const makeId = ids();
  let data = createMemory(empty(), { text: 'Lease ends in January', kind: 'fact', verification: 'user-confirmed', source: { type: 'manual' } }, T, makeId).data;
  const id = listMemories(data)[0].id;
  data = correctMemory(data, id, { text: 'Lease ends 31 January' }, '2026-10-26T11:00:00.000Z', makeId);
  data = correctMemory(data, id, { sensitivity: 'private' }, '2026-10-26T12:00:00.000Z', makeId); // saves a version with today's wording
  data = correctMemory(data, id, { sensitivity: 'normal' }, '2026-10-26T13:00:00.000Z', makeId);
  const [memory] = listMemories(data);
  assert.equal(memory.revisions.length, 3, 'the contract keeps a version for every change');
  assert.deepEqual(earlierWordings(memory).map((revision) => revision.text), ['Lease ends in January']);
  // Going back to an older wording hides it as an "earlier" one, and shows what it replaced.
  data = correctMemory(data, id, { text: 'Lease ends in January' }, '2026-10-26T14:00:00.000Z', makeId);
  assert.deepEqual(earlierWordings(listMemories(data)[0]).map((revision) => revision.text), ['Lease ends 31 January']);
  assert.deepEqual(earlierWordings({ ...memory, revisions: undefined }), []);
});

test('the keep-or-delete choice appears only for a disconnected source and is settled by keeping', () => {
  const makeId = ids();
  const saved = createMemory(empty(), {
    text: 'Gym class on Wednesday', kind: 'fact', verification: 'source-verified',
    source: { type: 'connected', app: 'Google Calendar', capturedAt: T },
  }, T, makeId);
  const [before] = listMemories(saved.data);
  assert.equal(needsSourceDecision(before), false);
  const revoked = revokeMemorySource(saved.data, { app: 'Google Calendar' }, '2026-10-26T11:00:00.000Z', makeId);
  const [undecided] = listMemories(revoked);
  assert.equal(needsSourceDecision(undecided), true);
  const kept = keepMemoryAfterRevocation(revoked, undecided.id, '2026-10-26T12:00:00.000Z', makeId);
  const [decided] = listMemories(kept);
  assert.equal(needsSourceDecision(decided), false);
  assert.equal(decided.verification, 'user-confirmed');
  assert.equal(decided.source.app, 'Google Calendar');
});

test('what the Memory page shows the owner is never what another capability is given', () => {
  const makeId = ids();
  let data = grantCapability(empty(), { capability: 'ikaw', scopes: ['memory.read'], purpose: 'Help me plan' }, T, makeId).data;
  data = createMemory(data, { text: 'Flights to Cebu are cheaper on Tuesdays', kind: 'fact', verification: 'user-confirmed', source: { type: 'manual' } }, T, makeId).data;
  data = createMemory(data, { text: 'Flights with my sister stay private', kind: 'fact', verification: 'user-confirmed', source: { type: 'manual' }, sensitivity: 'private' }, T, makeId).data;
  assert.equal(listMemories(data).length, 2, 'the owner sees both');
  assert.deepEqual(retrieveMemories(data, { capability: 'ikaw', query: 'flights' }).memories.map((memory) => memory.text), ['Flights to Cebu are cheaper on Tuesdays']);
});

// ---------------------------------------------------------------- the switch

test('Memory is off unless the flag is exactly "true", in the app and in the shared environment', () => {
  assert.match(app, /const memoriesEnabled = buildEnv\.VITE_BAKAS_MEMORIES === 'true';/);
  assert.match(app, /useMemories\(\{enabled:memoriesEnabled,/);
  assert.match(replitConfig, /^VITE_BAKAS_MEMORIES = "false"\s*$/m);
});

test('with the flag off the page, nav link, route and every "Remember this" control are absent', () => {
  assert.match(app, /\.\.\.\(memoriesEnabled \? \[\[plannerPath\('\/memory'\), 'Memory', Brain\] as const\] : \[\]\)/);
  assert.match(app, /\{memoriesEnabled&&<Route path=\{plannerPath\('\/memory'\)\}><MemoryPage /);
  assert.equal(app.split('onRemember={memories.enabled?').length - 1, 2, 'both note lists');
  assert.match(app, /memory=\{memoriesEnabled\?\{onRemember:memories\.rememberInbox\}:undefined\}/);
  assert.match(app, /\{onRemember&&<button className="micro-btn" aria-label="Remember this"/);
  assert.match(inboxPage, /\{memory && <button type="button" onClick=\{\(\) => memory\.onRemember\(item\)\}/);
  assert.match(nav, /\.\.\.\[entry\('\/memory', 'Memory', Brain\)\]\.filter\(on\)/);
  assert.match(app, /\{memories\.dialog&&<MemoryDialog /);
});

test('with the flag off the hook shows nothing and changes nothing', () => {
  assert.match(hook, /if \(!enabled\) return \{ list: \[\], problem: null \};/);
  assert.match(hook, /const run = [^]*?if \(!enabled\) return null;/);
  for (const handler of ['startNew', 'startEdit', 'rememberNote', 'rememberInbox']) {
    assert.match(hook, new RegExp(`${handler}: [^\\n]*(\\n[^\\n]*)?if \\(enabled\\)|${handler}: [^]*?if \\(!enabled\\) return;`), handler);
  }
  assert.match(hook, /submit: \(values: MemoryValues\): string \| null => \{\s*if \(!enabled \|\| !dialog\) return null;/);
});

// ------------------------------------------------------------------- scope

test('the screens use only the user-facing memory rules: no AI, no network, no capability access, no grants', () => {
  const allowed = new Set(['correctMemory', 'createMemory', 'deleteMemory', 'keepMemoryAfterRevocation', 'listMemories', 'MAX_MEMORY_LENGTH']);
  for (const [name, source] of Object.entries({ helpers, hook, dialog, page })) {
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@workspace\/planner-contract\/bakas'/g)) {
      const values = match[1].split(',').map((part) => part.trim()).filter(Boolean).filter((part) => !part.startsWith('type '));
      for (const value of values) assert.ok(allowed.has(value), `${name} imports ${value}`);
    }
    assert.doesNotMatch(source, /planner-contract\/ugnay/, `${name} must not touch grants or drafts`);
    assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|useMutation|useQuery|\/api\//, `${name} must make no network calls`);
    assert.doesNotMatch(source, /retrieveMemories|recordMemoryAccess|revokeMemorySource/, `${name} must not use capability access`);
  }
});

test('every memory the screens create is confirmed by the user, never an AI guess', () => {
  assert.match(hook, /verification: 'user-confirmed',/);
  assert.equal(hook.split("verification:").length - 1, 1);
  assert.doesNotMatch(hook + dialog + page + helpers, /verification: 'ai-interpretation'|verification: 'source-verified'/);
  assert.match(dialog, /CREATABLE_KINDS/);
});

test('dialogs are accessible: modal semantics, Escape, Tab kept inside, focus restored, errors announced', () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby="mem-dialog-title"/);
  assert.match(dialog, /role="alert"/);
  assert.match(page, /role="alertdialog"/);
  assert.match(page, /aria-describedby="mem-confirm-body"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /return \(\) => opener\?\.focus\?\.\(\)/);
  assert.match(page, /aria-pressed=\{isPrivate\}/);
  assert.match(page, /aria-label="This memory's source was disconnected"/);
});

test('deleting always asks first, and an unreadable memory list is reported without echoing it', () => {
  assert.match(page, /onClick=\{\(\) => setConfirming\(memory\)\} data-testid=\{`button-delete-memory-/);
  assert.match(page, /onClick=\{\(\) => setConfirming\(memory\)\} data-testid=\{`button-decide-delete-memory-/);
  assert.equal(page.split('onDelete(').length - 1, 1, 'the only delete call is the confirmed one');
  assert.match(hook, /catch \{ return \{ list: \[\], problem: UNREADABLE \}; \}/);
  assert.match(hook, /const UNREADABLE = "Your saved memories couldn't be read, so none are shown\. Nothing has been changed\.";/);
});
