import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decryptBackup, inspectBackupFile, BACKUP_FORMAT } from './backup-crypto.ts';

/**
 * The product is now called HANAY, but identifiers that existing data, backups, devices and
 * integrations depend on must not change with it. These tests pin them (founder decision HANAY-005).
 */
const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('a backup file written before the HANAY rename still opens', async () => {
  const file = readFileSync(new URL('./fixtures/backup-v1-before-hanay.buhaybackup', import.meta.url), 'utf8');
  const expected = readFileSync(new URL('./fixtures/backup-v1-before-hanay.plain.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(file).format, 'buhay-os-encrypted-backup');
  assert.doesNotThrow(() => inspectBackupFile(file));
  assert.equal(await decryptBackup(file, 'fixture password for tests only'), expected);
});

test('the backup format name is part of the encryption and keeps its original value', () => {
  assert.equal(BACKUP_FORMAT, 'buhay-os-encrypted-backup');
  const source = read('artifacts/life-planner/src/backup-crypto.ts');
  assert.match(source, /BACKUP_FORMAT\}\|\$\{version\}/, 'the format name is bound into the encrypted header');
});

test('the backup file extension is still accepted on import', () => {
  const app = read('artifacts/life-planner/src/App.tsx');
  assert.match(app, /\.buhaybackup/);
  assert.match(app, /accept="[^"]*\.buhaybackup/);
});

test('browser storage keys keep their names, so saved planners and drafts are not stranded', () => {
  assert.match(read('artifacts/life-planner/src/App.tsx'), /STORAGE_KEY='daybook\.local\.v1'/);
  assert.match(read('artifacts/life-planner/src/calendarDate.ts'), /"buhay-os-calendar-event-draft"/);
  assert.match(read('artifacts/life-planner/src/components/PlannerNav.tsx'), /'buhay\.nav\.collapsed'/);
  const cache = read('artifacts/life-planner/src/planner-cache.ts');
  assert.match(cache, /'daybook\.encrypted-cache\.v1'/);
  assert.match(cache, /`daybook\.account-cache\.v2:/);
});

test('Google Calendar request keys keep their names, so events already created are still recognised', () => {
  assert.match(read('artifacts/api-server/src/routes/calendarEventWrites.ts'), /buhayOsRequestKey=\$\{idempotencyKey\}/);
  assert.match(read('artifacts/life-planner/src/TaskCalendarLink.tsx'), /`buhay-task-/);
  assert.match(read('artifacts/life-planner/src/CalendarPage.tsx'), /`buhay-event-/);
});

test('mobile storage keys, notification marker, URL scheme and package names keep their names', () => {
  assert.match(read('artifacts/buhay-os-mobile/lib/device-alarms-core.ts'), /'buhay\.device-alarms\.v1'/);
  assert.match(read('artifacts/buhay-os-mobile/lib/planner-data.ts'), /buhay\.os\.encrypted-cache\.v1:/);
  assert.match(read('artifacts/buhay-os-mobile/lib/local-task-reminders-core.ts'), /'buhayOsTaskReminder'/);
  const app = JSON.parse(read('artifacts/buhay-os-mobile/app.json'));
  assert.equal(app.expo.slug, 'buhay-os-mobile');
  assert.equal(app.expo.scheme, 'buhay-os-mobile');
  assert.equal(JSON.parse(read('artifacts/buhay-os-mobile/package.json')).name, '@workspace/buhay-os-mobile');
  assert.equal(JSON.parse(read('artifacts/buhay-os-daybook-film/package.json')).name, '@workspace/buhay-os-daybook-film');
});

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.expo', 'fixtures', 'test-results'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(tsx?|mjs|json|html|md|toml)$/.test(name)) yield path;
  }
}

test('the old product name no longer appears in anything a person reads', () => {
  const places = ['artifacts/life-planner', 'artifacts/buhay-os-mobile', 'artifacts/buhay-os-daybook-film', 'artifacts/api-server/src', 'lib', 'README.md', 'replit.md'];
  const offenders = [];
  for (const place of places) {
    const url = new URL(place, root);
    const files = statSync(url).isDirectory() ? [...sources(url.pathname.replace(/^\/([A-Za-z]:)/, '$1'))] : [url.pathname.replace(/^\/([A-Za-z]:)/, '$1')];
    for (const file of files) {
      if (file.endsWith('rebrand-compat.test.mjs')) continue;
      if (/Buhay\.OS|BUHAY\.OS|BUHAY<br\s*\/>\s*\.OS/.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});
