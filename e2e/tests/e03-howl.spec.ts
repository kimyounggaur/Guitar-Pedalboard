// E-03 하울링 차단(설계서 S1.5, 6.3절·부록 A·B). 가짜 마이크로 H-1(1 kHz 순음, −20 dBFS, 5초 지속)을 흘려
// 출력 가드(output-guard 워클릿)가 **진짜로** 하울링을 판정해 1.5초 안에 차단하는지 실제 브라우저에서 확인한다.
//   · 데스크톱, 휴대폰의 페달(접힘)·입력·미터·프리셋 탭 각각(S1.6),
//   · 문서가 숨겨진 상태에서도 같은 시간 안에(헤드리스 Chrome 은 진짜 숨김을 만들 수 없어 조건을 흉내 낸다: emulateHiddenDocument),
//   · 파일 모드에서 H-1 을 재생하면 차단하지 않고, '하울링 보호'를 끄면 차단하지 않으며,
//   · 녹음 중에 차단되면 녹음 파일이 남는다(S1.2 경로).
// 시간은 벽시계가 아니라 **오디오 시계**로 잰다: H-1 이 입력에 처음 들어온 구간부터 가드의 `howl-cut` 까지(observeGuard).
// 벽시계는 마이크를 여는 시간과 Playwright 왕복이 섞이고, 숨겨진 문서에서는 타이머가 늦춰져 값이 흔들린다.
// 차단 판정 자체의 신호별 시간(H-1~H-4)·오차단(G-1~G-3)은 오프라인 프로브 P-07 이 정밀하게 본다. 여기서는 '실제 브라우저의 오디오 스레드에서,
// 화면이 어떤 상태여도 같은 시간 안에' 가 핵심이다.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { connectButton, connectGuitar, disconnectButton, openApp, panicButton, setMobileDock } from '../helpers/app';
import { fixturePath } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { emulateHiddenDocument, markTriggers, observeGuard, readAudioTracking, readGuardObservation, trackAudioContexts, type GuardObservation } from '../helpers/mocks';
import { waitForTeardown } from '../helpers/teardown';

/** 설계서 S1.5 수용 기준: 지속음이 입력에 들어온 뒤 이 시간 안에 차단한다. */
const CUT_LIMIT_SECONDS = 1.5;
/** 판정 시간(부록 B). 이보다 일찍 끊겼다면 '1초 넘게 이어짐' 판정이 아니라 다른 이유로 멈춘 것이다(여유 50 ms). */
const MIN_CUT_SECONDS = 0.95;
/** 차단 메시지를 받은 뒤 정지 정리가 끝나기까지의 한도(E-01 과 같다). */
const TEARDOWN_LIMIT_MS = 500;
/** H-1 의 주파수(Hz)와 허용 오차. 가드는 포물선 보간으로 정확히 읽는다(48 kHz 에서 ±1 Hz 이내). */
const H1_HZ = 1000;
const H1_TOLERANCE_HZ = 20;

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/** 측정 장치를 심고 앱을 연다. 연결은 시험마다 따로 한다(데스크톱·휴대폰·파일 모드가 다르다). */
async function openForHowl(page: Page): Promise<void> {
  await trackAudioContexts(page);
  await markTriggers(page);
  await observeGuard(page);
  await openApp(page);
}

/** 가드가 차단을 알릴 때까지 기다린다(오디오 시계 값은 차단 메시지가 온 뒤에 읽는다). 시간 안에 안 오면 그때까지의 관찰을 담아 실패한다. */
async function waitForCut(page: Page, timeoutMs = 10_000): Promise<GuardObservation> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observation = await readGuardObservation(page);
    if (observation.cutSeconds !== null) return observation;
    if (Date.now() > deadline) {
      throw new Error(`${timeoutMs} ms 안에 가드가 하울링을 차단하지 않았습니다: ${JSON.stringify(observation)}`);
    }
    await page.waitForTimeout(20);
  }
}

/** 입력에서 처음 들린 때부터 가드가 차단을 알린 때까지(오디오 시계, 초). 수용 기준을 단언하고 값을 시험 기록에 남긴다. */
function elapsedUntilCut(observation: GuardObservation, label: string): number {
  expect(observation.firstAudibleSeconds, 'H-1 이 입력에 들어온 시각').not.toBeNull();
  expect(observation.cutSeconds, '가드가 차단을 알린 시각').not.toBeNull();
  const elapsed = (observation.cutSeconds as number) - (observation.firstAudibleSeconds as number);
  test.info().annotations.push({ type: 'cut', description: `${label}: ${elapsed.toFixed(3)} s (오디오 시계), ${observation.cutFreqHz?.toFixed(1)} Hz` });
  expect(elapsed, `${label}: 판정 시간(1.0초) 전에 끊겼습니다`).toBeGreaterThanOrEqual(MIN_CUT_SECONDS);
  expect(elapsed, `${label}: ${CUT_LIMIT_SECONDS}초 안에 차단되어야 합니다`).toBeLessThanOrEqual(CUT_LIMIT_SECONDS);
  expect(Math.abs((observation.cutFreqHz as number) - H1_HZ), `${label}: 가드가 알린 주파수`).toBeLessThanOrEqual(H1_TOLERANCE_HZ);
  return elapsed;
}

