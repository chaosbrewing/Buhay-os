import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const packageDir = dirname(fileURLToPath(import.meta.url));
const mobileE2EEnv = resolve(packageDir, '../buhay-os-mobile/.env.e2e');

try {
  const contents = readFileSync(mobileE2EEnv, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const required = ['E2E_CLERK_PUBLISHABLE_KEY', 'E2E_USER_EMAIL', 'E2E_USER_PASSWORD', 'E2E_PLANNER_PASSPHRASE'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Web habit E2E is not configured. Set these values in buhay-os-mobile/.env.e2e: ${missing.join(', ')}`);
}
if (!process.env.E2E_CLERK_PUBLISHABLE_KEY.startsWith('pk_test_')) {
  throw new Error('E2E_CLERK_PUBLISHABLE_KEY must be a Clerk test-instance publishable key.');
}
if (process.env.E2E_PLANNER_PASSPHRASE.length < 10) {
  throw new Error('E2E_PLANNER_PASSPHRASE must be at least 10 characters.');
}

const port = Number(process.env.HABITS_E2E_PORT ?? 8196);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('HABITS_E2E_PORT must be a valid unprivileged TCP port.');
}
const baseURL = `http://127.0.0.1:${port}`;
const systemChromium = '/repl/tools/bin/chromium';

export default defineConfig({
  testDir: resolve(packageDir, 'tests/e2e'),
  testMatch: '**/habits.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || existsSync(systemChromium)
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? systemChromium }
      : undefined,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY=${process.env.E2E_CLERK_PUBLISHABLE_KEY} pnpm exec vite --config vite.config.ts --host 127.0.0.1 --port ${port}`,
    cwd: packageDir,
    url: baseURL,
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
