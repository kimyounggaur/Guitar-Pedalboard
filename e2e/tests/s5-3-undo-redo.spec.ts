// S5.3 실행 취소·다시 실행(설계서 5.5 S5.3, RX-3). 실제 브라우저에서 키보드로 되돌린다.
//   ① 노브를 끌고 나서 Ctrl+Z 한 번이면 처음 값이다 — 끌다가 길게 멈춰도(전에는 350 ms 만 넘으면 두 단계로 갈라졌다) 한 번이다 ★(수용 기준)
//   ② 끌기 두 번은 두 단계다(연달아 끌어도 섞이지 않는다)
//   ③ 포커스가 노브(range 입력)·프리셋 버튼에 남아 있어도 단축키가 통한다 — 끌고 난 뒤 포커스가 바로 거기다(전에는 막혀 아무 일도 없었다)
//   ④ 단축키는 `code` 기준이다: 한글 자판(key 가 'ㅋ')에서도 되고, Ctrl 과 ⌘ 모두 되고, Shift 를 더하면 다시 실행이다. Alt 가 끼거나 글자 키만이면 무시한다
//   ⑤ 프리셋 불러오기도 되돌린다(페달 전부 + 음량 보정) ★(수용 기준)
//   ⑥ 글자 입력 칸 안의 Ctrl+Z 는 그 칸의 일이다 — 페달을 되돌리지 않는다. 끌고 있는 도중의 Ctrl+Z 는 무시한다
//   ⑦ 끌던 노브가 사라져 끝 신호를 못 받아도 끌기가 영원히 열려 있지 않다 — 포인터가 끝나면 창 전체의 안전장치가 닫는다
// 50단계 한도·묶기 규칙의 모든 경우는 Node 시험(test:history), 소리에 클릭이 없는지는 test:chain-fade 가 본다.
import type { Locator, Page } from '@playwright/test';
import { openApp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { pedalGroup } from '../helpers/storage';
import { knobKoName } from '../helpers/ko-names';

interface KeyInit {
  key: string;
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const driveKnob = (page: Page): Locator => pedalGroup(page, 'Drive').locator(`input[type="range"][aria-label="${knobKoName('Drive', 'Drive')}"]`);
const undoButton = (page: Page): Locator => page.getByRole('button', { name: '실행 취소' });
const redoButton = (page: Page): Locator => page.getByRole('button', { name: '다시 실행' });
const trimValue = (page: Page): Locator => page.getByTestId('preset-trim-value');

const valueOf = async (knob: Locator): Promise<number> => Number(await knob.inputValue());

/** 노브를 마우스로 `up` px 위로 끈다. `pauseAtPx` 에 닿으면 마우스를 누른 채 `pauseMs` 동안 멈춘다. */
async function dragKnob(page: Page, knob: Locator, up: number, options: { pauseAtPx?: number; pauseMs?: number } = {}): Promise<void> {
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  if (!box) throw new Error('노브의 위치를 알 수 없습니다');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let moved = 10; moved <= up; moved += 10) {
    await page.mouse.move(x, y - moved);
    if (options.pauseAtPx !== undefined && moved === options.pauseAtPx) await page.waitForTimeout(options.pauseMs ?? 0);
  }
  await page.mouse.up();
}

/** 지금 포커스된 요소(없으면 body)에 keydown 을 보내고 앱이 그 키를 처리했는지(preventDefault)를 돌려준다. 키보드 자판 배열과 상관없이 key·code 를 직접 정한다. */
async function sendKeydown(page: Page, init: KeyInit): Promise<boolean> {
  return page.evaluate((eventInit) => {
    const target = document.activeElement ?? document.body;
    const event = new KeyboardEvent('keydown', { ...eventInit, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
}

const UNDO_CTRL: KeyInit = { key: 'z', code: 'KeyZ', ctrlKey: true };
const REDO_CTRL: KeyInit = { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true };

test.describe('S5.3 실행 취소·다시 실행', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page);
  });

  test('수용 기준 ①: 노브를 끌다 길게 멈춰도 Ctrl+Z 한 번이면 처음 값이고, Shift+Ctrl+Z 는 끝 값이다 — 포커스는 노브에 남아 있다', async ({ page }) => {
    const knob = driveKnob(page);
    const start = await valueOf(knob);
    await expect(undoButton(page)).toBeDisabled();

    // 끌다가 마우스를 누른 채 700 ms 멈추고(옛 묶기 시간 350 ms 의 두 배) 다시 끈다.
    await dragKnob(page, knob, 100, { pauseAtPx: 50, pauseMs: 700 });
    const end = await valueOf(knob);
    expect(end, '끌었더니 값이 바뀌어야 한다').not.toBe(start);
    expect(await page.evaluate(() => `${document.activeElement?.tagName}:${(document.activeElement as HTMLInputElement | null)?.type}`), '끌고 난 뒤 포커스는 노브의 range 입력').toBe('INPUT:range');

    await page.keyboard.press('Control+KeyZ');
    await expect.poll(() => valueOf(knob), { message: 'Ctrl+Z 한 번에 처음 값으로' }).toBe(start);
    await expect(undoButton(page), '끌기 한 번뿐이었으니 더 되돌릴 것이 없다').toBeDisabled();
    await expect(redoButton(page)).toBeEnabled();

    await page.keyboard.press('Control+Shift+KeyZ');
    await expect.poll(() => valueOf(knob), { message: 'Shift+Ctrl+Z 한 번에 끝 값으로' }).toBe(end);
    await expect(redoButton(page)).toBeDisabled();
  });

  test('수용 기준 ②: 같은 노브를 두 번 끌면 두 단계다 — 사이가 아주 짧아도 섞이지 않는다', async ({ page }) => {
    const knob = driveKnob(page);
    const start = await valueOf(knob);
    await dragKnob(page, knob, 40);
    const first = await valueOf(knob);
    await dragKnob(page, knob, 40);
    const second = await valueOf(knob);
    expect(first).toBeGreaterThan(start);
    expect(second).toBeGreaterThan(first);

    await page.keyboard.press('Control+KeyZ');
    await expect.poll(() => valueOf(knob)).toBe(first);
    await page.keyboard.press('Control+KeyZ');
    await expect.poll(() => valueOf(knob)).toBe(start);
    await expect(undoButton(page)).toBeDisabled();
  });

  test('수용 기준 ④: 단축키는 code 기준 — 한글 자판·Ctrl·⌘ 모두 되고, Alt 가 끼거나 글자 키만이면 무시한다', async ({ page }) => {
    const knob = driveKnob(page);
    const start = await valueOf(knob);
    await dragKnob(page, knob, 60);
    const end = await valueOf(knob);

    // 한글 자판: key 가 'ㅋ' 이어도 code 가 KeyZ 면 실행 취소.
    expect(await sendKeydown(page, { key: 'ㅋ', code: 'KeyZ', ctrlKey: true }), '한글 자판 Ctrl+Z 를 처리했다').toBe(true);
    await expect.poll(() => valueOf(knob)).toBe(start);
    // ⌘+Shift+Z(맥): 다시 실행.
    expect(await sendKeydown(page, { key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }), '⌘+Shift+Z 를 처리했다').toBe(true);
    await expect.poll(() => valueOf(knob)).toBe(end);
    // ⌘+Z: 실행 취소.
    expect(await sendKeydown(page, { key: 'z', code: 'KeyZ', metaKey: true })).toBe(true);
    await expect.poll(() => valueOf(knob)).toBe(start);
    // Ctrl+Y: 다시 실행(윈도우 관습).
    expect(await sendKeydown(page, { key: 'y', code: 'KeyY', ctrlKey: true })).toBe(true);
    await expect.poll(() => valueOf(knob)).toBe(end);

    // 무시해야 하는 것: 글자 키 Z 만, Alt 가 낀 Ctrl+Alt+Z, 누르고 있는 반복. 값이 그대로여야 하고 키를 가로채지도 않는다.
    for (const [label, init] of [
      ['Z 만', { key: 'z', code: 'KeyZ' }],
      ['Ctrl+Alt+Z', { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true }],
    ] as const) {
      expect(await sendKeydown(page, init), `${label}: 가로채면 안 된다`).toBe(false);
      expect(await valueOf(knob), `${label}: 값이 바뀌면 안 된다`).toBe(end);
    }
  });

  test('수용 기준 ⑤: 프리셋 불러오기도 되돌린다 — 포커스가 프리셋 버튼에 있어도 Ctrl+Z, 페달과 음량 보정이 함께 돌아온다', async ({ page }) => {
    const knob = driveKnob(page);
    const driveBefore = await valueOf(knob);
    const trimBefore = (await trimValue(page).textContent())?.trim() ?? '';

    await page.locator('.preset-load-button', { hasText: 'Texas Push' }).click();
    await expect(trimValue(page)).not.toHaveText(trimBefore);
    const trimAfter = (await trimValue(page).textContent())?.trim() ?? '';
    const driveAfter = await valueOf(knob);
    expect(driveAfter, 'Texas Push 는 Drive 가 다르다').not.toBe(driveBefore);
    expect(await page.evaluate(() => document.activeElement?.className ?? ''), '포커스는 불러오기 버튼에 있다').toContain('preset-load-button');

    await page.keyboard.press('Control+KeyZ');
    await expect.poll(() => valueOf(knob), { message: '페달이 돌아온다' }).toBe(driveBefore);
    await expect(trimValue(page), '음량 보정도 돌아온다').toHaveText(trimBefore);
    await expect(undoButton(page), '프리셋 불러오기는 한 단계였다').toBeDisabled();

    await page.keyboard.press('Control+Shift+KeyZ');
    await expect.poll(() => valueOf(knob)).toBe(driveAfter);
    await expect(trimValue(page)).toHaveText(trimAfter);
  });

  test('수용 기준 ⑥: 글자 입력 칸 안의 Ctrl+Z 는 페달을 건드리지 않고, 끌고 있는 도중의 Ctrl+Z 도 무시한다', async ({ page }) => {
    const knob = driveKnob(page);
    const start = await valueOf(knob);
    await dragKnob(page, knob, 60);
    const end = await valueOf(knob);

    // 프리셋 이름 칸에 글자를 쓰고 그 안에서 Ctrl+Z: 칸이 쓰는 키라 페달은 그대로.
    const nameInput = page.getByLabel('프리셋 이름', { exact: true });
    await nameInput.scrollIntoViewIfNeeded();
    await nameInput.fill('실행취소');
    expect(await sendKeydown(page, UNDO_CTRL), '글자 칸 안에서는 앱이 가로채지 않는다').toBe(false);
    expect(await sendKeydown(page, REDO_CTRL)).toBe(false);
    expect(await valueOf(knob), '글자 칸 안의 Ctrl+Z 가 페달을 되돌렸다').toBe(end);

    // 포커스를 빼면 같은 키가 통한다.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await sendKeydown(page, UNDO_CTRL)).toBe(true);
    await expect.poll(() => valueOf(knob)).toBe(start);

    // 끌고 있는 도중: 마우스를 누른 채 Ctrl+Z 는 아무 일도 하지 않고, 놓은 뒤에는 끌기 한 번이 한 번에 돌아온다.
    await knob.scrollIntoViewIfNeeded();
    const box = await knob.boundingBox();
    if (!box) throw new Error('노브의 위치를 알 수 없습니다');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let moved = 10; moved <= 50; moved += 10) await page.mouse.move(x, y - moved);
    const dragging = await valueOf(knob);
    expect(dragging).not.toBe(start);
    await page.keyboard.press('Control+KeyZ');
    await page.mouse.move(x, y - 60);
    expect(await valueOf(knob), '끌던 값이 이어진다(되돌려져 어긋나지 않는다)').toBeGreaterThan(dragging);
    await page.mouse.up();
    await page.keyboard.press('Control+KeyZ');
    await expect.poll(() => valueOf(knob)).toBe(start);
  });

  test('수용 기준 ⑦: 끌던 노브가 화면에서 사라져 끝 신호를 못 받아도, 포인터를 놓으면 끌기가 닫혀 실행 취소가 다시 된다', async ({ page }) => {
    const knob = driveKnob(page);
    await knob.scrollIntoViewIfNeeded();
    const box = await knob.boundingBox();
    if (!box) throw new Error('노브의 위치를 알 수 없습니다');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let moved = 10; moved <= 40; moved += 10) await page.mouse.move(x, y - moved);
    await expect(undoButton(page)).toBeEnabled();
    // 끌고 있던 노브의 껍데기를 DOM 에서 떼어 낸다 — 그 노브의 pointerup·lostpointercapture 처리기는 더 이상 불리지 않는다.
    await knob.evaluate((input) => input.closest('[data-knob-drag]')?.remove());
    await page.mouse.up();
    await page.keyboard.press('Control+KeyZ');
    await expect(undoButton(page), '끌기가 닫혀 있어야 Ctrl+Z 가 통해 기록이 비어진다').toBeDisabled();
  });
});
