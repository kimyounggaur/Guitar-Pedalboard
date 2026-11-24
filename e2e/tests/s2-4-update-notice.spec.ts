// S2.4 새 버전 알림 — 서비스 워커가 새 버전으로 바뀌어도 열려 있는 화면을 스스로 새로고침하지 않고, 알림만 띄운다(설계서 S2.4 변경 5).
//   수용 기준: "연주 중 새 버전이 배포돼도 자동 새로고침이 일어나지 않는다".
//   저장 형식이 바뀌는 첫 배포라서 이 Step 에 넣었다. 연주 도중에 화면이 다시 열리면 소리가 끊기고, 열려 있는 옛 탭과 새 탭이 섞이기 때문이다.
//   · 처음 설치(탭을 연 뒤 서비스 워커가 처음 제어권을 잡음)는 '새 버전'이 아니므로 알림이 없다.
//   · 새 서비스 워커가 활성화되면 정보 알림 한 장: '새 버전이 있습니다 — 연주를 마친 뒤 새로고침', 버튼 '새로고침'. 직접 닫기 전까지 남는다.
//   · 알림이 떠 있는 동안 화면은 새로고침되지 않는다(기타를 연결한 채로도 마찬가지). 버튼을 눌러야만 새로고침한다.
//   · 이미 서비스 워커가 있는 상태로 열린 탭(새로고침 뒤)도 다음 새 버전에서 알린다. 서비스 워커가 그대로면(바이트가 같으면) 알리지 않는다.
// 배포를 흉내 낸다: `dist/` 를 서비스하는 작은 서버(helpers/dist-server.ts)가 시험 도중에 sw.js 의 바이트를 바꿔 내려 주고, 브라우저에게 업데이트를 확인하게 한다.
// 이 시험은 기본 서비스 워커 허용 설정을 쓴다(e05 처럼 `serviceWorkers: 'block'` 을 걸지 않는다). 실제 GitHub Pages 배포는 '사람 확인 필요'다.
import type { Page } from '@playwright/test';
import { PEDAL_COUNT, connectGuitar, disconnectButton, pedalCards } from '../helpers/app';
import { startDistServer, type DistServer } from '../helpers/dist-server';
import { expect, test } from '../helpers/fixtures';
import { toastOf } from '../helpers/storage';

const TOAST_KEY = 'app:update-available';
/** 설계서 S2.4 변경 5의 문구 그대로 */
const MESSAGE = '새 버전이 있습니다 — 연주를 마친 뒤 새로고침';

let server: DistServer;

test.beforeEach(async () => {
  server = await startDistServer();
});

test.afterEach(async () => {
  await server.close();
});

/** 앱을 열고 서비스 워커가 이 탭의 제어권을 잡을 때까지 기다린다 */
async function openControlled(page: Page): Promise<void> {
  await page.goto(server.url);
  await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** 새 서비스 워커를 내려 주고, 브라우저가 지금 업데이트를 확인하게 한다 */
async function deployNewVersion(page: Page): Promise<void> {
  server.publishNewServiceWorker();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

const setMarker = (page: Page, value: string): Promise<void> =>
  page.evaluate((marker) => {
    (window as unknown as { __e2eMarker?: string }).__e2eMarker = marker;
  }, value);

const readMarker = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as { __e2eMarker?: string }).__e2eMarker);

/** 알림이 그려질 시간을 조금 준다(알림이 안 뜬다는 것을 확인할 때만 쓴다) */
const settle = (page: Page): Promise<void> => page.waitForTimeout(300);

/** 메인 프레임이 새로 열린 횟수를 세기 시작한다(자동 새로고침이 있었는지) */
function countMainFrameNavigations(page: Page): () => number {
  let count = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) count += 1;
  });
  return () => count;
}

test.describe('S2.4 새 버전 알림 — 알리기만 하고 스스로 새로고침하지 않는다', () => {
  test('S2.4 처음 설치로 제어권을 잡은 것은 새 버전이 아니고, 새 서비스 워커가 활성화되면 알림이 뜨며, 버튼을 눌러야 새로고침한다', async ({ page }) => {
    await openControlled(page);
    await settle(page);
    await expect(toastOf(page, TOAST_KEY), '처음 설치는 새 버전이 아니다').toHaveCount(0);

    await setMarker(page, 'before-update');
    const navigations = countMainFrameNavigations(page);
    await deployNewVersion(page);

    const toast = toastOf(page, TOAST_KEY);
    await expect(toast, '새 서비스 워커가 활성화되면 알림').toBeVisible({ timeout: 15_000 });
    await expect(toast).toHaveAttribute('data-toast-kind', 'info');
    await expect(toast.locator('.toast-message'), '설계서 문구 그대로').toHaveText(MESSAGE);
    await expect(toast.locator('.toast-action'), '누르면 새로고침하는 버튼').toHaveText('새로고침');
    await expect(toastOf(page, TOAST_KEY), '같은 알림은 한 장만').toHaveCount(1);

    // 알림이 떠 있는 동안 화면은 그대로다: 새로 열리지 않고, 화면 안의 값도 그대로, 알림은 스스로 사라지지 않는다.
    await page.waitForTimeout(2_000);
    expect(navigations(), '자동 새로고침(메인 프레임 이동) 0').toBe(0);
    expect(await readMarker(page), '화면이 다시 열리지 않았다').toBe('before-update');
    await expect(toast, '알림은 직접 닫기 전까지 남는다').toBeVisible();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);

    // 버튼을 누르면 그때 새로고침한다.
    await Promise.all([page.waitForEvent('load'), toast.locator('.toast-action').click()]);
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    expect(await readMarker(page), '새로고침했다').toBeUndefined();
    await expect(toastOf(page, TOAST_KEY), '새로고침한 화면은 이미 새 버전이다').toHaveCount(0);
  });

  test('S2.4 기타를 연결해 연주하는 중에 새 버전이 배포돼도 연결이 끊기지 않고 새로고침하지 않는다', async ({ page }) => {
    await openControlled(page);
    await connectGuitar(page);
    await setMarker(page, 'playing');
    const navigations = countMainFrameNavigations(page);

    await deployNewVersion(page);

    await expect(toastOf(page, TOAST_KEY), '연주 중에도 알림만 뜬다').toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    expect(navigations(), '자동 새로고침 0').toBe(0);
    expect(await readMarker(page), '화면이 다시 열리지 않았다').toBe('playing');
    await expect(disconnectButton(page), '연결은 그대로').toBeVisible();
  });

  test('S2.4 이미 서비스 워커가 있는 상태로 열린 탭(새로고침 뒤)도 다음 새 버전을 알린다', async ({ page }) => {
    await openControlled(page);
    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), '새로고침한 탭은 처음부터 제어를 받는다').toBe(true);
    await settle(page);
    await expect(toastOf(page, TOAST_KEY)).toHaveCount(0);

    await deployNewVersion(page);
    await expect(toastOf(page, TOAST_KEY), '다음 새 버전에서 알림').toBeVisible({ timeout: 15_000 });
  });

  test('S2.4 서비스 워커가 그대로이면(바이트가 같으면) 업데이트를 확인해도 알림이 없다', async ({ page }) => {
    await openControlled(page);
    // 새로 내려 주지 않은 채 확인만 한다.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await settle(page);
    await expect(toastOf(page, TOAST_KEY), '바뀐 것이 없으면 알리지 않는다').toHaveCount(0);
  });
});
