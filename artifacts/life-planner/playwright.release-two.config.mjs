import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const packageDir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.RELEASE_TWO_E2E_PORT ?? 8197);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('RELEASE_TWO_E2E_PORT must be a valid unprivileged TCP port.');
}
const baseURL = `http://127.0.0.1:${port}`;
const systemChromium = '/repl/tools/bin/chromium';

export default defineConfig({
  testDir: resolve(packageDir, 'tests/e2e'),
  testMatch: '**/release-two.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
    command: `PORT=${port} BASE_PATH=/ pnpm exec vite --config vite.config.ts --host 127.0.0.1 --port ${port}`,
    cwd: packageDir,
    url: baseURL,
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
