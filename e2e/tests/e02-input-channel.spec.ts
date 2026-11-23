// E-02 입력 채널(설계서 S1.3, 보고서 R1-4; 이후 모든 Phase 에서 유지하는 정식 시험).
// 2채널 입력 장치에서 기타가 한쪽 입력에만 꽂혀 있어도 양쪽 귀로 같게 들려야 한다.
//   · 왼쪽만 / 오른쪽만 / 양쪽에 같은 소리가 들어오는 가짜 마이크로 자동 판정 결과가 맞는지(화면의 판정 한 줄),
//   · 판정이 끝난 뒤 실제 출력의 좌우 레벨 차가 1 dB 이하인지,
//   · 판정 결과와 직접 고른 모드를 새로고침 뒤에도 기억하는지,
//   · 직접 고른 모드는 연결 중에도 바로 적용되는지,
//   · 채널이 하나뿐인 장치에서는 선택 메뉴를 숨기는지 확인한다.
// 가짜 마이크는 `ref-pc-left-only.wav`·`ref-pc-right-only.wav`·`ref-pc.wav`(양쪽 같은 소리)를 늘 2채널로 준다
// (Chrome 은 channelCount 제약을 무시하고 WAV 의 채널을 그대로 전달한다).
import { connectGuitar, disconnectButton, openApp, activate } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { mockInputChannelCount, readOutputLevels, tapOutput, trackAudioContexts, type OutputLevels } from '../helpers/mocks';
import { recordScreenshot } from '../helpers/record';
import type { Page } from '@playwright/test';

/** 설계서 S1.3 수용 기준: 판정이 끝난 뒤 출력의 좌우 RMS 차 */
const BALANCE_LIMIT_DB = 1;
/** 소리가 실제로 나오고 있다고 볼 최소 출력 레벨(dBFS). 입력은 약 −31 dBFS 이고 체인 이득이 더해진다. */
const AUDIBLE_DB = -60;
/** 직접 고른 입력이 비어 있을 때(예: 왼쪽만 있는 입력에서 2번 입력) 출력이 이보다 작아야 한다. */
const SILENT_DB = -80;

const DECISION_TEXT = {
  pending: '기타 소리가 들어오면 어느 입력을 쓸지 자동으로 정합니다',
  ch1: '1번 입력에서만 소리가 들어와 1번 입력을 씁니다',
  ch2: '2번 입력에서만 소리가 들어와 2번 입력을 씁니다',
  sum: '양쪽 입력에 비슷한 소리가 들어와 합쳐서 씁니다',
} as const;

const channelSelect = (page: Page) => page.locator('#input-channel');
const decisionNote = (page: Page) => page.locator('.input-channel-note');

async function openWithTap(page: Page): Promise<void> {
  await trackAudioContexts(page);
  await tapOutput(page);
  await openApp(page);
}

function balance(levels: OutputLevels): number {
  return Math.abs(levels.leftDb - levels.rightDb);
}

function recordLevels(label: string, levels: OutputLevels): void {
  test.info().annotations.push({
    type: 'levels',
    description: `${label}: 왼쪽 ${levels.leftDb.toFixed(2)} dBFS, 오른쪽 ${levels.rightDb.toFixed(2)} dBFS, 차 ${balance(levels).toFixed(2)} dB`,
  });
}

/** 판정이 난 뒤 20 ms 전환이 끝나도록 잠깐 기다렸다가 1초 동안의 출력 좌우 레벨을 잰다. */
async function measureSettled(page: Page): Promise<OutputLevels> {
  await page.waitForTimeout(400);
  return readOutputLevels(page, 1000);
}

async function readStoredChannels(page: Page): Promise<Record<string, { mode: string; decision: string }>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('guitar-pedalboard:io');
    const parsed = raw ? (JSON.parse(raw) as { inputChannels?: Record<string, { mode: string; decision: string }> }) : {};
    return parsed.inputChannels ?? {};
  });
}

