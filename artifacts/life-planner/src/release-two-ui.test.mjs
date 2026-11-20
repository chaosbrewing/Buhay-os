import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./pages/ReleaseTwoPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

test('Release 2 dialogs and controls remain keyboard and screen-reader accessible', () => {
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /event\.key === 'Escape'/);
  assert.match(page, /aria-label="Filter timeline records"/);
  assert.match(page, /aria-label="Filter search by record type"/);
  assert.match(page, /aria-label="Search planner records"/);
  assert.match(page, /aria-label="Previous week"/);
});

test('Timeline calendar results stay transient and are gated by authorization and connectivity', () => {
  assert.match(page, /enabled: connected && isOnline/);
  assert.match(page, /const entries = useMemo\(\(\) => buildPlannerTimeline/);
  assert.match(page, /eventsQuery\.data \?\? \[\]/);
  assert.match(page, /entry\.source === 'planner'/);
  assert.match(page, /Events are temporary here and are not copied into your planner/);
});

test('unified search remains local to the unlocked snapshot and opens scoped record references', () => {
  assert.match(page, /searchPlannerRecords\(data, query, filter\)/);
  assert.match(page, /onClick=\{\(\) => onOpenRecord\(result\.ref\)\}/);
  assert.match(app, /if\(!isSignedIn\)return <Redirect to="\/"\/>;return <PlannerApp key=\{userId\}\/>/);
  assert.match(app, /recordExists\(data,ref\)/);
  assert.match(app, /client\.clear\(\);localStorage\.removeItem\(STORAGE_KEY\)/);
});

test('Release 2 flags hide navigation and direct routes preserve saved data when disabled', () => {
  assert.match(app, /releaseTwoNavItems\.filter\(\(\[, , , flag\]\) => releaseTwoFlags\[flag\]\)/);
  assert.match(page, /if \(!enabled\) return <main className="r2-page" role="status">/);
  assert.match(page, /Your planner data remains unchanged\./);
});

test('Release 2 page fails closed when no feature flags are passed', () => {
  assert.match(page, /const flags = props\.featureFlags \?\? RELEASE_TWO_FLAGS_OFF;/);
  assert.match(page, /createContext<Record<ReleaseTwoFeature, boolean>>\(RELEASE_TWO_FLAGS_OFF\)/);
  assert.doesNotMatch(page, /\?\? RELEASE_TWO_FEATURE_FLAGS/);
  const offFlags = /const RELEASE_TWO_FLAGS_OFF[^=]*= \{([^}]*)\}/.exec(page)?.[1] ?? '';
  const values = [...offFlags.matchAll(/(\w+): (true|false)/g)];
  assert.equal(values.length, 6);
  assert.ok(values.every(([, , value]) => value === 'false'));
});
