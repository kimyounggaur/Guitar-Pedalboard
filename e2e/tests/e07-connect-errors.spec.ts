// E-07 오류 안내(설계서 S2.3, 4.13절, 보고서 R2-7; 이후 모든 Phase 에서 유지하는 정식 시험).
//   · `getUserMedia` 를 오류 7종으로 거부시키면 4.13 표의 한국어 문구가 보이고(role="alert"), 영어 원문은 화면 어디에도 없다.
//   · 오디오 워클릿 로드 실패(`audioWorklet.addModule` 거부)와 비보안 출처는 '장치 시작 실패'와 다른 문구다.
//   · 골라 둔 입력 장치가 없으면(OverconstrainedError) 기본 장치로 다시 연결하고 안내한다. 다음 연결에서는 되풀이하지 않는다.
//   · 안내는 '화면 안에' 보인다(스크롤 밖에 남지 않는다): 데스크톱 기본 크기와, 휴대폰 3종(390×844·360×640·412×915)의 입력 탭에서.
//     실패 안내가 패널 맨 아래에 있어 휴대폰에서는 잘려 보이지 않던 결함(REFACTOR_LOG L-93)이 되살아나면 이 시험이 실패한다.
// 문구는 설계서 4.13 표의 글자 그대로를 이 파일에 따로 적었다(앱의 카탈로그 src/i18n/ko.ts 를 가져다 쓰지 않는다 —
// 카탈로그가 실수로 바뀌면 이 시험이 알아채야 하기 때문이다). 카탈로그와 설계서 문서의 일치는 `npm run test:connect-errors` 가 본다.
import type { Page } from '@playwright/test';
import { connectButton, disconnectButton, openApp, setMobileDock } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { GET_USER_MEDIA_ERRORS, mockGetUserMediaError, readAudioTracking, trackAudioContexts, type GetUserMediaErrorName } from '../helpers/mocks';
import { PHONE_PROFILES } from '../helpers/screens';

const TEXT = {
  notAllowed: '마이크 권한이 차단되어 있습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용한 뒤 다시 연결해 주세요.',
  notFound: '입력 장치를 찾을 수 없습니다. 오디오 인터페이스나 마이크가 연결되어 있는지 확인해 주세요.',
  notReadable: '입력 장치를 열 수 없습니다. 장치를 쓰는 다른 프로그램을 닫고 다시 시도해 주세요.',
  fellBack: '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다.',
  security: '이 주소에서는 마이크를 쓸 수 없습니다. https 주소로 접속해 주세요.',
  abort: '장치를 시작하지 못했습니다. 장치를 다시 꽂고 시도해 주세요.',
  workletLoad: '오디오 엔진을 시작하지 못했습니다. 브라우저를 최신 버전으로 업데이트해 주세요.',
  other: (name: string) => `연결하지 못했습니다(오류: ${name}). 페이지를 새로 고친 뒤 다시 시도해 주세요.`,
};

/** 모의 오류(e2e/helpers/mocks.ts)가 던지는 영어 원문과 브라우저 기본 문구. 화면 어디에도 나오면 안 된다. */
const ENGLISH_RAW = [
  'Permission denied',
  'Requested device not found',
  'Could not start audio source',
  'The constraints could not be satisfied',
  'getUserMedia is not allowed in this context',
  'Starting audio source failed',
  'Failed to execute getUserMedia',
  "Unable to load a worklet's module",
];

/**
 * 장치를 고르지 않고(기본 장치) 연결했을 때 보여야 하는 문구. OverconstrainedError 는 기본 장치로 다시 시도할 것이 없는 경우라
 * '조건에 맞는 입력이 없다'는 뜻이므로 입력 장치 없음 문구다(표에는 이 경우가 없어 REFACTOR_LOG L-92 에서 정했다).
 */
const EXPECTED: Record<GetUserMediaErrorName, string> = {
  NotAllowedError: TEXT.notAllowed,
  NotFoundError: TEXT.notFound,
  NotReadableError: TEXT.notReadable,
  OverconstrainedError: TEXT.notFound,
  SecurityError: TEXT.security,
  AbortError: TEXT.abort,
  TypeError: TEXT.other('TypeError'),
};

const errorMessage = (page: Page) => page.locator('.error-message[role="alert"]');

/** 닫히지 않은 AudioContext 수(앱이 만든 실시간 컨텍스트만 센다). 실패한 시도가 컨텍스트를 남기면 0 이나 1 보다 커진다. */
const openContexts = async (page: Page): Promise<number> => (await readAudioTracking(page)).contexts.filter((context) => context.state !== 'closed').length;

