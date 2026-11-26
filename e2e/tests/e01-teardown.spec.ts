// E-01 정지 정리(설계서 S1.2, 보고서 R1-3·R2-12; 이후 모든 Phase 에서 유지하는 정식 시험).
// 연결 해제·Panic·Esc·하울링 차단(모의)이 모두 같은 정리 절차를 지나 500 ms 안에
//   · 입력 트랙이 모두 ended, · AudioContext 가 모두 closed, · 화면이 '기타 연결하기' 로 돌아가는지,
// 녹음 중에 멈춰도 파일이 남는지, 대화상자가 열린 상태의 Esc 는 대화상자만 닫는지,
// 정지→연결을 10번 되풀이해도 AudioContext 가 동시에 둘 이상 열리지 않는지 확인한다.
import { readFileSync } from 'node:fs';
import { chooseRecordingFormat, connectButton, connectGuitar, disconnectButton, openApp, openAudioInputMenu, panicButton, type RecordingFormat } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { markTriggers, mockHowlGuard, readAudioTracking, trackAudioContexts, triggerHowl } from '../helpers/mocks';
import { waitForTeardown } from '../helpers/teardown';
import type { Page } from '@playwright/test';

/** 설계서 S1.2 수용 기준 */
const LIMIT_MS = 500;

/** 모의·측정 장치를 심고 앱을 열어 연결한 뒤, 입력이 살아 있고 컨텍스트가 돌아가는 것까지 확인한다. */
async function openConnected(page: Page): Promise<void> {
  await trackAudioContexts(page);
  await markTriggers(page);
  await mockHowlGuard(page);
  await openApp(page);
  await openAudioInputMenu(page);
  await connectGuitar(page);
  await expect
    .poll(async () => {
      const tracking = await readAudioTracking(page);
      return tracking.contexts.length === 1 && tracking.contexts[0].state === 'running' && tracking.inputTracks.length > 0 && tracking.inputTracks.every((track) => track.readyState === 'live');
    }, { message: '연결 직후에는 입력 트랙이 살아 있고 컨텍스트가 running 이어야 합니다' })
    .toBe(true);
}

function recordElapsed(label: string, elapsedMs: number): void {
  test.info().annotations.push({ type: 'elapsed', description: `${label}: ${Math.round(elapsedMs)} ms` });
}

