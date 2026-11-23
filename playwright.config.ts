// 브라우저 시나리오 하네스 설정(설계서 S0.4, D16).
//   npm run e2e                          전부(빌드 → vite preview → 시험)
//   npm run e2e -- --grep "E-23"         E-ID 로 고르기
//   E2E_SKIP_BUILD=1 npm run e2e         dist/ 가 이미 있으면 빌드를 건너뜀
//   E2E_UPDATE_BASELINE=1 npm run e2e    기록 모드 시험의 측정값으로 docs/baseline/e2e.json 갱신
//   E2E_CHROME_PATH=/usr/bin/google-chrome npm run e2e   Playwright 의 Chromium 대신 다른 Chrome 사용
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PORT, chromeExecutablePath, fakeMediaArgs } from './e2e/helpers/env';

const previewCommand = `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`;

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // 오디오 컨텍스트·가짜 마이크를 쓰는 시험은 서로 간섭하지 않게 한 번에 하나씩 돌린다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    permissions: ['microphone'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: chromeExecutablePath(),
      args: fakeMediaArgs(),
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? previewCommand : `npm run build && ${previewCommand}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
