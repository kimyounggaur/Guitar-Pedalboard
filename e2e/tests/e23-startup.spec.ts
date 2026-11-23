// E-23 시작 회귀(정식 시험, 모든 Phase 에서 유지): 앱은 열기만 해서는 소리나 마이크를 건드리지 않고,
// 한 번 열어 캐시된 뒤에는 오프라인에서도 열리며, 오프라인에서도 연결(가짜 마이크)이 된다.
import { expect, test } from '../helpers/fixtures';
import { connectGuitar, openApp, PEDAL_COUNT, pedalCards } from '../helpers/app';
import { readAudioTracking, readWorkletModules, trackAudioContexts, trackWorkletModules } from '../helpers/mocks';

test.describe('E-23 시작 회귀', () => {
  test('E-23 로드 직후 AudioContext 0개·getUserMedia 0회', async ({ page }) => {
    await trackAudioContexts(page);
    await openApp(page);
    // 앱이 지연 시작하는 일(스토어 복원·MIDI 재연결·IR 준비)이 끝날 시간을 준다.
    await page.waitForTimeout(1500);
    const tracking = await readAudioTracking(page);
    expect(tracking.contexts, '사용자가 누르기 전에 실시간 AudioContext 를 만들면 안 됩니다').toHaveLength(0);
    expect(tracking.getUserMediaCalls, '사용자가 누르기 전에 마이크를 요청하면 안 됩니다').toBe(0);
  });

  test('E-23 서비스 워커가 캐시한 뒤 오프라인 새로고침에서 앱이 열림', async ({ page, context }) => {
    await openApp(page);
    // 서비스 워커가 설치·활성화되고 앱 파일이 캐시에 들어갈 때까지 기다린다.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const names = await caches.keys();
            let entries = 0;
            for (const name of names) entries += (await (await caches.open(name)).keys()).length;
            return entries;
          }),
        { message: '서비스 워커가 앱 파일을 캐시에 넣어야 합니다', timeout: 20_000 },
      )
      .toBeGreaterThan(5);

    await context.setOffline(true);
    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(page.getByText('오프라인 상태입니다.')).toBeVisible();
    await context.setOffline(false);
  });

  test('E-23 오프라인으로 열어도 가짜 마이크로 연결됨', async ({ launchWithMic }) => {
    const { page, context } = await launchWithMic();
    await openApp(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(async () => page.evaluate(async () => (await caches.keys()).length), { timeout: 20_000 })
      .toBeGreaterThan(0);

    await context.setOffline(true);
    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await connectGuitar(page);
    await context.setOffline(false);
  });

  test('E-23 오프라인 연결에서 리미터 워클릿(별도 파일)이 캐시로 로드됨', async ({ launchWithMic }) => {
    const { page, context } = await launchWithMic();
    await trackWorkletModules(page);
    await openApp(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // 리미터는 문자열이 아니라 빌드가 내보낸 파일이므로 서비스 워커가 프리캐시에 넣었는지 따로 본다.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            for (const name of await caches.keys()) {
              const urls = (await (await caches.open(name)).keys()).map((request) => request.url);
              if (urls.some((url) => /\/assets\/limiter\.worklet-[\w-]+\.js$/.test(url))) return true;
            }
            return false;
          }),
        { message: '리미터 워클릿 파일이 프리캐시에 있어야 합니다', timeout: 20_000 },
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await connectGuitar(page);
    const loads = await readWorkletModules(page);
    const limiter = loads.filter((load) => /\/assets\/limiter\.worklet-[\w-]+\.js$/.test(load.url));
    expect(limiter, '연결하면 리미터 워클릿을 한 번 불러와야 합니다').toHaveLength(1);
    expect(limiter[0].status, limiter[0].message).toBe('loaded');
    expect(loads.filter((load) => load.status !== 'loaded'), '오프라인에서도 모든 워클릿이 로드되어야 합니다').toEqual([]);
    expect(loads.length, '워클릿 모듈은 최소 8개(문자열 7 + 리미터 1)').toBeGreaterThanOrEqual(8);
    await context.setOffline(false);
  });
});
