// S5.5 튜너 기준음(A4) 조정(설계서 S5.5, 수용 기준 "A4 = 442 Hz 설정에서 442 Hz 입력이 0센트").
// 실제 Chromium 에서 가짜 마이크로 뜯은 현 소리를 넣고, 화면의 기준음 선택이 판독에 어떻게 반영되는지 본다.
//   ① 크로매틱: 442 Hz(A4)는 기준음 442 에서 0센트('정확함'), 440 으로 바꾸면 약 +8센트('8센트 높음'). 기본은 440
//   ② 기타: 110.5 Hz 는 기준음 442 에서 5번 줄(A2) '정확함', 440 으로 바꾸면 +8센트 — 줄 목표음도 기준음을 따른다
//   ③ 새로고침 뒤에도 유지: 선택 상자·저장된 I/O 설정·판독이 모두 442 그대로
//   ④ 선택 목록: 기본 440, 설계 범위 430~450 을 모두 담고 1 Hz 단위(코드는 400~480 의 넓은 범위를 허용)
//   ⑤ 기준음을 바꾸면 이전 판독을 지우고 새 기준으로 다시 읽는다(옛 센트가 남지 않는다)
// 음은 3초마다 반복되는 WAV 라서 값은 '나타날 때까지' 매 프레임 본다(e16 과 같은 방식).
import type { Page } from '@playwright/test';
import { connectGuitar, openApp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { readLocal } from '../helpers/storage';

const SETTLE_TIMEOUT = 20_000;
const IO_KEY = 'guitar-pedalboard:io';

interface Reading {
  note: string;
  string: string;
  status: string;
  cents: string;
}

async function turnTunerOn(page: Page): Promise<void> {
  await connectGuitar(page);
  const toggle = page.locator('label.toggle-switch', { hasText: '튜너' });
  await toggle.click();
  await expect(toggle.locator('input')).toBeChecked();
}

async function readTuner(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? '';
    return { note: text('.tuner-note'), string: text('.tuner-string'), status: text('.tuner-status-text'), cents: text('.tuner-cents') };
  });
}

/** 화면 문구가 wantedStatus 가 될 때까지 매 프레임 본다. */
async function waitForStatus(page: Page, wantedStatus: string, wantedNote: string): Promise<Reading> {
  await page.waitForFunction(
    ({ status, note }) =>
      document.querySelector('.tuner-status-text')?.textContent?.trim() === status &&
      document.querySelector('.tuner-note')?.textContent?.trim() === note,
    { status: wantedStatus, note: wantedNote },
    { timeout: SETTLE_TIMEOUT, polling: 'raf' },
  );
  return readTuner(page);
}

const centsOf = (reading: Reading): number => Number(reading.cents.replace(/[^0-9+.-]/g, ''));
const referenceSelect = (page: Page) => page.locator('.tuner-preset-control', { hasText: '기준음 A4' }).locator('select');
const modeButton = (page: Page, name: '기타' | '크로매틱') => page.locator('.tuner-mode-switch').getByRole('button', { name, exact: true });
const storedReference = async (page: Page): Promise<unknown> => {
  const raw = await readLocal(page, IO_KEY);
  return raw === null ? null : (JSON.parse(raw) as { tuningReferenceHz?: unknown }).tuningReferenceHz;
};

test.describe('S5.5 튜너 기준음(A4) 조정', () => {
  test('① 크로매틱: 442 Hz 입력이 기준음 442 에서는 0센트, 440 으로 바꾸면 약 +8센트로 읽힌다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-a4-442.wav');
    await openApp(page);
    await turnTunerOn(page);
    await modeButton(page, '크로매틱').click();
    await expect(referenceSelect(page)).toHaveValue('440');

    // 기본(440) 에서는 442 Hz 가 A4 보다 약 8센트 높다
    const atDefault = await waitForStatus(page, '8센트 높음', 'A4');
    expect(centsOf(atDefault)).toBe(8);

    await referenceSelect(page).selectOption('442');
    const atReference = await waitForStatus(page, '정확함', 'A4');
    expect(Math.abs(centsOf(atReference))).toBeLessThanOrEqual(1);
    await expect(page.locator('.tuner-reading')).toHaveClass(/is-in-tune/);

    // 다시 440 으로 되돌리면 같은 소리가 다시 +8센트
    await referenceSelect(page).selectOption('440');
    const back = await waitForStatus(page, '8센트 높음', 'A4');
    expect(centsOf(back)).toBe(8);
  });

  test('② 기타: 110.5 Hz 는 기준음 442 에서 5번 줄(A2) 정확함이고, 440 이면 +8센트다(줄 목표음도 기준음을 따른다)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-a2-442.wav');
    await openApp(page);
    await turnTunerOn(page);
    await expect(modeButton(page, '기타')).toHaveAttribute('aria-pressed', 'true');

    const atDefault = await waitForStatus(page, '8센트 높음', 'A2');
    expect(atDefault.string).toBe('5번 줄(A2)');

    await referenceSelect(page).selectOption('442');
    const atReference = await waitForStatus(page, '정확함', 'A2');
    expect(atReference.string).toBe('5번 줄(A2)');
    expect(Math.abs(centsOf(atReference))).toBeLessThanOrEqual(1);
    await expect(page.locator('.tuner-targets .is-target')).toHaveText('5번 A2');
  });

  test('③ 새로고침 뒤에도 기준음이 유지된다: 선택 상자·저장값·판독', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-a4-442.wav');
    await openApp(page);
    await turnTunerOn(page);
    await modeButton(page, '크로매틱').click();
    await referenceSelect(page).selectOption('442');
    await waitForStatus(page, '정확함', 'A4');
    expect(await storedReference(page)).toBe(442);

    await openApp(page); // 같은 주소로 다시 열어 새로고침과 같게 한다
    await expect(referenceSelect(page)).toHaveValue('442');
    expect(await storedReference(page)).toBe(442);
    await turnTunerOn(page);
    await modeButton(page, '크로매틱').click();
    const reading = await waitForStatus(page, '정확함', 'A4');
    expect(Math.abs(centsOf(reading))).toBeLessThanOrEqual(1);
  });

  test('④ 선택 목록: 기본 440, 설계 범위 430~450 을 1 Hz 단위로 모두 담는다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-a4-442.wav');
    await openApp(page);
    await expect(referenceSelect(page)).toHaveValue('440');
    const values = await referenceSelect(page).locator('option').evaluateAll((options) => options.map((option) => Number((option as HTMLOptionElement).value)));
    for (let hz = 430; hz <= 450; hz += 1) expect(values, `${hz} Hz`).toContain(hz);
    expect(values.every((value, index) => index === 0 || value - values[index - 1] === 1), '1 Hz 단위로 이어진다').toBe(true);
    await expect(referenceSelect(page).locator('option[value="440"]')).toHaveText('440 Hz');
  });

  test('⑤ 기준음을 바꾸면 이전 판독을 지우고 새 기준으로 다시 읽는다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-a4-442.wav');
    await openApp(page);
    await turnTunerOn(page);
    await modeButton(page, '크로매틱').click();
    await waitForStatus(page, '8센트 높음', 'A4');
    await referenceSelect(page).selectOption('442');
    // 바뀐 직후 한 번은 이전 판독(+8센트)이 남아 있지 않다 — 곧바로 '정확함' 이거나 신호 대기여야 한다.
    const status = await page.evaluate(() => document.querySelector('.tuner-status-text')?.textContent?.trim() ?? '');
    expect(status).not.toBe('8센트 높음');
    await waitForStatus(page, '정확함', 'A4');
  });
});
