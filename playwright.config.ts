import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: process.platform === 'win32' ? 'chrome' : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
  },
  projects: [
    { name: 'phone-375', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: 'phone-430', use: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true } },
    { name: 'phone-landscape', use: { viewport: { width: 812, height: 375 }, isMobile: true, hasTouch: true } },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
    { name: 'tablet-1024', use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 }, contextOptions: { reducedMotion: 'reduce' } } },
  ],
  webServer: {
    command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run dev -- --port 4173 --strictPort --configLoader native`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
