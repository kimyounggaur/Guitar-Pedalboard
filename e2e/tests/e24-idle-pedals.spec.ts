// E-24 꺼진 페달 쉬기(S4.2, 설계서 R4-2). 오프라인 렌더 프로브(P-17·P-30)는 렌더 시계로 쉬기를 재지만, 이 시험은 실제 브라우저의
// 실시간 엔진(창 타이머)에서 같은 일이 되는지 본다: 꺼지면 이펙트 입력을 끊어 쉬고, 켜면 다시 이어 소리가 돌아오며,
// 워클릿 페달이 쉬었다 깨어난 뒤에도 소리가 난다(처리기가 한 번 멈추면 다시 깨어나지 않는 Chromium 동작이 있다, REFACTOR_LOG L-267).
//   ① 끈 지 0.4초 뒤 이펙트 입력이 끊기고, 켜면 다시 이어진다(Noise Gate)
//   ② 워클릿 페달 5종(Noise Gate·Compressor·Auto Wah·Flanger·Phaser)이 꺼졌다 켜져도 출력 레벨이 같다
//   ③ 주소에 ?ff=-idleDisconnect 를 붙이면(기능 플래그 끔) 끊지 않는다
import type { Page } from '@playwright/test';
import { connectGuitar, pedalCards, pedalSwitches, PEDAL_COUNT } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { readAudioDisconnects, readAudioEdges, readOutputLevels, tapOutput, trackAudioGraph } from '../helpers/mocks';
import { PEDALS } from '../helpers/storage';

/** 꺼진 뒤 끊기까지(페이드 12 ms + 여유 10 ms)보다 넉넉한 시간 */
const IDLE_WAIT_MS = 400;
/** 깨운 뒤 켜지는 크로스페이드·워클릿 시작이 끝나도록 기다리는 시간 */
const WAKE_WAIT_MS = 500;
/** 꺼졌다 켜진 뒤 출력 레벨이 처음과 다를 수 있는 한계(dB). LFO 위상이 다르게 흐른 효과(0.6 dB 안팎)에 여유를 둔다. */
const LEVEL_TOLERANCE_DB = 2.5;

function switchOf(page: Page, name: string) {
  const index = PEDALS.findIndex((pedal) => pedal.name === name);
  if (index < 0) throw new Error(`없는 페달: ${name}`);
  return pedalSwitches(page).nth(index);
}

async function isOn(page: Page, name: string): Promise<boolean> {
  return (await switchOf(page, name).getAttribute('aria-pressed')) === 'true';
}

/** 켜진 쪽으로 맞춘다 */
async function ensureOn(page: Page, name: string): Promise<void> {
  if (!(await isOn(page, name))) await switchOf(page, name).click();
  await expect(switchOf(page, name)).toHaveAttribute('aria-pressed', 'true');
}

async function openTracked(page: Page, search = ''): Promise<void> {
  await trackAudioGraph(page);
  await tapOutput(page);
  await page.goto(`./${search}`);
  await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
}

/** 두 채널 가운데 큰 쪽의 RMS(dBFS) */
async function outputDb(page: Page, durationMs = 1500): Promise<number> {
  const levels = await readOutputLevels(page, durationMs);
  return Math.max(levels.leftDb, levels.rightDb);
}

