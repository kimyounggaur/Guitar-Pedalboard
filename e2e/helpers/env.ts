// 브라우저 시나리오 하네스의 환경 상수. playwright.config.ts 와 도우미가 같이 쓴다.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 4173;
/** vite.config.ts 의 base(GitHub Pages 용). `vite preview` 도 이 경로 아래에서 서비스한다. */
export const BASE_PATH = '/Guitar-Pedalboard/';
export const BASE_URL = `http://127.0.0.1:${PORT}${BASE_PATH}`;

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixturesDir = join(repoRoot, 'e2e', 'fixtures');
/** 가짜 마이크 기본 신호. 아무것도 지정하지 않은 테스트는 이 파일이 입력으로 들어온다. */
export const DEFAULT_MIC_WAV = 'ref-pc.wav';

/**
 * 기본은 Playwright 가 받은 Chromium 을 쓴다. 다른 Chrome 을 쓰려면 E2E_CHROME_PATH 를 지정한다.
 * (CHROME_PATH 는 다른 시험(responsive-a11y·프로브)용이라 일부러 겹치지 않게 했다.)
 */
export function chromeExecutablePath(): string | undefined {
  return process.env.E2E_CHROME_PATH || undefined;
}

export function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

/**
 * 가짜 마이크 실행 인자. `--use-file-for-fake-audio-capture` 의 WAV 는 끝나면 처음부터 되풀이된다.
 * 브라우저를 띄울 때만 정할 수 있으므로 WAV 를 바꾸려면 launchWithMic 으로 브라우저를 새로 띄운다.
 */
export function fakeMediaArgs(wavName: string = DEFAULT_MIC_WAV): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${fixturePath(wavName)}`,
    // 사용자 제스처 없이도 오디오 컨텍스트를 시작할 수 있게 하지는 않는다(앱의 시작 규칙을 그대로 시험한다).
  ];
}
