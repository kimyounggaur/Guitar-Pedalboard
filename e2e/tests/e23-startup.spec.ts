// E-23 시작 회귀(정식 시험, 모든 Phase 에서 유지): 앱은 열기만 해서는 소리나 마이크를 건드리지 않고,
// 한 번 열어 캐시된 뒤에는 오프라인에서도 열리며, 오프라인에서도 연결(가짜 마이크)이 된다.
import { expect, test } from '../helpers/fixtures';
import { connectGuitar, openApp, PEDAL_COUNT, pedalCards } from '../helpers/app';
import { readAudioTracking, trackAudioContexts } from '../helpers/mocks';

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
});
