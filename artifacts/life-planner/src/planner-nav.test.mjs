import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const nav = readFileSync(new URL('./components/PlannerNav.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

test('phone navigation has exactly five primary destinations: Today, Planner, Capture, Review, You', () => {
  const bar = nav.slice(nav.indexOf('<nav className="mobile-nav"'));
  assert.match(bar, /entry\('\/', 'Today', Flower2\)/);
  const tabs = [...bar.matchAll(/\{tab\('(\w+)'\)\}/g)].map(([, id]) => id);
  assert.deepEqual(tabs, ['planner', 'capture', 'review', 'you']);
  for (const label of ['Planner', 'Capture', 'Review', 'You']) assert.match(nav, new RegExp("label: '" + label + "'"));
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\);overflow:hidden/);
  assert.doesNotMatch(css, /mobile-nav\{display:flex;overflow-x:auto/);
  // No page may override the five-column phone bar.
  const calendar = readFileSync(new URL('./CalendarPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(calendar, /\.mobile-nav\{grid-template-columns/);
});

test('phone sheets keep every destination reachable and gate Release 2 links', () => {
  const sheets = nav.slice(nav.indexOf('const sheets'), nav.indexOf('return { groups, account, sheets }'));
  for (const path of ['/week', '/calendar', '/projects', '/habits', '/routines', '/templates', '/inbox', '/notes']) {
    assert.ok(sheets.includes(`'${path}'`), `${path} missing from phone sheets`);
  }
  // The You sheet reuses the account entries (Settings, Versions).
  assert.match(sheets, /you: \{[^}]*items: account/);
  assert.match(nav, /const account = \[entry\('\/settings', 'Settings', SettingsIcon\), entry\('\/history', 'Versions', History\)\]/);
  assert.match(sheets, /entry\('\/search', 'Search', Search\)\]\.filter\(on\)/);
  assert.match(sheets, /\[entry\('\/reviews', 'Reviews', BookOpen\), \.\.\.timeline\]\.filter\(on\)/);
  assert.match(sheets, /Reviews and Timeline are not switched on yet\. Your planner data is unchanged\./);
  assert.match(nav, /role="status">\{open\.emptyNote\}/);
});

test('optional release-two links are filtered by enabled routes', () => {
  assert.match(nav, /\.filter\(on\)/);
  assert.match(app, /enabledNavHrefs = new Set<string>\(visibleNavItems/);
});

test('desktop groups are collapsible and accessible, and safe areas are respected', () => {
  for (const g of ['Daily planning', 'Organize', 'Habits & routines', 'Life planning']) assert.ok(nav.includes(g));
  assert.match(nav, /aria-expanded=\{open\}/);
  assert.match(nav, /aria-current=\{active \? 'page'/);
  assert.match(nav, /e\.key === 'Escape'/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height:48px/);
});