test.describe('E-24 꺼진 페달 쉬기(S4.2)', () => {
  test('E-24 꺼진 지 0.4초 뒤 이펙트 입력이 끊기고 켜면 다시 이어진다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await openTracked(page);
    await connectGuitar(page);
    await page.waitForTimeout(WAKE_WAIT_MS);

    // 켜진 채로는 끊지 않는다. 기준은 연결 직후(꺼진 10개는 이미 쉰다)의 개수다.
    const base = (await readAudioDisconnects(page)).length;
    const baseEdges = (await readAudioEdges(page)).length;
    await ensureOn(page, 'Noise Gate');

    await switchOf(page, 'Noise Gate').click();
    await expect(switchOf(page, 'Noise Gate')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(IDLE_WAIT_MS);
    const afterOff = await readAudioDisconnects(page);
    expect(afterOff.length - base, 'Noise Gate 를 끄고 0.4초 뒤 이펙트 입력(게이트 → 입력) 연결이 하나 끊겨야 합니다').toBe(1);
    expect(afterOff[afterOff.length - 1], '끊기는 것은 노드 사이의 연결이다').toMatchObject({ from: 'GainNode', to: 'GainNode' });

    await switchOf(page, 'Noise Gate').click();
    await expect(switchOf(page, 'Noise Gate')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(WAKE_WAIT_MS);
    const afterOn = await readAudioEdges(page);
    expect(afterOn.length - baseEdges, '켜면 끊었던 연결이 다시 이어져야 합니다').toBe(1);
    expect(afterOn[afterOn.length - 1], '다시 이어지는 것도 같은 노드 사이의 연결이다').toMatchObject({ from: 'GainNode', to: 'GainNode' });
    expect((await readAudioDisconnects(page)).length, '켠 뒤로는 더 끊지 않는다').toBe(afterOff.length);
  });

  test('E-24 워클릿 페달 5종이 꺼졌다 켜져도 출력 레벨이 같고 소리가 난다', async ({ launchWithMic }) => {
    test.setTimeout(120_000);
    const { page } = await launchWithMic();
    await openTracked(page);
    await connectGuitar(page);
    await page.waitForTimeout(WAKE_WAIT_MS);

    // 처음 켜는 것도 '처음부터 쉬던 페달을 깨우는' 길이라, 처음과 두 번째 모두 소리가 나야 한다.
    for (const name of ['Noise Gate', 'Compressor', 'Auto Wah', 'Flanger', 'Phaser']) {
      await ensureOn(page, name);
      await page.waitForTimeout(WAKE_WAIT_MS);
      const before = await outputDb(page);
      expect(before, `${name}: 켠 체인의 출력이 무음이면 안 됩니다`).toBeGreaterThan(-60);

      await switchOf(page, name).click();
      await page.waitForTimeout(IDLE_WAIT_MS);
      await switchOf(page, name).click();
      await expect(switchOf(page, name)).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(WAKE_WAIT_MS);
      const after = await outputDb(page);

      test.info().annotations.push({ type: 'levels', description: `${name}: 처음 ${before.toFixed(2)} dBFS, 꺼졌다 켠 뒤 ${after.toFixed(2)} dBFS` });
      console.log(`[E-24] ${name}: 처음 ${before.toFixed(2)} dBFS → 꺼졌다 켠 뒤 ${after.toFixed(2)} dBFS (차 ${(after - before).toFixed(2)} dB)`);
      expect(after, `${name}: 꺼졌다 켠 뒤 출력이 무음이면 안 됩니다`).toBeGreaterThan(-60);
      expect(Math.abs(after - before), `${name}: 꺼졌다 켠 뒤 출력 레벨이 처음과 ${LEVEL_TOLERANCE_DB} dB 넘게 달라졌습니다`).toBeLessThanOrEqual(LEVEL_TOLERANCE_DB);
    }
  });

  test('E-24 주소에 ?ff=-idleDisconnect 를 붙이면 끊지 않는다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic();
    await openTracked(page, '?ff=-idleDisconnect');
    await connectGuitar(page);
    await page.waitForTimeout(WAKE_WAIT_MS);

    const base = (await readAudioDisconnects(page)).length;
    await ensureOn(page, 'Noise Gate');
    await switchOf(page, 'Noise Gate').click();
    await expect(switchOf(page, 'Noise Gate')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(IDLE_WAIT_MS);
    await switchOf(page, 'Noise Gate').click();
    await page.waitForTimeout(WAKE_WAIT_MS);
    expect((await readAudioDisconnects(page)).length - base, '플래그를 끄면 꺼진 페달도 이어 둔다(옛 동작)').toBe(0);
    expect(await outputDb(page, 1000), '플래그를 꺼도 소리는 난다').toBeGreaterThan(-60);
  });
});
