import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const nav = readFileSync(new URL('./components/PlannerNav.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

test('phone navigation has exactly five primary destinations', () => {
  const bar = nav.slice(nav.indexOf('<nav className="mobile-nav"'));
  for (const label of ['Today', 'Plan', 'Inbox', 'Notes', 'More']) assert.match(bar, new RegExp("'" + label + "'"));
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\);overflow:hidden/);
  assert.doesNotMatch(css, /mobile-nav\{display:flex;overflow-x:auto/);
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
