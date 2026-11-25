// E-15 키보드 단축키(S2.11, 설계서 4.11·D13, 보고서 R2-12).
//   단축키는 물리 키(KeyboardEvent.code)로 판단한다. 한글 입력 상태에서 T 를 누르면 key 는 'ㅅ' 이지만 code 는 'KeyT' 이다.
//   ① 한글 입력 상태(key ㅅ·ㅁ·ㅠ, code KeyT·KeyA·KeyB)에서도 탭 템포·A/B 비교가 동작한다. 관계없는 한글 키는 가로채지 않는다.
//   ② 녹음 중 Esc(컨트롤에 포커스가 있어도) = 긴급 정지: 500 ms 안에 정리되고 녹음 파일이 남으며 길이 = 녹음 시간 ±0.5초.
//   ③ Shift + 1~6 = 10~15번째 페달(Chorus…Reverb). 윗줄 0 Q W E R Y 와 같은 페달이고, 한글 입력 상태에서도 같다. Shift + 7·0 은 아무 일도 없다.
//   ④ 도움말에 'Shift + 1–6' 이 보이고 표의 일곱 행이 그대로 그려진다. 도움말이 열려 있는 동안은 다른 키가 동작하지 않는다.
//   ⑤ 글자 입력 칸에 포커스가 있으면 단축키가 동작하지 않고, 입력 칸은 누른 글자를 그대로 받는다.
//   ⑥ 키를 누르고 있는 반복·Ctrl/⌘/Alt 조합·목록에 없는 키는 아무 일도 하지 않고 브라우저 기본 동작을 가로채지 않는다(preventDefault 없음).
// 한글 입력기가 보내는 이벤트는 Playwright 가 만들 수 없어(`keyboard.press` 는 key 를 영문으로 채운다) 같은 모양의 keydown 을 포커스된 요소에 직접 보낸다.
// 실제 한글 입력기(Windows·macOS)에서 눌러 보는 것은 사람 확인 항목이다(docs/baseline/README-e2e.md).
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { connectGuitar, openApp, panicButton } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { markTriggers, mockHowlGuard, trackAudioContexts } from '../helpers/mocks';
import { DEFAULT_ACTIVE_NAMES, PEDALS, stompOf } from '../helpers/storage';
import { waitForTeardown } from '../helpers/teardown';

/** 설계서 S1.2 수용 기준(E-01 과 같은 한계) */
const LIMIT_MS = 500;