test.describe('E-01 정지 정리', () => {
  test('E-01 Panic 버튼: 500 ms 안에 입력 트랙 종료·컨텍스트 닫힘·연결 안 됨 화면', async ({ page }) => {
    await openConnected(page);
    await panicButton(page).click();
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    recordElapsed('Panic 버튼', elapsedMs);
    await expect(page.locator('.toast', { hasText: '긴급 정지했습니다. 마이크와 오디오를 모두 껐습니다.' })).toBeVisible();
    await expect(page.locator('.audio-error, .error-message, [role="alert"]:not(.toast)')).toHaveCount(0);
  });

  // 연주 중에는 사용자가 페달 스위치·슬라이더·버튼을 만지고 있어 포커스가 거기에 있다. 그래도 Esc 는 긴급 정지여야 한다.
  const focusTargets: Array<{ name: string; locate: (page: Page) => ReturnType<Page['locator']> }> = [
    { name: '페달 스위치(버튼)', locate: (page) => page.locator('.pedal-board .pedal-card .stomp-toggle-switch').first() },
    { name: '녹음 버튼', locate: (page) => page.getByRole('button', { name: '녹음', exact: true }) },
    { name: '입력 트림 슬라이더', locate: (page) => page.locator('label.io-slider-control', { hasText: '입력 트림' }).locator('input[type="range"]') },
  ];
  for (const target of focusTargets) {
    test(`E-01 Esc: 포커스가 ${target.name}에 있어도 같은 정리`, async ({ page }) => {
      await openConnected(page);
      const focused = target.locate(page);
      await focused.focus();
      await expect(focused).toBeFocused();
      await page.keyboard.press('Escape');
      const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
      recordElapsed(`Esc(${target.name} 포커스)`, elapsedMs);
      await expect(page.locator('.toast', { hasText: '긴급 정지했습니다.' })).toBeVisible();
    });
  }

  test('E-01 Esc: 포커스가 어디에도 없을 때', async ({ page }) => {
    await openConnected(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    recordElapsed('Esc(포커스 없음)', elapsedMs);
    await expect(page.locator('.toast', { hasText: '긴급 정지했습니다.' })).toBeVisible();
  });

  // Esc 를 자기 일에 쓰는 곳(값 편집 칸, 열린 메뉴)에서는 그 일만 한다. 그 뒤에 누른 Esc 가 긴급 정지다(REFACTOR_LOG L-17).
  async function expectStillConnected(page: Page): Promise<void> {
    await page.waitForTimeout(300);
    const tracking = await readAudioTracking(page);
    expect(tracking.inputTracks.every((track) => track.readyState === 'live'), 'Esc 를 컨트롤이 썼다면 마이크가 꺼지면 안 됩니다').toBe(true);
    expect(tracking.contexts.every((context) => context.state === 'running')).toBe(true);
    await expect(disconnectButton(page)).toBeVisible();
    await expect(page.locator('.toast')).toHaveCount(0);
  }

  test('E-01 Esc: 숫자 입력 칸에서는 편집만 취소하고, 이어지는 Esc 가 긴급 정지', async ({ page }) => {
    await openConnected(page);
    const input = page.locator('.pedal-board .pedal-card .knob-number-input').first();
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).not.toBeFocused();
    await expectStillConnected(page);

    await page.keyboard.press('Escape');
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    recordElapsed('Esc(숫자 칸 편집 취소 다음의 Esc)', elapsedMs);
  });

  test('E-01 Esc: MIDI 메뉴가 열려 있으면 메뉴만 닫고, 이어지는 Esc 가 긴급 정지', async ({ page }) => {
    await openConnected(page);
    const trigger = page.locator('.pedal-board .pedal-card button.midi-learn-button[aria-haspopup="menu"]').first();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expectStillConnected(page);

    await page.keyboard.press('Escape');
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    recordElapsed('Esc(MIDI 메뉴를 닫은 다음의 Esc)', elapsedMs);
  });

  test('E-01 하울링 차단(모의): 같은 정리 + 하울링 안내(주파수 포함)', async ({ page }) => {
    await openConnected(page);
    expect(await triggerHowl(page, 1000), 'output-guard 노드가 만들어져 있어야 합니다').toBe(true);
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    recordElapsed('하울링 차단(모의)', elapsedMs);
    // 가드가 알려 준 주파수가 안내에 들어간다(S1.5). 소리로 일으키는 진짜 차단 시험은 E-03 이 한다.
    await expect(page.locator('.toast', { hasText: '하울링(약 1000 Hz)이 감지되어 정지했습니다. 스피커 음량을 줄이거나 헤드폰을 쓰세요.' })).toBeVisible();
  });

  test('E-01 연결 해제 버튼: 같은 정리, 안내 없음', async ({ page }) => {
    await openConnected(page);
    await disconnectButton(page).click();
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    recordElapsed('연결 해제', elapsedMs);
    await expect(page.locator('.toast')).toHaveCount(0);
  });

  test('E-01 연결 안 된 상태의 Esc: 아무 일도 없고 이어서 연결할 수 있음', async ({ page }) => {
    await trackAudioContexts(page);
    await markTriggers(page);
    await openApp(page);
    await openAudioInputMenu(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(connectButton(page)).toBeEnabled();
    expect((await readAudioTracking(page)).contexts).toHaveLength(0);
    await connectGuitar(page);
  });

  // S5.1: 기본 형식이 WAV 로 바뀌었으므로 두 녹음 경로(WAV 는 ScriptProcessor, 작은 파일은 MediaRecorder) 모두 같은 정지 절차를 지나는지 본다.
  const recordingFormats: Array<{ format: RecordingFormat; label: string; extension: string }> = [
    { format: 'wav', label: 'WAV', extension: 'wav' },
    { format: 'webm', label: '작은 파일', extension: '(webm|m4a|mp4|ogg)' },
  ];
  for (const { format, label, extension } of recordingFormats) test(`E-01 녹음 중 Panic(${label}): 파일이 남고 길이 = 녹음 시간 ±0.5초`, async ({ page }) => {
    await openConnected(page);
    await chooseRecordingFormat(page, format);
    await page.getByRole('button', { name: '녹음', exact: true }).click();
    await expect(page.locator('.recording-status', { hasText: '녹음 중' })).toBeVisible();
    const recordStartedAt = await page.evaluate(() => (window as unknown as { __lastTrigger: number }).__lastTrigger);
    await page.waitForTimeout(3000);

    await panicButton(page).click();
    const panicAt = await page.evaluate(() => (window as unknown as { __lastTrigger: number }).__lastTrigger);
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    recordElapsed('녹음 중 Panic', elapsedMs);
    await expect(page.locator('.toast', { hasText: '긴급 정지했습니다. 마이크와 오디오를 모두 껐습니다. 녹음은 저장했습니다.' })).toBeVisible();

    // 정지한 뒤에도 '다운로드' 가 켜져 있고, 받은 파일의 재생 길이가 녹음한 시간과 같다.
    const downloadButton = page.getByRole('button', { name: '다운로드' });
    await expect(downloadButton).toBeEnabled({ timeout: 5000 });
    const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const bytes = Array.from(readFileSync(await download.path()));
    expect(bytes.length).toBeGreaterThan(1000);
    const decodedSeconds = await page.evaluate(async (data: number[]) => {
      const context = new OfflineAudioContext(2, 48_000, 48_000);
      const buffer = await context.decodeAudioData(new Uint8Array(data).buffer);
      return buffer.duration;
    }, bytes);
    const expectedSeconds = (panicAt - recordStartedAt) / 1000;
    test.info().annotations.push({ type: 'recording', description: `재생 길이 ${decodedSeconds.toFixed(2)} s, 녹음 시간 ${expectedSeconds.toFixed(2)} s` });
    expect(Math.abs(decodedSeconds - expectedSeconds)).toBeLessThanOrEqual(0.5);
  });

  test('E-01 도움말 대화상자가 열린 상태의 Esc 는 대화상자만 닫는다', async ({ page }) => {
    await openConnected(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.waitForTimeout(300);
    const tracking = await readAudioTracking(page);
    expect(tracking.inputTracks.every((track) => track.readyState === 'live'), '대화상자를 닫는 Esc 가 마이크를 끄면 안 됩니다').toBe(true);
    expect(tracking.contexts.every((context) => context.state === 'running')).toBe(true);
    await expect(disconnectButton(page)).toBeVisible();
    await expect(page.locator('.toast')).toHaveCount(0);

    // 대화상자가 없으면 같은 Esc 가 긴급 정지다.
    await page.keyboard.press('Escape');
    await waitForTeardown(page, LIMIT_MS);
  });

  test('E-01 정지 → 다시 연결을 10번 되풀이해도 AudioContext 는 동시에 하나', async ({ page }) => {
    test.setTimeout(240_000);
    await trackAudioContexts(page);
    await markTriggers(page);
    await openApp(page);
    await openAudioInputMenu(page);

    const stoppers = ['연결 해제 버튼', 'Panic 버튼', 'Esc'] as const;
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await connectGuitar(page);
      await expect
        .poll(async () => (await readAudioTracking(page)).contexts.filter((context) => context.state === 'running').length, { message: `${cycle + 1}번째 연결` })
        .toBe(1);
      const how = stoppers[cycle % stoppers.length];
      if (how === '연결 해제 버튼') await disconnectButton(page).click();
      else if (how === 'Panic 버튼') await panicButton(page).click();
      else {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Escape');
      }
      await waitForTeardown(page, LIMIT_MS);
    }

    const tracking = await readAudioTracking(page);
    expect(tracking.getUserMediaCalls).toBe(10);
    expect(tracking.contexts).toHaveLength(10);
    expect(tracking.contexts.every((context) => context.state === 'closed')).toBe(true);
    expect(tracking.inputTracks).toHaveLength(10);
    expect(tracking.inputTracks.every((track) => track.readyState === 'ended')).toBe(true);
    expect(tracking.maxOpenContexts, 'AudioContext 가 동시에 둘 이상 열린 적이 있습니다').toBe(1);
  });
});
