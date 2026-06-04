import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;
const isDebug = !!process.env.DEBUG_E2E;

export default defineConfig({
  testDir: './e2e',
  timeout: isDebug ? 120_000 : 30_000,
  retries: isCI ? 2 : isDebug ? 0 : 1,
  workers: isDebug ? 1 : undefined,
  use: {
    baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    headless: isDebug ? false : true,
    screenshot: isDebug ? 'on' : 'only-on-failure',
    trace: 'on',
    launchOptions: {
      slowMo: isDebug ? 800 : 0,
    },
    video: isDebug ? 'on' : 'off',
  },
  webServer: {
    command: isCI ? 'npx serve dist -s -l 4173' : 'npm run dev',
    port: isCI ? 4173 : 5173,
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