test.describe('E-02 입력 채널', () => {
  test('E-02 연결 전에도 입력 채널 메뉴가 보이고 기본은 자동이다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('ref-pc-left-only.wav');
    await openWithTap(page);
    await expect(channelSelect(page)).toBeVisible();
    await expect(channelSelect(page)).toHaveValue('auto');
    await expect(channelSelect(page).locator('option')).toHaveText(['자동', '1번 입력', '2번 입력', '스테레오']);
    await expect(decisionNote(page)).toHaveText(DECISION_TEXT.pending);
    await recordScreenshot(page, { id: 'E-02', profile: 'desktop', condition: 'channel-menu-auto' });
  });

  const cases = [
    { name: '왼쪽만 들어오는 입력', wav: 'ref-pc-left-only.wav', decision: 'ch1' as const },
    { name: '오른쪽만 들어오는 입력', wav: 'ref-pc-right-only.wav', decision: 'ch2' as const },
    { name: '양쪽에 같은 소리가 들어오는 입력', wav: 'ref-pc.wav', decision: 'sum' as const },
  ];
  for (const testCase of cases) {
    test(`E-02 ${testCase.name}: 자동 판정(${testCase.decision}) 뒤 좌우 차 ${BALANCE_LIMIT_DB} dB 이하`, async ({ launchWithMic }) => {
      const { page } = await launchWithMic(testCase.wav);
      await openWithTap(page);
      await connectGuitar(page);
      await expect(decisionNote(page)).toHaveText(DECISION_TEXT[testCase.decision], { timeout: 8_000 });
      const levels = await measureSettled(page);
      recordLevels(testCase.name, levels);
      expect(Math.max(levels.leftDb, levels.rightDb), '소리가 나와야 합니다').toBeGreaterThan(AUDIBLE_DB);
      expect(balance(levels), '왼쪽·오른쪽 출력 레벨 차(dB)').toBeLessThanOrEqual(BALANCE_LIMIT_DB);
      if (testCase.decision === 'ch1') await recordScreenshot(page, { id: 'E-02', profile: 'desktop', condition: 'decided-left-only' });
    });
  }

  test('E-02 판정 결과를 기억해 새로고침 뒤 연결 전에도 판정 한 줄을 보여 준다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('ref-pc-left-only.wav');
    await openWithTap(page);
    await connectGuitar(page);
    await expect(decisionNote(page)).toHaveText(DECISION_TEXT.ch1, { timeout: 8_000 });
    await expect.poll(async () => Object.values(await readStoredChannels(page)).some((entry) => entry.mode === 'auto' && entry.decision === 'ch1'),
      { message: '판정이 저장소(guitar-pedalboard:io 의 inputChannels)에 남아야 합니다' }).toBe(true);

    await page.reload();
    await expect(channelSelect(page)).toHaveValue('auto');
    await expect(decisionNote(page)).toHaveText(DECISION_TEXT.ch1);
    // 기억한 판정으로 시작해도 연결은 정상이고 좌우가 같게 나온다.
    await connectGuitar(page);
    const levels = await measureSettled(page);
    recordLevels('새로고침 뒤 연결', levels);
    expect(balance(levels)).toBeLessThanOrEqual(BALANCE_LIMIT_DB);
    await expect(decisionNote(page)).toHaveText(DECISION_TEXT.ch1);
  });

  test('E-02 직접 고른 모드는 새로고침 뒤에도 남고, 연결 중에 바꾸면 바로 적용된다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('ref-pc-left-only.wav');
    await openWithTap(page);
    await channelSelect(page).selectOption('ch2');
    // 직접 고르면 자동 판정 문구는 사라진다.
    await expect(decisionNote(page)).toHaveCount(0);
    await expect.poll(async () => Object.values(await readStoredChannels(page)).some((entry) => entry.mode === 'ch2')).toBe(true);

    await page.reload();
    await expect(channelSelect(page)).toHaveValue('ch2');
    await expect(decisionNote(page)).toHaveCount(0);

    // 왼쪽에만 소리가 있으니 2번 입력을 쓰면 아무 소리도 나지 않는다(사용자가 직접 고른 결과를 그대로 따른다).
    await connectGuitar(page);
    const silent = await measureSettled(page);
    recordLevels('2번 입력(왼쪽만 있는 입력)', silent);
    expect(Math.max(silent.leftDb, silent.rightDb), '2번 입력은 비어 있으므로 무음이어야 합니다').toBeLessThan(SILENT_DB);

    // 연결을 끊지 않고 1번 입력으로 바꾸면 바로 소리가 나고 좌우가 같다.
    await channelSelect(page).selectOption('ch1');
    const audible = await measureSettled(page);
    recordLevels('1번 입력으로 바꾼 뒤', audible);
    expect(Math.max(audible.leftDb, audible.rightDb)).toBeGreaterThan(AUDIBLE_DB);
    expect(balance(audible)).toBeLessThanOrEqual(BALANCE_LIMIT_DB);
    await expect(disconnectButton(page)).toBeVisible();
  });

  test('E-02 스테레오를 고르면 왼쪽만 있는 소리가 왼쪽에만 나온다(선택한 대로)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('ref-pc-left-only.wav');
    await openWithTap(page);
    await channelSelect(page).selectOption('stereo');
    await connectGuitar(page);
    const levels = await measureSettled(page);
    recordLevels('스테레오(왼쪽만 있는 입력)', levels);
    expect(levels.leftDb).toBeGreaterThan(AUDIBLE_DB);
    expect(levels.rightDb, '오른쪽은 비어 있어야 합니다').toBeLessThan(SILENT_DB);
  });

  test('E-02 채널이 하나뿐인 장치에서는 메뉴를 숨기고, 연결을 끊으면 다시 보인다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('ref-pc.wav');
    await trackAudioContexts(page);
    await mockInputChannelCount(page, 1);
    await openApp(page);
    await expect(channelSelect(page)).toBeVisible();
    await connectGuitar(page);
    await expect(channelSelect(page)).toHaveCount(0);
    await expect(decisionNote(page)).toHaveCount(0);
    await activate(page, disconnectButton(page));
    await expect(channelSelect(page)).toBeVisible();
  });
});
