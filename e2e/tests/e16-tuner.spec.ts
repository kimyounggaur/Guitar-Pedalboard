// E-16 튜너(설계서 S2.12, 4.x, P-22). 실제 Chromium 에서 가짜 마이크로 뜯은 현 소리를 넣고 화면에 나오는 줄·옥타브·센트를 본다.
//   ① D2 → '6번 줄(E2) · 200센트 낮음'(예전엔 D3 '정확함'으로 접혀 읽혔다). 표준 튜닝, Drop D 에서는 6번 줄(D2) '정확함'
//   ② C3 → 기타 모드 '4번 줄(D3) · 200센트 낮음', 크로매틱 모드 'C3'(줄 번호 없음)
//   ③ B1(61.74 Hz) → 크로매틱에서 ±2센트 안으로 'B1'
//   ④ E3 → '6번 줄(E2)보다 한 옥타브 높습니다'
//   ⑤ C5 → 어느 줄과도 멀어서 '줄 번호를 확인하세요'(센트 '-- ¢', 줄 이름 없음)
//   ⑥ 기타/크로매틱 전환 버튼: 눌림 표시, 튜닝 선택은 기타 튜닝 4개뿐이고 크로매틱에서는 꺼지며 목표음 칸도 숨는다. 기타로 돌아오면 직전 튜닝
//   ⑦ 개방 6번 줄 → 정확함(P-22 와 같은 방향의 화면 확인)
//   ⑧ 휴대폰 화면에서 긴 안내 문구가 가로로 넘치지 않는다
// 음이 계속 들리는 게 아니라 뜯은 소리가 3초마다 반복되므로(WAV 반복) 값은 '나타날 때까지' waitForFunction 으로 매 프레임 본다.
import type { Page } from '@playwright/test';
import { connectGuitar, horizontalOverflow, openApp, setMobileDock } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
const SETTLE_TIMEOUT = 20_000;

interface Reading {
  note: string;
  string: string;
  status: string;
  cents: string;
}

/** 연결하고 튜너를 켠다 */
async function turnTunerOn(page: Page): Promise<void> {
  await connectGuitar(page);
  const toggle = page.locator('label.toggle-switch', { hasText: '튜너' });
  await toggle.click();
  await expect(toggle.locator('input')).toBeChecked();
}

/** 화면에 지금 보이는 튜너 값 */
async function readTuner(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? '';
    return {
      note: text('.tuner-note'),
      string: text('.tuner-string'),
      status: text('.tuner-status-text'),
      cents: text('.tuner-cents'),
    };
  });
}

/** 조건을 만족하는 값이 화면에 나타날 때까지 매 프레임 확인하고, 나타난 값을 돌려준다 */
async function waitForTuner(page: Page, statusText: string, note?: string): Promise<Reading> {
  await page.waitForFunction(
    ({ wantedStatus, wantedNote }) => {
      const status = document.querySelector('.tuner-status-text')?.textContent?.trim();
      const shownNote = document.querySelector('.tuner-note')?.textContent?.trim();
      return status === wantedStatus && (wantedNote === undefined || shownNote === wantedNote);
    },
    { wantedStatus: statusText, wantedNote: note },
    { timeout: SETTLE_TIMEOUT, polling: 'raf' },
  );
  return readTuner(page);
}

const modeButton = (page: Page, name: '기타' | '크로매틱') => page.locator('.tuner-mode-switch').getByRole('button', { name, exact: true });
const tuningSelect = (page: Page) => page.locator('.tuner-preset-control', { hasText: '튜닝' }).locator('select');