interface KeyInit {
  key: string;
  code: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * 실제 키 입력처럼 지금 포커스된 요소(없으면 body)에 keydown 을 보내고, 앱이 그 키를 처리했는지(= preventDefault 를 불렀는지) 돌려준다.
 * 이벤트는 bubbles·cancelable·composed 이고 target 이 포커스된 요소라서, 컨트롤에 포커스가 있을 때 막히는 규칙도 그대로 지난다.
 */
async function sendKeydown(page: Page, init: KeyInit): Promise<boolean> {
  return page.evaluate((eventInit) => {
    const target = document.activeElement ?? document.body;
    const event = new KeyboardEvent('keydown', { ...eventInit, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
}

/** 포커스를 컨트롤에서 빼 단축키가 듣게 한다. */
async function blurFocus(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** 화면에 숨겨 둔 상태 낭독 줄('글로벌 템포 120 BPM, 탭 0회, 프리셋 비교 A 슬롯') */
const tempoStatus = (page: Page): Locator => page.getByRole('status').filter({ hasText: '글로벌 템포' });

/** 켜진(LED 켜짐) 페달 이름을 보드 순서대로 */
async function litNames(page: Page): Promise<string[]> {
  const pressed = await Promise.all(PEDALS.map(async ({ name }) => (await stompOf(page, name).getAttribute('aria-pressed')) === 'true'));
  return PEDALS.filter((_, index) => pressed[index]).map(({ name }) => name);
}

const inBoardOrder = (names: readonly string[]): string[] => PEDALS.map(({ name }) => name).filter((name) => names.includes(name));

/** Shift 를 누르면 key 는 기호가 된다(미국 배열 기준). 시험은 code 로만 판단하는지 보려고 일부러 기호를 같이 보낸다. */
const SHIFT_SYMBOLS = ['!', '@', '#', '$', '%', '^'] as const;
const LEGACY_CODES = ['Digit0', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyY'] as const;
/** 10~15번째 페달 */
const LAST_SIX = PEDALS.slice(9).map(({ name }) => name);

test.describe('E-15 키보드 단축키', () => {
  test('수용 기준 ①: 한글 입력 상태(key ㅅ·ㅁ·ㅠ)에서도 T 는 탭 템포, A·B 는 프리셋 비교 슬롯', async ({ page }) => {
    await openApp(page);
    await blurFocus(page);
    await expect(tempoStatus(page)).toContainText('탭 0회');

    // T 의 key 가 'ㅅ' 이어도, 조합 중(Process)이어도 물리 키가 KeyT 면 탭 템포다. 처리한 키라 preventDefault 도 불린다.
    expect(await sendKeydown(page, { key: 'ㅅ', code: 'KeyT' }), 'ㅅ(KeyT) 은 처리돼야 합니다').toBe(true);
    await expect(tempoStatus(page)).toContainText('탭 1회');
    expect(await sendKeydown(page, { key: 'Process', code: 'KeyT', isComposing: true }), '조합 중 KeyT 도 처리돼야 합니다').toBe(true);
    await expect(tempoStatus(page)).toContainText('탭 2회');
    // 영문 입력의 T 도 그대로 된다(달라진 것이 없다).
    await page.keyboard.press('KeyT');
    await expect(tempoStatus(page)).toContainText('탭 3회');
    // 관계없는 한글 키(ㅋ = X)는 아무 일도 없고 가로채지도 않는다.
    expect(await sendKeydown(page, { key: 'ㅋ', code: 'KeyX' }), '단축키가 아닌 한글 키는 가로채면 안 됩니다').toBe(false);
    await expect(tempoStatus(page)).toContainText('탭 3회');

    // A/B: A 슬롯에 현재(기본 5개 켜짐)를 담고, Delay 를 켠 채 B 슬롯에 담는다.
    await page.getByRole('button', { name: 'A←현재' }).click();
    await stompOf(page, 'Delay').click();
    await page.getByRole('button', { name: 'B←현재' }).click();
    const withDelay = inBoardOrder([...DEFAULT_ACTIVE_NAMES, 'Delay']);
    expect(await litNames(page)).toEqual(withDelay);
    await blurFocus(page);

    expect(await sendKeydown(page, { key: 'ㅁ', code: 'KeyA' }), 'ㅁ(KeyA) 은 A 슬롯을 켜야 합니다').toBe(true);
    await expect.poll(() => litNames(page), { message: 'ㅁ(KeyA): A 슬롯의 켜짐으로 돌아옴' }).toEqual(inBoardOrder(DEFAULT_ACTIVE_NAMES));
    await expect(page.getByRole('button', { name: 'A', exact: true })).toHaveAttribute('aria-pressed', 'true');

    expect(await sendKeydown(page, { key: 'ㅠ', code: 'KeyB', isComposing: true }), 'ㅠ(KeyB) 은 B 슬롯을 켜야 합니다').toBe(true);
    await expect.poll(() => litNames(page), { message: 'ㅠ(KeyB): B 슬롯의 켜짐으로 바뀜' }).toEqual(withDelay);
    await expect(page.getByRole('button', { name: 'B', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'A', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('수용 기준 ②: 녹음 중 Esc(버튼에 포커스가 있어도) = 긴급 정지 — 500 ms 안에 정리되고 녹음 파일이 남는다', async ({ page }) => {
    await trackAudioContexts(page);
    await markTriggers(page);
    await mockHowlGuard(page);
    await openApp(page);
    await connectGuitar(page);

    // 녹음 버튼을 눌러 시작한다 — 포커스는 버튼에 그대로 있다(연주 중 보통의 상태). 그래도 Esc 는 긴급 정지여야 한다.
    await page.getByRole('button', { name: '녹음', exact: true }).click();
    await expect(page.getByText(/녹음 중/)).toBeVisible();
    const recordStartedAt = await page.evaluate(() => (window as unknown as { __lastTrigger: number }).__lastTrigger);
    await page.waitForTimeout(3000);

    await page.keyboard.press('Escape');
    const escapeAt = await page.evaluate(() => (window as unknown as { __lastTrigger: number }).__lastTrigger);
    const { elapsedMs } = await waitForTeardown(page, LIMIT_MS);
    test.info().annotations.push({ type: 'elapsed', description: `녹음 중 Esc: ${Math.round(elapsedMs)} ms` });
    await expect(page.locator('.toast', { hasText: '긴급 정지했습니다. 마이크와 오디오를 모두 껐습니다. 녹음은 저장했습니다.' })).toBeVisible();
    await expect(panicButton(page)).toHaveCount(0);

    // 정지한 뒤에도 '다운로드' 가 켜져 있고, 받은 파일의 재생 길이가 녹음한 시간과 같다.
    const downloadButton = page.getByRole('button', { name: '다운로드' });
    await expect(downloadButton).toBeEnabled({ timeout: 5000 });
    const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
    expect(download.suggestedFilename()).toMatch(/\.(webm|m4a|mp4|ogg|wav)$/);
    const bytes = Array.from(readFileSync(await download.path()));
    expect(bytes.length).toBeGreaterThan(1000);
    const decodedSeconds = await page.evaluate(async (data: number[]) => {
      const context = new OfflineAudioContext(2, 48_000, 48_000);
      const buffer = await context.decodeAudioData(new Uint8Array(data).buffer);
      return buffer.duration;
    }, bytes);
    const expectedSeconds = (escapeAt - recordStartedAt) / 1000;
    test.info().annotations.push({ type: 'recording', description: `재생 길이 ${decodedSeconds.toFixed(2)} s, 녹음 시간 ${expectedSeconds.toFixed(2)} s` });
    expect(Math.abs(decodedSeconds - expectedSeconds)).toBeLessThanOrEqual(0.5);
  });

  test('수용 기준 ③: Shift + 1~6 은 10~15번째 페달(Chorus…Reverb) — 윗줄 0 Q W E R Y 와 같은 페달', async ({ page }) => {
    await openApp(page);
    await blurFocus(page);
    expect(await litNames(page), '처음에는 기본 5개만 켜져 있다').toEqual(inBoardOrder(DEFAULT_ACTIVE_NAMES));
    expect(LAST_SIX, '10~15번째 페달').toEqual(['Chorus', 'Flanger', 'Phaser', 'Tremolo', 'Delay', 'Reverb']);

    for (let offset = 0; offset < 6; offset += 1) {
      const name = LAST_SIX[offset];
      // Shift+숫자: 한 번 누르면 켜지고 한 번 더 누르면 꺼진다. 다른 페달은 그대로다.
      await page.keyboard.press(`Shift+Digit${offset + 1}`);
      await expect(stompOf(page, name), `Shift+${offset + 1} → ${name} 켜짐`).toHaveAttribute('aria-pressed', 'true');
      expect(await litNames(page)).toEqual(inBoardOrder([...DEFAULT_ACTIVE_NAMES, name]));
      await page.keyboard.press(`Shift+Digit${offset + 1}`);
      await expect(stompOf(page, name), `Shift+${offset + 1} 한 번 더 → ${name} 꺼짐`).toHaveAttribute('aria-pressed', 'false');
      expect(await litNames(page)).toEqual(inBoardOrder(DEFAULT_ACTIVE_NAMES));

      // 윗줄 키와 같은 페달: 윗줄 키로 켜고 Shift+숫자로 끈다.
      await page.keyboard.press(LEGACY_CODES[offset]);
      await expect(stompOf(page, name), `${LEGACY_CODES[offset]} → ${name} 켜짐`).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press(`Shift+Digit${offset + 1}`);
      await expect(stompOf(page, name), `Shift+${offset + 1} 로 ${LEGACY_CODES[offset]} 가 켠 ${name} 끄기`).toHaveAttribute('aria-pressed', 'false');
    }

    // 한글 입력 상태·기호 key(!@#$%^)에서도 물리 키로 알아본다. 처리한 키라 preventDefault 도 불린다.
    for (let offset = 0; offset < 6; offset += 1) {
      expect(await sendKeydown(page, { key: SHIFT_SYMBOLS[offset], code: `Digit${offset + 1}`, shiftKey: true, isComposing: offset % 2 === 1 })).toBe(true);
      await expect(stompOf(page, LAST_SIX[offset])).toHaveAttribute('aria-pressed', 'true');
    }
    expect(await litNames(page)).toEqual(inBoardOrder([...DEFAULT_ACTIVE_NAMES, ...LAST_SIX]));

    // Shift + 7, Shift + 0 은 페달이 아니다: 아무것도 바뀌지 않고 가로채지도 않는다.
    for (const code of ['Digit7', 'Digit0']) {
      expect(await sendKeydown(page, { key: code === 'Digit7' ? '&' : ')', code, shiftKey: true }), `Shift+${code} 는 가로채면 안 됩니다`).toBe(false);
    }
    expect(await litNames(page)).toEqual(inBoardOrder([...DEFAULT_ACTIVE_NAMES, ...LAST_SIX]));
  });

  test('수용 기준 ④: 도움말에 Shift + 1–6 이 보이고, 도움말이 열려 있는 동안은 다른 키가 동작하지 않는다', async ({ page }) => {
    await openApp(page);
    await blurFocus(page);
    await page.keyboard.press('Shift+Slash');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const labels = await dialog.locator('dt kbd').allTextContents();
    expect(labels).toEqual(['1–9 / 0 / Q W E R Y', 'Shift + 1–6', 'Space', 'T', 'A / B', 'Esc', '?']);
    const shiftRow = dialog.locator('dl > div').filter({ has: page.locator('kbd', { hasText: 'Shift + 1–6' }) });
    await expect(shiftRow.locator('dd')).toContainText('10–15번째 페달');
    await expect(dialog.locator('dl > div').filter({ has: page.locator('kbd', { hasText: /^Esc$/ }) }).locator('dd')).toContainText('녹음');

    // 도움말이 열려 있으면 Shift+1·1·T 는 아무 일도 하지 않는다.
    await page.keyboard.press('Shift+Digit1');
    await page.keyboard.press('Digit1');
    await page.keyboard.press('KeyT');
    await expect(tempoStatus(page)).toContainText('탭 0회');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await litNames(page), '도움말이 열려 있는 동안 페달이 바뀌면 안 됩니다').toEqual(inBoardOrder(DEFAULT_ACTIVE_NAMES));

    // 표에 적힌 대로 닫은 뒤에는 Shift+5 가 14번째(Delay) 페달을 켠다.
    await blurFocus(page);
    await page.keyboard.press('Shift+Digit5');
    await expect(stompOf(page, 'Delay')).toHaveAttribute('aria-pressed', 'true');
  });

  test('수용 기준 ⑤: 글자 입력 칸에 포커스가 있으면 단축키가 동작하지 않고 입력 칸은 글자를 그대로 받는다', async ({ page }) => {
    await openApp(page);
    const nameInput = page.getByLabel('프리셋 이름', { exact: true });
    await nameInput.fill('');
    await nameInput.focus();
    await expect(nameInput).toBeFocused();

    await page.keyboard.press('KeyT');
    await page.keyboard.press('Shift+Digit1');
    await page.keyboard.press('Space');
    await page.keyboard.press('KeyA');
    await page.keyboard.press('Digit4');
    // 눌린 글자가 그대로 입력 칸에 들어갔다(단축키가 가로채지 않았다).
    await expect(nameInput).toHaveValue('t! a4');
    // 한글 입력 상태의 T 도 입력 칸에서는 단축키가 아니다: 처리되지 않고(preventDefault 없음) 탭도 늘지 않는다.
    expect(await sendKeydown(page, { key: 'ㅅ', code: 'KeyT' }), '입력 칸의 ㅅ 은 가로채면 안 됩니다').toBe(false);
    expect(await sendKeydown(page, { key: '!', code: 'Digit1', shiftKey: true })).toBe(false);

    await expect(tempoStatus(page)).toContainText('탭 0회');
    expect(await litNames(page), '입력 칸에서 누른 키가 페달을 바꾸면 안 됩니다').toEqual(inBoardOrder(DEFAULT_ACTIVE_NAMES));
    await expect(page.locator('.toast')).toHaveCount(0);
  });

  test('수용 기준 ⑥: 키 반복·Ctrl/⌘/Alt 조합·목록에 없는 키는 아무 일도 하지 않고 기본 동작을 가로채지 않는다', async ({ page }) => {
    await openApp(page);
    await blurFocus(page);

    const ignored: Array<{ label: string; init: KeyInit }> = [
      { label: 'T 를 누르고 있는 반복', init: { key: 't', code: 'KeyT', repeat: true } },
      { label: '1 을 누르고 있는 반복', init: { key: '1', code: 'Digit1', repeat: true } },
      { label: 'Shift+1 을 누르고 있는 반복', init: { key: '!', code: 'Digit1', shiftKey: true, repeat: true } },
      { label: 'Ctrl+T', init: { key: 't', code: 'KeyT', ctrlKey: true } },
      { label: '⌘+1', init: { key: '1', code: 'Digit1', metaKey: true } },
      { label: 'Alt+Shift+1', init: { key: '¡', code: 'Digit1', altKey: true, shiftKey: true } },
      { label: 'Ctrl+Shift+3', init: { key: '#', code: 'Digit3', ctrlKey: true, shiftKey: true } },
      { label: 'Ctrl+A', init: { key: 'a', code: 'KeyA', ctrlKey: true } },
      { label: '목록에 없는 키 Z', init: { key: 'z', code: 'KeyZ' } },
      { label: '목록에 없는 키 Enter', init: { key: 'Enter', code: 'Enter' } },
      { label: 'Shift+T', init: { key: 'T', code: 'KeyT', shiftKey: true } },
    ];
    for (const { label, init } of ignored) {
      expect(await sendKeydown(page, init), `${label}: 처리하거나 가로채면 안 됩니다`).toBe(false);
    }
    await expect(tempoStatus(page)).toContainText('탭 0회');
    expect(await litNames(page)).toEqual(inBoardOrder(DEFAULT_ACTIVE_NAMES));
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 같은 키라도 반복이 아니면 처리한다(위 결과가 '키가 죽어서'가 아님을 확인).
    expect(await sendKeydown(page, { key: 't', code: 'KeyT' })).toBe(true);
    await expect(tempoStatus(page)).toContainText('탭 1회');
    expect(await sendKeydown(page, { key: '!', code: 'Digit1', shiftKey: true })).toBe(true);
    await expect(stompOf(page, 'Chorus')).toHaveAttribute('aria-pressed', 'true');
  });
});
