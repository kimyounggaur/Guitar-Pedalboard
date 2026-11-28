// S5.6 화면 꺼짐 방지와 이탈 경고(설계서 S5.6, RX-6). 실제 Chromium 에서 `navigator.wakeLock` 만 모의로 바꿔 끼우고(헤드리스에는 실제 화면 잠금이 없다)
// 앱이 언제 요청하고 언제 풀고 언제 다시 요청하는지, 그리고 실제 창 닫기에서 녹음 중에만 확인 창이 뜨는지 본다.
//   ① 연결 전에는 요청이 없고, 연결하면 'screen' 잠금을 하나 요청하고, 연결을 해제하면 푼다
//   ② 탭이 숨겨져 브라우저가 잠금을 풀면 그대로 두고, 다시 보이면 새로 요청한다(숨겨진 동안은 요청하지 않는다)
//   ③ 요청이 오래 걸리는 동안 '보임' 신호가 겹쳐도 잠금은 하나만 쥔다(겹쳐 요청해 앞의 잠금을 잃어버리지 않는다)
//   ④ 요청이 끝나기 전에 연결을 해제하면 늦게 받은 잠금을 바로 푼다
//   ⑤ 지원하지 않는 브라우저에서는 요청 없이 연결이 정상으로 된다
//   ⑥ 요청이 거절돼도 연결·화면은 멀쩡하고, 다음에 다시 보일 때 다시 시도한다
//   ⑧ 음원 파일 재생(연습) 중에도 화면 잠금을 쥐고, 파일을 닫으면 푼다
//   ⑦ 이탈 경고: 녹음 중이 아니면 창 닫기에서 확인 창이 없고, 녹음 중이면 확인 창이 뜨며, 정지하면 다시 없다
import { chooseRecordingFormat, connectGuitar, disconnectButton, openApp, openAudioInputMenu } from '../helpers/app';
import { fixturePath } from '../helpers/env';
import { closeFileButton } from '../helpers/file-media';
import { expect, test } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

interface WakeSnapshot {
  requests: string[];
  active: number;
  released: number;
  supported: boolean;
}

interface WakeOptions {
  /** false 면 `navigator.wakeLock` 이 없는 브라우저처럼 보이게 한다 */
  supported?: boolean;
  /** 요청이 끝나기까지 걸리는 시간(ms) */
  delayMs?: number;
  /** 첫 요청을 거절한다(NotAllowedError) */
  denyFirst?: boolean;
}

/** 페이지가 열리기 전에 `navigator.wakeLock` 모의와 '탭이 숨겨졌다 다시 보임' 흉내를 깐다. */
async function mockWakeLock(page: Page, options: WakeOptions = {}): Promise<void> {
  await page.addInitScript((config) => {
    const state = { requests: [] as string[], active: 0, released: 0, supported: config.supported };
    const live = new Set<{ release: () => Promise<void> }>();
    const target = window as unknown as Record<string, unknown>;
    target.__wake = state;
    let visibility: 'visible' | 'hidden' = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    // 브라우저는 탭이 숨겨지면 화면 잠금을 스스로 풀고 'release' 를 알린다.
    target.__setVisibility = async (value: 'visible' | 'hidden') => {
      visibility = value;
      if (value === 'hidden') await Promise.all([...live].map((lock) => lock.release()));
      document.dispatchEvent(new Event('visibilitychange'));
    };
    if (!config.supported) {
      Reflect.deleteProperty(Navigator.prototype, 'wakeLock');
      return;
    }
    let denied = false;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          state.requests.push(type);
          if (config.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, config.delayMs));
          if (config.denyFirst && !denied) {
            denied = true;
            throw new DOMException('거절', 'NotAllowedError');
          }
          const sentinel = new EventTarget() as EventTarget & { released: boolean; type: string; release: () => Promise<void> };
          sentinel.released = false;
          sentinel.type = type;
          sentinel.release = async () => {
            if (sentinel.released) return;
            sentinel.released = true;
            state.active -= 1;
            state.released += 1;
            live.delete(sentinel);
            sentinel.dispatchEvent(new Event('release'));
          };
          state.active += 1;
          live.add(sentinel);
          return sentinel;
        },
      },
    });
  }, { supported: options.supported ?? true, delayMs: options.delayMs ?? 0, denyFirst: options.denyFirst ?? false });
}

const snapshot = (page: Page): Promise<WakeSnapshot> =>
  page.evaluate(() => (window as unknown as { __wake: WakeSnapshot }).__wake).then((state) => ({ ...state, requests: [...state.requests] }));
const setVisibility = (page: Page, value: 'visible' | 'hidden'): Promise<void> =>
  page.evaluate((next) => (window as unknown as { __setVisibility: (v: string) => Promise<void> }).__setVisibility(next), value);

const startButton = (page: Page) => page.getByRole('button', { name: '녹음', exact: true });
const stopButton = (page: Page) => page.getByRole('button', { name: '정지', exact: true });