/** 화면의 글자 전체에서 영어 원문과 오류 이름(표의 '그 밖' 행이 일부러 적는 TypeError 는 제외)을 찾는다. */
async function expectNoEnglishRaw(page: Page, allowedName?: string): Promise<void> {
  const text = await page.locator('body').innerText();
  for (const raw of ENGLISH_RAW) expect(text, `화면에 영어 원문이 있으면 안 됩니다: ${raw}`).not.toContain(raw);
  for (const name of [...GET_USER_MEDIA_ERRORS, 'WorkletLoadError']) {
    if (name === allowedName) continue;
    expect(text, `화면에 오류 이름이 있으면 안 됩니다: ${name}`).not.toContain(name);
  }
}

test.describe('E-07 오류 안내', () => {
  for (const name of GET_USER_MEDIA_ERRORS) {
    test(`E-07 getUserMedia ${name}: 4.13 의 문구가 보이고 영어 원문은 없다`, async ({ page }) => {
      await mockGetUserMediaError(page, name);
      await openApp(page);
      await connectButton(page).click();
      await expect(errorMessage(page)).toHaveText(EXPECTED[name]);
      await expect(errorMessage(page)).toBeInViewport({ ratio: 1 });
      // 실패하면 '연결 안 됨' 으로 돌아와 다시 누를 수 있다.
      await expect(connectButton(page)).toBeEnabled();
      await expect(disconnectButton(page)).toHaveCount(0);
      await expectNoEnglishRaw(page, name === 'TypeError' ? 'TypeError' : undefined);
    });
  }

  test('E-07 오디오 워클릿을 불러오지 못하면 장치 시작 실패와 다른 문구가 나온다', async ({ page }) => {
    await page.addInitScript(() => {
      // 브라우저는 모듈 로드 실패를 AbortError 로 알린다(장치 시작 실패와 같은 이름).
      Object.defineProperty(AudioWorklet.prototype, 'addModule', {
        configurable: true,
        value: () => Promise.reject(new DOMException("Unable to load a worklet's module.", 'AbortError')),
      });
    });
    await openApp(page);
    await connectButton(page).click();
    await expect(errorMessage(page)).toHaveText(TEXT.workletLoad);
    await expect(errorMessage(page)).not.toHaveText(TEXT.abort);
    await expectNoEnglishRaw(page);
  });

  test('E-07 보안 출처가 아니라서 마이크 장치가 없으면 주소 탓으로 안내한다', async ({ page }) => {
    await page.addInitScript(() => {
      // http 주소에서는 브라우저가 navigator.mediaDevices 를 주지 않고 isSecureContext 는 false 다.
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    });
    await openApp(page);
    await connectButton(page).click();
    await expect(errorMessage(page)).toHaveText(TEXT.security);
    await expectNoEnglishRaw(page);
  });

  test('E-07 다시 연결하면 이전 오류 문구는 사라진다', async ({ page }) => {
    await page.addInitScript(() => {
      // 첫 요청만 거부하고 그 뒤는 진짜 가짜 마이크로 넘긴다.
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let calls = 0;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: (constraints?: MediaStreamConstraints) => {
          calls += 1;
          if (calls === 1) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
          return original(constraints);
        },
      });
    });
    await openApp(page);
    await connectButton(page).click();
    await expect(errorMessage(page)).toHaveText(TEXT.notAllowed);
    await connectButton(page).click();
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    await expect(errorMessage(page)).toHaveCount(0);
  });

  test.describe('골라 둔 입력 장치가 없을 때', () => {
    /** 장치 목록에서 하나를 골라 둔다(가짜 마이크의 장치 ID). 고를 수 있는 장치가 없으면 시험 환경이 달라진 것이다. */
    async function chooseSomeDevice(page: Page): Promise<string> {
      await expect.poll(async () => page.locator('#audio-device option:not([value=""])').count(), { message: '가짜 마이크 장치가 목록에 보여야 합니다' }).toBeGreaterThan(0);
      const deviceId = await page.locator('#audio-device option:not([value=""])').first().getAttribute('value');
      expect(deviceId).toBeTruthy();
      await page.selectOption('#audio-device', deviceId ?? '');
      return deviceId ?? '';
    }

    /** 장치 ID 를 지정한 요청(`exact`)만 `exactError` 로 거부하고, 장치를 지정하지 않은 요청은 `defaultError`(없으면 진짜 가짜 마이크)로 처리한다. */
    async function mockMissingDevice(page: Page, exactError: string, defaultError?: string): Promise<void> {
      await page.addInitScript(
        ({ exactName, defaultName }) => {
          const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          const log: string[] = [];
          (window as unknown as { __gumRequests: string[] }).__gumRequests = log;
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            configurable: true,
            value: (constraints?: MediaStreamConstraints) => {
              const audio = constraints?.audio;
              const exact = typeof audio === 'object' && audio !== null && 'deviceId' in audio ? (audio.deviceId as ConstrainDOMStringParameters | undefined)?.exact : undefined;
              log.push(exact ? 'exact' : 'default');
              if (exact) return Promise.reject(new DOMException('Requested device not found', exactName));
              if (defaultName) return Promise.reject(new DOMException('Requested device not found', defaultName));
              return original(constraints);
            },
          });
        },
        { exactName: exactError, defaultName: defaultError },
      );
    }

    const requests = (page: Page) => page.evaluate(() => (window as unknown as { __gumRequests: string[] }).__gumRequests);

    for (const exactError of ['OverconstrainedError', 'NotFoundError']) {
      test(`E-07 ${exactError}: 기본 장치로 연결되고 안내가 뜨며, 다음 연결에서는 되풀이하지 않는다`, async ({ page }) => {
        await trackAudioContexts(page);
        await mockMissingDevice(page, exactError);
        await openApp(page);
        await chooseSomeDevice(page);
        await connectButton(page).click();

        await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
        const notice = page.locator('.toast', { hasText: TEXT.fellBack });
        await expect(notice).toBeVisible();
        await expect(notice).toHaveAttribute('role', 'alert');
        await expect(errorMessage(page)).toHaveCount(0);
        expect(await requests(page), '골라 둔 장치로 먼저, 안 되면 기본 장치로 한 번').toEqual(['exact', 'default']);

        // 실패한 첫 시도가 컨텍스트를 남기지 않는다: 지금 열려 있는 것은 연결된 하나뿐이다.
        await expect.poll(() => openContexts(page), { message: '열려 있는 AudioContext 수' }).toBe(1);
        const tracking = await readAudioTracking(page);
        expect(tracking.inputTracks.length).toBeGreaterThan(0);
        expect(tracking.inputTracks.every((track) => track.readyState === 'live')).toBe(true);

        // 선택이 기본 장치로 돌아와 있어서, 연결을 해제했다가 다시 연결해도 같은 안내가 되풀이되지 않는다.
        // (안내를 직접 닫아 두어야 '새로 뜨지 않았다'를 가를 수 있다. 같은 키의 토스트는 새것이 옛것을 대신하므로 열어 둔 채로는 구별되지 않는다.)
        await notice.getByRole('button', { name: '닫기' }).click();
        await expect(notice).toHaveCount(0);
        await disconnectButton(page).click();
        await expect(connectButton(page)).toBeVisible();
        await expect(page.locator('#audio-device')).toHaveValue('');
        await connectButton(page).click();
        await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.toast', { hasText: TEXT.fellBack })).toHaveCount(0);
        expect(await requests(page)).toEqual(['exact', 'default', 'default']);
      });
    }

    test('E-07 기본 장치로도 연결하지 못하면 입력 장치 없음 문구를 보이고 두 번만 시도한다', async ({ page }) => {
      await trackAudioContexts(page);
      await mockMissingDevice(page, 'OverconstrainedError', 'NotFoundError');
      await openApp(page);
      await chooseSomeDevice(page);
      await connectButton(page).click();
      await expect(errorMessage(page)).toHaveText(TEXT.notFound);
      await expect(page.locator('.toast', { hasText: TEXT.fellBack })).toHaveCount(0);
      expect(await requests(page)).toEqual(['exact', 'default']);
      await expect.poll(() => openContexts(page), { message: '실패한 두 시도가 AudioContext 를 남기지 않는다' }).toBe(0);
      await expectNoEnglishRaw(page);
    });

    test('E-07 장치는 있는데 열 수 없는 오류(NotReadableError)는 기본 장치로 몰래 바꾸지 않는다', async ({ page }) => {
      await mockMissingDevice(page, 'NotReadableError');
      await openApp(page);
      const deviceId = await chooseSomeDevice(page);
      await connectButton(page).click();
      await expect(errorMessage(page)).toHaveText(TEXT.notReadable);
      expect(await requests(page)).toEqual(['exact']);
      await expect(page.locator('#audio-device')).toHaveValue(deviceId);
      await expect(page.locator('.toast', { hasText: TEXT.fellBack })).toHaveCount(0);
    });
  });

  for (const screen of PHONE_PROFILES) {
    test.describe(`휴대폰 ${screen.name}`, () => {
      test.use({ viewport: { width: screen.width, height: screen.height }, isMobile: true, hasTouch: true });

      test(`E-07 휴대폰 ${screen.name}: 입력 탭에서 연결에 실패하면 오류 문구 전체가 화면 안에 보인다`, async ({ page }) => {
        await mockGetUserMediaError(page, 'NotAllowedError');
        await openApp(page);
        await setMobileDock(page, true, 'input');
        await connectButton(page).tap();
        await expect(errorMessage(page)).toHaveText(TEXT.notAllowed);
        // 도크 안의 패널은 스크롤된다. 안내가 버튼 아래로 밀려 잘려 있으면 '눌렀는데 아무 일도 없다'로 보인다.
        await expect(errorMessage(page)).toBeInViewport({ ratio: 1 });
        await expectNoEnglishRaw(page);
      });
    });
  }
});
