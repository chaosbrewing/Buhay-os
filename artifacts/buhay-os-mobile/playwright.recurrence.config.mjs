import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const packageDir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.RECURRENCE_E2E_PORT ?? 8098);
const baseURL = `http://127.0.0.1:${port}`;
const systemChromium = '/repl/tools/bin/chromium';

export default defineConfig({
  testDir: resolve(packageDir, 'tests/e2e'),
  testMatch: '**/recurrence.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || existsSync(systemChromium)
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? systemChromium }
      : undefined,
  },
  webServer: {
    command: `CI=1 EXPO_PUBLIC_RECURRENCE_E2E=1 EXPO_PUBLIC_DOMAIN=http://127.0.0.1:${port} pnpm exec expo start --web --localhost --port ${port}`,
    cwd: packageDir,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
