// 시험마다 가짜 마이크 WAV 를 바꿔 끼울 수 있는 Playwright 픽스처.
// `--use-file-for-fake-audio-capture` 는 브라우저를 띄울 때만 정할 수 있어서 WAV 마다 브라우저를 새로 띄운다.
import { chromium, test as base, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';
import { BASE_URL, DEFAULT_MIC_WAV, chromeExecutablePath, fakeMediaArgs } from './env';

export interface MicSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

interface Fixtures {
  /** 지정한 WAV 가 마이크로 들어오는 새 브라우저·컨텍스트·페이지를 만든다. 시험이 끝나면 자동으로 닫힌다. */
  launchWithMic: (wavName?: string, contextOptions?: BrowserContextOptions) => Promise<MicSession>;
}

export const test = base.extend<Fixtures>({
  // Playwright 가 픽스처 값을 넘겨받는 두 번째 인자 이름은 자유롭다. 관례인 `use` 는 eslint-plugin-react-hooks 가
  // React 훅 호출로 오해하므로(rules-of-hooks) `provide` 로 쓴다.
  launchWithMic: async ({ playwright: _playwright }, provide) => {
    const browsers: Browser[] = [];
    await provide(async (wavName = DEFAULT_MIC_WAV, contextOptions = {}) => {
      const browser = await chromium.launch({ executablePath: chromeExecutablePath(), args: fakeMediaArgs(wavName) });
      browsers.push(browser);
      const context = await browser.newContext({ baseURL: BASE_URL, permissions: ['microphone'], ...contextOptions });
      const page = await context.newPage();
      return { browser, context, page };
    });
    await Promise.all(browsers.map((browser) => browser.close()));
  },
});

export { expect } from '@playwright/test';
