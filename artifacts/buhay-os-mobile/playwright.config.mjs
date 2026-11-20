import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const packageDir = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(packageDir, '.env.e2e');

try {
  const contents = readFileSync(envFile, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const required = [
  'E2E_API_BASE_URL',
  'E2E_CLERK_PUBLISHABLE_KEY',
  'E2E_USER_EMAIL',
  'E2E_USER_PASSWORD',
  'E2E_SECOND_USER_EMAIL',
  'E2E_SECOND_USER_PASSWORD',
  'E2E_PLANNER_PASSPHRASE',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(
    `Mobile sync E2E is not configured. Set these values in .env.e2e: ${missing.join(', ')}`,
  );
}

const apiUrl = new URL(process.env.E2E_API_BASE_URL);
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const isLocal = localHosts.has(apiUrl.hostname);
const isTestHost =
  apiUrl.hostname.endsWith('.test') ||
  apiUrl.hostname.endsWith('.localhost') ||
  apiUrl.hostname.endsWith('.replit.dev');
if (
  apiUrl.pathname !== '/' ||
  apiUrl.search ||
  apiUrl.hash ||
  !['http:', 'https:'].includes(apiUrl.protocol) ||
  (!isLocal && (apiUrl.protocol !== 'https:' || !isTestHost))
) {
  throw new Error(
    'E2E_API_BASE_URL must be an origin on localhost, .test, .localhost, or HTTPS .replit.dev. Production hosts are not allowed.',
  );
}
if (!process.env.E2E_CLERK_PUBLISHABLE_KEY.startsWith('pk_test_')) {
  throw new Error('E2E_CLERK_PUBLISHABLE_KEY must be a Clerk test-instance publishable key.');
}
if (process.env.E2E_USER_EMAIL === process.env.E2E_SECOND_USER_EMAIL) {
  throw new Error('Configure two different dedicated test account email addresses.');
}
if (process.env.E2E_PLANNER_PASSPHRASE.length < 10) {
  throw new Error('E2E_PLANNER_PASSPHRASE must be at least 10 characters.');
}

const port = Number(process.env.E2E_EXPO_PORT ?? 8099);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('E2E_EXPO_PORT must be a valid unprivileged TCP port.');
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: resolve(packageDir, 'tests/e2e'),
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `CI=1 pnpm exec expo start --web --localhost --port ${port}`,
    cwd: packageDir,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      CI: '1',
      EXPO_PUBLIC_DOMAIN: apiUrl.origin,
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.E2E_CLERK_PUBLISHABLE_KEY,
    },
  },
});