test.describe('S5.6 화면 꺼짐 방지와 이탈 경고', () => {
  test('① 연결하면 화면 잠금을 하나 요청하고 연결을 해제하면 푼다(연결 전에는 요청하지 않는다)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await mockWakeLock(page);
    await openApp(page);
    await openAudioInputMenu(page);
    expect((await snapshot(page)).requests).toEqual([]);

    await connectGuitar(page);
    await expect.poll(async () => (await snapshot(page)).active).toBe(1);
    expect((await snapshot(page)).requests).toEqual(['screen']);

    await disconnectButton(page).click();
    await expect.poll(async () => (await snapshot(page)).active).toBe(0);
    expect((await snapshot(page)).requests).toEqual(['screen']);
  });

  test('② 탭이 숨겨져 브라우저가 잠금을 풀면 숨겨진 동안은 요청하지 않고, 다시 보이면 새로 요청한다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await mockWakeLock(page);
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);
    await expect.poll(async () => (await snapshot(page)).active).toBe(1);

    await setVisibility(page, 'hidden');
    await expect.poll(async () => (await snapshot(page)).active).toBe(0);
    await page.waitForTimeout(300);
    expect((await snapshot(page)).requests, '숨겨진 동안에는 요청하지 않는다').toEqual(['screen']);

    await setVisibility(page, 'visible');
    await expect.poll(async () => (await snapshot(page)).active).toBe(1);
    expect((await snapshot(page)).requests).toEqual(['screen', 'screen']);
    await expect(disconnectButton(page)).toBeVisible();
  });

  test('③ 요청이 오래 걸리는 동안 보임 신호가 겹쳐도 잠금은 하나만 쥔다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await mockWakeLock(page, { delayMs: 400 });
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);
    // 첫 요청이 끝나기 전에 '보임' 신호를 여러 번 보낸다(탭을 빠르게 오가는 경우).
    for (let i = 0; i < 3; i += 1) await setVisibility(page, 'visible');
    await page.waitForTimeout(1200);
    const held = await snapshot(page);
    expect(held.active, '쥐고 있는 잠금은 하나').toBe(1);
    expect(held.requests.length, '겹쳐 요청하지 않는다').toBe(1);

    await disconnectButton(page).click();
    await expect.poll(async () => (await snapshot(page)).active, '해제하면 모두 풀린다').toBe(0);
  });

  test('④ 요청이 끝나기 전에 연결을 해제하면 늦게 받은 잠금을 바로 푼다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await mockWakeLock(page, { delayMs: 500 });
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);
    await disconnectButton(page).click();
    await page.waitForTimeout(1000);
    const after = await snapshot(page);
    expect(after.requests).toEqual(['screen']);
    expect(after.active, '늦게 도착한 잠금도 풀렸다').toBe(0);
  });

  test('⑤ 화면 잠금을 지원하지 않는 브라우저에서도 연결은 정상으로 된다(요청 없음)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockWakeLock(page, { supported: false });
    await openApp(page);
    await openAudioInputMenu(page);
    expect(await page.evaluate(() => 'wakeLock' in navigator)).toBe(false);
    await connectGuitar(page);
    await expect(disconnectButton(page)).toBeVisible();
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await page.waitForTimeout(300);
    expect(errors, '오류가 나지 않는다').toEqual([]);
    expect((await snapshot(page)).requests).toEqual([]);
  });

  test('⑥ 요청이 거절돼도 연결은 멀쩡하고, 다음에 다시 보일 때 다시 시도한다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await mockWakeLock(page, { denyFirst: true });
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);
    await expect.poll(async () => (await snapshot(page)).requests.length).toBe(1);
    expect((await snapshot(page)).active).toBe(0);
    await expect(disconnectButton(page)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await setVisibility(page, 'visible');
    await expect.poll(async () => (await snapshot(page)).active).toBe(1);
    expect((await snapshot(page)).requests).toEqual(['screen', 'screen']);
  });

  test('⑧ 음원 파일을 재생하는 동안에도 화면 잠금을 쥐고, 파일을 닫으면 푼다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await mockWakeLock(page);
    await openApp(page);
    await openAudioInputMenu(page);
    await page.setInputFiles('#audio-file', fixturePath('ref-pc.wav'));
    await expect(closeFileButton(page)).toBeEnabled();
    await expect.poll(async () => (await snapshot(page)).active).toBe(1);
    expect((await snapshot(page)).requests).toEqual(['screen']);

    await closeFileButton(page).click();
    await expect.poll(async () => (await snapshot(page)).active).toBe(0);
  });

  test('⑦ 이탈 경고: 녹음 중이 아니면 창을 닫을 때 확인 창이 없고, 녹음 중이면 뜨며, 정지하면 다시 없다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);
    await chooseRecordingFormat(page, 'wav');

    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.dismiss(); // 페이지에 머문다
    });
    const prevented = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });

    // 녹음 중이 아니다: 신호도 막지 않는다
    expect(await prevented()).toBe(false);

    await startButton(page).click();
    await expect(page.locator('.recording-status', { hasText: '녹음 중' })).toBeVisible();
    expect(await prevented(), '녹음 중에는 막는다').toBe(true);
    // 실제 창 닫기: 브라우저 확인 창(beforeunload)이 뜬다
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs).toEqual(['beforeunload']);
    expect(page.isClosed(), '확인 창에서 머물렀으므로 닫히지 않았다').toBe(false);

    await stopButton(page).click();
    await expect(page.locator('.recording-status', { hasText: '녹음 중' })).toHaveCount(0);
    expect(await prevented(), '정지하면 다시 막지 않는다').toBe(false);
    dialogs.length = 0;
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs, '녹음 중이 아니면 확인 창이 없다').toEqual([]);
  });
});