test.describe('E-16 튜너: 줄·옥타브·크로매틱', () => {
  test('E-16 ① D2 는 6번 줄 E2 보다 200센트 낮은 음으로 읽힌다(Drop D 에서는 정확함)', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-d2.wav');
    await openApp(page);
    await turnTunerOn(page);

    const reading = await waitForTuner(page, '200센트 낮음', 'D2');
    expect(reading.string).toBe('6번 줄(E2)');
    expect(reading.cents).toBe('-200 ¢');
    await expect(page.locator('.tuner-reading')).toHaveClass(/is-far/);
    await expect(page.locator('.tuner-targets .is-target')).toHaveText('6번 E2');
    // 센트 막대: -200센트는 막대 끝(-50)에서 멈추고, 읽어 주는 값은 화면 문구와 같다
    const strip = page.locator('.cent-strip');
    await expect(strip).toHaveAttribute('aria-valuenow', '-50');
    await expect(strip).toHaveAttribute('aria-valuetext', '200센트 낮음');
    await expect(strip).toHaveAttribute('style', /--cent-position: 0%/);

    await tuningSelect(page).selectOption('drop-d');
    const dropD = await waitForTuner(page, '정확함', 'D2');
    expect(dropD.string).toBe('6번 줄(D2)');
    await expect(page.locator('.tuner-reading')).toHaveClass(/is-in-tune/);
  });

  test('E-16 ② C3 는 기타 모드에서 4번 줄(D3)보다 200센트 낮고, 크로매틱 모드에서는 C3 로 읽힌다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-c3.wav');
    await openApp(page);
    await turnTunerOn(page);

    const guitar = await waitForTuner(page, '200센트 낮음', 'C3');
    expect(guitar.string).toBe('4번 줄(D3)');

    await modeButton(page, '크로매틱').click();
    const chromatic = await waitForTuner(page, '정확함', 'C3');
    expect(chromatic.string).toBe('');
    expect(chromatic.note).toBe('C3');
    await expect(page.locator('.tuner-string')).toHaveCount(0);
  });

  test('E-16 ③ B1(61.74 Hz)은 크로매틱에서 ±2센트 안으로 읽히고, 기타 모드에서는 6번 줄 E2 보다 500센트 낮다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-b1.wav');
    await openApp(page);
    await turnTunerOn(page);

    const guitar = await waitForTuner(page, '500센트 낮음', 'B1');
    expect(guitar.string).toBe('6번 줄(E2)');

    await modeButton(page, '크로매틱').click();
    await page.waitForFunction(
      () => {
        const note = document.querySelector('.tuner-note')?.textContent?.trim();
        const cents = Number.parseFloat(document.querySelector('.tuner-cents')?.textContent ?? 'NaN');
        return note === 'B1' && Math.abs(cents) <= 2;
      },
      undefined,
      { timeout: SETTLE_TIMEOUT, polling: 'raf' },
    );
    const reading = await readTuner(page);
    expect(reading.note).toBe('B1');
    expect(Math.abs(Number.parseFloat(reading.cents))).toBeLessThanOrEqual(2);
  });

  test('E-16 ④ 6번 줄을 맞추는데 E3 가 들어오면 한 옥타브 높다고 알려 준다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-e3.wav');
    await openApp(page);
    await turnTunerOn(page);

    const reading = await waitForTuner(page, '6번 줄(E2)보다 한 옥타브 높습니다', 'E3');
    expect(reading.string).toBe('6번 줄(E2)');
    await expect(page.locator('.tuner-reading')).toHaveClass(/is-far/);
    await expect(page.locator('.tuner-targets .is-target')).toHaveText('6번 E2');
  });

  test('E-16 ⑤ 어느 줄과도 멀면 줄 번호를 확인하라고 하고 센트·줄 이름을 보이지 않는다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-c5.wav');
    await openApp(page);
    await turnTunerOn(page);

    const reading = await waitForTuner(page, '줄 번호를 확인하세요', 'C5');
    expect(reading.cents).toBe('-- ¢');
    expect(reading.string).toBe('');
    await expect(page.locator('.tuner-string')).toHaveCount(0);
    await expect(page.locator('.tuner-targets .is-target')).toHaveCount(0);

    // 크로매틱으로 바꾸면 같은 소리가 그냥 C5 로 읽힌다
    await modeButton(page, '크로매틱').click();
    const chromatic = await waitForTuner(page, '정확함', 'C5');
    expect(chromatic.string).toBe('');
  });

  test('E-16 ⑥ 기타/크로매틱 전환: 눌림 표시, 튜닝 선택은 기타 튜닝 4개뿐, 크로매틱에서는 선택·목표음이 꺼지고 돌아오면 직전 튜닝', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-d2.wav');
    await openApp(page);

    await expect(page.locator('.tuner-mode-switch')).toHaveAttribute('role', 'group');
    await expect(modeButton(page, '기타')).toHaveAttribute('aria-pressed', 'true');
    await expect(modeButton(page, '크로매틱')).toHaveAttribute('aria-pressed', 'false');
    const optionLabels = await tuningSelect(page).locator('option').allTextContents();
    expect(optionLabels).toEqual(['Standard', 'Drop D', 'Half Step Down', 'Open G']);
    await expect(tuningSelect(page)).toBeEnabled();
    await expect(page.locator('.tuner-targets')).toBeVisible();

    await tuningSelect(page).selectOption('open-g');
    await modeButton(page, '크로매틱').click();
    await expect(modeButton(page, '크로매틱')).toHaveAttribute('aria-pressed', 'true');
    await expect(modeButton(page, '기타')).toHaveAttribute('aria-pressed', 'false');
    await expect(tuningSelect(page)).toBeDisabled();
    await expect(tuningSelect(page)).toHaveValue('open-g');
    // 크로매틱에는 목표음이 없다: 칸이 비어 눈에는 안 보이지만, 이름 붙은 빈 그룹이 화면 낭독기에 읽히지 않도록 hidden 이어야 한다
    await expect(page.locator('.tuner-targets')).toBeHidden();
    await expect(page.locator('.tuner-targets')).toHaveAttribute('hidden', '');
    await expect(page.locator('.tuner-targets span')).toHaveCount(0);

    await modeButton(page, '기타').click();
    await expect(modeButton(page, '기타')).toHaveAttribute('aria-pressed', 'true');
    await expect(tuningSelect(page)).toBeEnabled();
    await expect(tuningSelect(page)).toHaveValue('open-g');
    await expect(page.locator('.tuner-targets')).toBeVisible();
    await expect(page.locator('.tuner-targets')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('.tuner-targets span')).toHaveCount(6);
    await expect(page.locator('.tuner-targets span').first()).toHaveText('6번 D2');
  });

  test('E-16 ⑦ 개방 6번 줄은 6번 줄(E2) 정확함으로 읽힌다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-string-1.wav');
    await openApp(page);
    await turnTunerOn(page);

    const reading = await waitForTuner(page, '정확함', 'E2');
    expect(reading.string).toBe('6번 줄(E2)');
    await expect(page.locator('.tuner-reading')).toHaveClass(/is-in-tune/);
    await expect(page.locator('.tuner-targets .is-target')).toHaveText('6번 E2');
  });

  test('E-16 ⑧ 휴대폰 화면에서도 옥타브 안내 문구가 넘치지 않는다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('tuner-e3.wav', PHONE);
    await openApp(page);
    await setMobileDock(page, true);
    await connectGuitar(page);
    await setMobileDock(page, true, 'meter');
    const toggle = page.locator('label.toggle-switch', { hasText: '튜너' });
    await toggle.click();
    await expect(toggle.locator('input')).toBeChecked();

    await waitForTuner(page, '6번 줄(E2)보다 한 옥타브 높습니다', 'E3');
    await expect(page.locator('.tuner-status-text')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const box = await page.locator('.tuner-reading').boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(PHONE.viewport.width);
  });
});