/** 차단 뒤 정리: 마이크 트랙 종료·컨텍스트 닫힘·'기타 연결하기' 로 복귀, 그리고 하울링 안내(가드가 알린 주파수 포함). */
async function expectCleanStop(page: Page): Promise<void> {
  const { elapsedMs } = await waitForTeardown(page, TEARDOWN_LIMIT_MS);
  test.info().annotations.push({ type: 'elapsed', description: `차단 → 정리 끝: ${Math.round(elapsedMs)} ms` });
  await expect(page.locator('.toast', { hasText: /하울링\(약 \d+ Hz\)이 감지되어 정지했습니다\. 스피커 음량을 줄이거나 헤드폰을 쓰세요\./ })).toBeVisible();
}

test.describe('E-03 하울링 차단', () => {
  test('E-03 데스크톱: H-1 이 1.5초 안에 차단되고 마이크가 정리된다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('h-1.wav');
    await openForHowl(page);
    await connectGuitar(page);

    const observation = await waitForCut(page);
    expect(observation.visibilityAtCut, '차단 때 문서는 보이는 상태').toBe('visible');
    elapsedUntilCut(observation, '데스크톱');
    await expectCleanStop(page);
  });

  const phoneTabs = [
    { id: 'pedals', label: '페달' },
    { id: 'input', label: '입력' },
    { id: 'meter', label: '미터' },
    { id: 'preset', label: '프리셋' },
  ] as const;
  for (const tab of phoneTabs) {
    // 설계서 C1: 설계서 기준 커밋에서는 감시가 미터 그리기(rAF)에 묶여 '미터' 탭이 보일 때만 돌았다. 이 저장소의 HEAD 는 이미 오디오 스레드 워클릿이라
    // 탭과 무관했지만, 새 감시(입력 쪽 판정)도 어느 탭에서든 같은 시간에 끊어야 한다 — 그 회귀를 지킨다.
    test(`E-03 휴대폰 '${tab.label}' 탭: H-1 이 1.5초 안에 차단된다`, async ({ launchWithMic }) => {
      const { page } = await launchWithMic('h-1.wav', PHONE);
      await openForHowl(page);
      // 연결 버튼은 '입력' 탭에 있다. 연결한 뒤 검사할 탭으로 옮긴다(차단까지 1초 남짓 걸리므로 그 전에 옮겨 둔다).
      await setMobileDock(page, true);
      await connectGuitar(page);
      if (tab.id !== 'input') await page.locator(`#mobile-tab-${tab.id}`).click();
      await expect(page.locator(`#mobile-tab-${tab.id}`)).toHaveAttribute('aria-selected', 'true');
      if (tab.id === 'pedals') {
        // '페달' 탭은 도크가 접힌 상태다. 패널이 하나도 보이지 않는다 — 감시가 '미터가 보일 때만' 돌던 시절이라면 여기서 놓쳤을 조합이다.
        await expect(page.locator('#mobile-control-panels')).toBeHidden();
      } else {
        await expect(page.locator(`#mobile-panel-${tab.id}`)).toBeVisible();
      }

      const observation = await waitForCut(page);
      // 차단이 일어난 때에도 같은 탭이 선택되어 있었다(탭이 바뀌어서 맞은 것이 아니다).
      expect(observation.selectedTabAtCut, '차단 때 선택되어 있던 탭').toBe(`mobile-tab-${tab.id}`);
      await expect(page.locator(`#mobile-tab-${tab.id}`)).toHaveAttribute('aria-selected', 'true');
      expect(observation.visibilityAtCut, '차단 때 문서는 보이는 상태').toBe('visible');
      elapsedUntilCut(observation, `휴대폰 ${tab.label} 탭`);
      await expectCleanStop(page);
    });
  }

  test('E-03 문서 숨김(흉내): 같은 시간 안에 차단되고 정리가 끝난다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('h-1.wav');
    await openForHowl(page);
    await connectGuitar(page);
    // 연결 직후(차단 판정 1초가 지나기 전)에 숨김 조건을 만든다. 차단 때 숨겨져 있었는지는 아래에서 다시 확인한다.
    await emulateHiddenDocument(page);
    expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');

    const observation = await waitForCut(page);
    expect(observation.visibilityAtCut, '차단 때 문서는 이미 숨겨져 있었다').toBe('hidden');
    elapsedUntilCut(observation, '문서 숨김(흉내)');

    // 숨겨진 문서는 타이머가 늦게 깨어나(흉내: 1초 이상) 정리 시간 한도(500 ms)는 걸지 않는다. 대신 마이크와 컨텍스트가 끝내 정리되는지 본다.
    await expect
      .poll(
        async () => {
          const tracking = await readAudioTracking(page);
          return tracking.inputTracks.length > 0 && tracking.inputTracks.every((track) => track.readyState === 'ended') && tracking.contexts.every((entry) => entry.state === 'closed');
        },
        { timeout: 8000, message: '숨겨진 문서에서도 차단 뒤에 마이크 트랙이 모두 ended, 컨텍스트가 모두 closed 여야 합니다' },
      )
      .toBe(true);
    await expect(page.locator('.toast', { hasText: /하울링\(약 \d+ Hz\)이 감지되어 정지했습니다/ })).toBeVisible();
    await expect(connectButton(page), '정리가 끝나면 \'기타 연결하기\' 로 돌아온다').toBeVisible();
  });

  test('E-03 파일 모드: H-1 을 재생해도 차단하지 않는다(리미터만 동작)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await openForHowl(page);
    await page.setInputFiles('#audio-file', fixturePath('h-1.wav'));
    // 파일이 입력에 들어와 소리가 흐르기 시작할 때까지 기다린다(가드가 아니라 입력 레벨 미터가 본다).
    await expect.poll(async () => (await readGuardObservation(page)).firstAudibleSeconds, { timeout: 10_000, message: 'H-1 파일이 재생되어야 합니다' }).not.toBeNull();
    const started = await readGuardObservation(page);
    // 마이크 입력이라면 1.0~1.1초에 끊겼을 시간(차단 한도 1.5초)보다 길게 계속 흘려 본다. H-1 은 5초라 3초 뒤에도 재생 중이다.
    await page.waitForTimeout(3000);
    const after = await readGuardObservation(page);
    expect(after.cutSeconds, '파일 모드에서는 하울링 판정을 하지 않는다').toBeNull();
    expect(after.suspectMessages, '판정이 진행되지도 않았다').toBe(0);
    expect(after.inputLevelMessages, '소리는 계속 흘렀다').toBeGreaterThan(started.inputLevelMessages + 30);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(panicButton(page), '세션은 그대로 살아 있다').toBeVisible();
    const tracking = await readAudioTracking(page);
    expect(tracking.contexts.every((entry) => entry.state === 'running')).toBe(true);
  });

  test("E-03 '하울링 보호'를 끄면 H-1 이 계속 흘러도 차단하지 않는다", async ({ launchWithMic }) => {
    const { page } = await launchWithMic('h-1.wav');
    await openForHowl(page);
    const toggle = page.getByLabel('하울링 보호');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    await connectGuitar(page);

    await expect.poll(async () => (await readGuardObservation(page)).firstAudibleSeconds, { timeout: 10_000, message: 'H-1 이 입력에 들어와야 합니다' }).not.toBeNull();
    await page.waitForTimeout(3000);
    const observation = await readGuardObservation(page);
    expect(observation.cutSeconds, '보호를 끈 장치 입력은 판정하지 않는다').toBeNull();
    expect(observation.suspectMessages).toBe(0);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(disconnectButton(page)).toBeVisible();
    expect((await readAudioTracking(page)).inputTracks.every((track) => track.readyState === 'live')).toBe(true);
  });

  test('E-03 녹음 중 차단: 녹음 파일이 남고 소리가 들어 있다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('h-1.wav');
    await openForHowl(page);
    await connectGuitar(page);
    await page.getByRole('button', { name: '녹음', exact: true }).click();
    await expect(page.getByText(/녹음 중/)).toBeVisible();
    const recordStartedAt = await page.evaluate(() => (window as unknown as { __lastTrigger: number }).__lastTrigger);

    const observation = await waitForCut(page);
    elapsedUntilCut(observation, '녹음 중');
    await expectCleanStop(page);
    await expect(page.locator('.toast', { hasText: /녹음은 저장했습니다/ })).toBeVisible();

    // 정지한 뒤에도 '다운로드' 가 켜져 있고, 받은 파일에 차단 직전까지의 소리가 들어 있다.
    const downloadButton = page.getByRole('button', { name: '다운로드' });
    await expect(downloadButton).toBeEnabled({ timeout: 5000 });
    const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
    expect(download.suggestedFilename()).toMatch(/\.(webm|m4a|mp4|ogg|wav)$/);
    const bytes = Array.from(readFileSync(await download.path()));
    expect(bytes.length).toBeGreaterThan(1000);
    const decoded = await page.evaluate(async (data: number[]) => {
      const context = new OfflineAudioContext(2, 48_000, 48_000);
      const buffer = await context.decodeAudioData(new Uint8Array(data).buffer);
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
      }
      return { duration: buffer.duration, peak };
    }, bytes);
    const recordedSeconds = ((observation.cutReceivedAt as number) - recordStartedAt) / 1000;
    test.info().annotations.push({ type: 'recording', description: `재생 길이 ${decoded.duration.toFixed(2)} s, 녹음한 시간(차단까지) ${recordedSeconds.toFixed(2)} s, 최대 진폭 ${decoded.peak.toFixed(4)}` });
    expect(decoded.duration, '녹음 길이는 시작부터 차단까지의 시간과 같다(±0.5초)').toBeGreaterThan(0);
    expect(Math.abs(decoded.duration - recordedSeconds)).toBeLessThanOrEqual(0.5);
    expect(decoded.peak, '녹음에는 차단 전까지의 소리가 들어 있다(무음 파일이 아니다)').toBeGreaterThan(0.001);
  });
});
