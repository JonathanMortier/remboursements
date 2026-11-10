import { defineConfig, devices } from '@playwright/test';

// Tests E2E : l'appli (Vite) contre le faux backend local, dans un Chromium au format téléphone.
const APP = 'http://localhost:5180';
export const MOCK = 'http://localhost:8790';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false, // un seul faux backend partagé
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: APP,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'node scripts/mock-server.mjs',
      env: { PORT: '8790' },
      url: MOCK,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx vite --port 5180 --strictPort',
      url: APP,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
