// E-20 노브 조작(설계서 S4.4 수용 기준, 6.3절). 마우스·터치·키보드로 노브를 만져 본다.
//   ① 노브 위 아무 곳이나 눌렀다 떼기만(끌지 않음) 하면 값 변화 0 — 투명 range 의 '누른 자리로 값이 뛰는' 동작이 없다
//   ② 위로 100 px 끌면 범위의 50% 늘고, Shift 를 누르면 5%
//   ③ Delay 시간: 일반 끌기에서 1 px 당 ≤ 10 ms, Shift 에서 ≤ 1 ms ★(옛 33 ms)
//   ④ 값이 보이지 않는 조절기 0개(옛 16개)
//   ⑤ 휴대폰: 노브 위를 세로로 쓸면 페이지가 스크롤되고 값은 그대로, 가로로 끌면 조절된다(오른쪽 = 증가), 더블탭은 기본값
//   ⑥ 키보드(화살표·Home·End)와 더블클릭(기본값)은 그대로 된다 — 설계서 '키보드는 기존 range 유지'
// 터치는 CDP `Input.dispatchTouchEvent` 로 보낸다. 브라우저의 터치 동작 판정(touch-action)을 거치므로 CSS 가 잘못되면 여기서 드러난다.
import type { Locator, Page } from '@playwright/test';
import { openApp, PEDAL_COUNT } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { pedalGroup } from '../helpers/storage';

interface KnobSpec {
  /** 페달 이름(카드 `aria-label` 의 앞부분) */
  pedal: string;
  /** range 입력의 `aria-label` */
  label: string;
  min: number;
  max: number;
  step: number;
}

/** 시험하는 노브. 서로 다른 구현 4가지(Drive 전용 노브·Delay 전용 노브·공용 SliderControl·Compressor 전용 노브)를 고른다. */
const KNOBS: readonly KnobSpec[] = [
  { pedal: 'Drive', label: 'Drive', min: 0, max: 100, step: 1 },
  { pedal: 'Delay', label: 'D.Time', min: 20, max: 2000, step: 1 },
  { pedal: 'Reverb', label: 'Decay', min: 0.2, max: 6, step: 0.1 },
  { pedal: 'Compressor', label: 'Threshold', min: -60, max: -10, step: 1 },
];

function knobOf(page: Page, spec: KnobSpec): Locator {
  return pedalGroup(page, spec.pedal).locator(`input[type="range"][aria-label="${spec.label}"]`);
}

async function valueOf(knob: Locator): Promise<number> {
  return Number(await knob.inputValue());
}

async function centerOf(knob: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  if (!box) throw new Error('노브의 위치를 알 수 없습니다');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
}

/** 마우스로 노브를 위(+)·아래(-)로 `up` px 끈다. 10 px 씩 나눠 움직여 실제 끌기처럼 pointermove 가 여러 번 간다. */
async function dragKnob(page: Page, knob: Locator, up: number, options: { shift?: boolean; stepPx?: number } = {}): Promise<void> {
  const { x, y } = await centerOf(knob);
  await page.mouse.move(x, y);
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  const stepPx = options.stepPx ?? 10;
  const direction = up >= 0 ? 1 : -1;
  for (let moved = stepPx; moved < Math.abs(up); moved += stepPx) await page.mouse.move(x, y - direction * moved);
  await page.mouse.move(x, y - up);
  await page.mouse.up();
  if (options.shift) await page.keyboard.up('Shift');
}

function tolerance(spec: KnobSpec): number {
  return Math.max(spec.step, (spec.max - spec.min) * 0.01);
}

test.describe('E-20 노브 조작(마우스·키보드)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page);
  });

  test('E-20 ① 노브 위를 눌렀다 떼기만 하면 값이 바뀌지 않는다(가운데·가장자리 어디서나)', async ({ page }) => {
    for (const spec of KNOBS) {
      const knob = knobOf(page, spec);
      const before = await valueOf(knob);
      const { x, y, width, height } = await centerOf(knob);
      // 가운데, 네 가장자리 안쪽 3 px, 네 모서리 근처. 투명 range 라면 눌린 자리로 값이 뛴다(가장자리는 끝값).
      const spots = [
        [0, 0], [-width / 2 + 3, 0], [width / 2 - 3, 0], [0, -height / 2 + 3], [0, height / 2 - 3],
        [-width / 2 + 6, -height / 2 + 6], [width / 2 - 6, height / 2 - 6],
      ];
      for (const [dx, dy] of spots) {
        await page.mouse.click(x + dx, y + dy);
        expect(await valueOf(knob), `${spec.pedal} ${spec.label}: (${Math.round(dx)}, ${Math.round(dy)}) 를 눌렀다 뗐더니 값이 바뀜`).toBe(before);
      }
    }
  });

  test('E-20 ② 위로 100 px 끌면 범위의 50%, Shift 를 누르면 5% — 아래로 끌면 줄어든다', async ({ page }) => {
    for (const spec of KNOBS) {
      const knob = knobOf(page, spec);
      const range = spec.max - spec.min;
      await knob.focus();
      await page.keyboard.press('Home');
      expect(await valueOf(knob), `${spec.pedal} ${spec.label}: Home → 최솟값`).toBeCloseTo(spec.min, 5);

      await dragKnob(page, knob, 100);
      const half = (await valueOf(knob)) - spec.min;
      expect(Math.abs(half - range * 0.5), `${spec.pedal} ${spec.label}: 위로 100 px → 범위의 50%(받은 증가 ${half}, 범위 ${range})`).toBeLessThanOrEqual(tolerance(spec));

      await knob.focus();
      await page.keyboard.press('Home');
      await dragKnob(page, knob, 100, { shift: true });
      const fine = (await valueOf(knob)) - spec.min;
      expect(Math.abs(fine - range * 0.05), `${spec.pedal} ${spec.label}: Shift + 위로 100 px → 범위의 5%(받은 증가 ${fine}, 범위 ${range})`).toBeLessThanOrEqual(tolerance(spec));

      await knob.focus();
      await page.keyboard.press('End');
      await dragKnob(page, knob, -100);
      const down = spec.max - (await valueOf(knob));
      expect(Math.abs(down - range * 0.5), `${spec.pedal} ${spec.label}: 아래로 100 px → 범위의 50% 줄어듦(받은 감소 ${down})`).toBeLessThanOrEqual(tolerance(spec));
    }
  });

  test('E-20 ③ Delay 시간: 일반 끌기 1 px 당 ≤ 10 ms, Shift 에서 ≤ 1 ms ★', async ({ page }) => {
    const knob = knobOf(page, KNOBS[1]);
    await knob.focus();
    await page.keyboard.press('Home'); // 20 ms — 위로만 끌어도 범위 안
    const start = await valueOf(knob);
    await dragKnob(page, knob, 1, { stepPx: 1 });
    const onePx = (await valueOf(knob)) - start;
    expect(onePx, '일반 끌기 1 px 의 변화(ms)').toBeGreaterThan(0);
    expect(onePx, '일반 끌기 1 px 의 변화(ms). 옛 값 33 ms').toBeLessThanOrEqual(10);

    await knob.focus();
    await page.keyboard.press('Home');
    await dragKnob(page, knob, 1, { shift: true, stepPx: 1 });
    expect((await valueOf(knob)) - start, 'Shift 끌기 1 px 의 변화(ms)').toBeLessThanOrEqual(1);

    // 20 px 를 끌면 평균 1 px 당 얼마인가: 일반 ≈ 9.9 ms, Shift ≈ 1 ms 안쪽
    await knob.focus();
    await page.keyboard.press('Home');
    await dragKnob(page, knob, 20, { stepPx: 1 });
    const perPx = ((await valueOf(knob)) - start) / 20;
    expect(perPx, '일반 끌기 평균 ms/px').toBeLessThanOrEqual(10);
    expect(perPx, '일반 끌기가 너무 둔하지 않다(평균 ms/px)').toBeGreaterThanOrEqual(9);
    await knob.focus();
    await page.keyboard.press('Home');
    await dragKnob(page, knob, 20, { shift: true, stepPx: 1 });
    const finePerPx = ((await valueOf(knob)) - start) / 20;
    expect(finePerPx, 'Shift 끌기 평균 ms/px').toBeLessThanOrEqual(1);
    expect(finePerPx, 'Shift 끌기가 너무 둔하지 않다(평균 ms/px)').toBeGreaterThanOrEqual(0.8);
  });

  test('E-20 ③-2 끄는 도중에 Shift 를 눌러도 값이 튀지 않고 그 자리에서 정밀하게 이어진다', async ({ page }) => {
    const spec = KNOBS[0];
    const knob = knobOf(page, spec);
    await knob.focus();
    await page.keyboard.press('Home');
    const { x, y } = await centerOf(knob);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let moved = 10; moved <= 60; moved += 10) await page.mouse.move(x, y - moved);
    const before = await valueOf(knob); // 60 px → 30
    expect(before).toBeGreaterThanOrEqual(29);
    await page.keyboard.down('Shift');
    await page.mouse.move(x, y - 61);
    const afterShift = await valueOf(knob);
    expect(Math.abs(afterShift - before), 'Shift 를 누른 순간 값이 튀지 않는다').toBeLessThanOrEqual(1);
    // 정밀 상태로 40 px 더 끌면 범위의 2%(≈2)만 는다
    await page.mouse.move(x, y - 101);
    const fine = await valueOf(knob);
    expect(fine - before, 'Shift 로 40 px 더 끌면 2% 안팎').toBeLessThanOrEqual(3);
    expect(fine - before).toBeGreaterThanOrEqual(1);
    await page.keyboard.up('Shift');
    await page.mouse.up();
  });

  test('E-20 ④ 값이 보이지 않는 조절기가 0개다', async ({ page }) => {
    const report = await page.evaluate(() => {
      const hidden: string[] = [];
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.pedal-board .pedal-card input[type="range"]'));
      for (const input of inputs) {
        // 입력에서 위로 올라가며 처음 만나는 '값 글자(output)가 있는 묶음'을 찾는다. 그 묶음에는 이 입력 하나만 있어야 한다.
        let node: HTMLElement | null = input.parentElement;
        let found: HTMLOutputElement | null = null;
        while (node && !node.classList.contains('pedal-card')) {
          const outputs = node.querySelectorAll('output');
          if (outputs.length > 0) {
            if (node.querySelectorAll('input[type="range"]').length === 1) found = outputs[0];
            break;
          }
          node = node.parentElement;
        }
        const name = input.getAttribute('aria-label') ?? '(이름 없음)';
        const card = input.closest('.pedal-card')?.getAttribute('aria-label') ?? '';
        if (!found) { hidden.push(`${card} ${name}: 값 글자가 없다`); continue; }
        const rect = found.getBoundingClientRect();
        const style = getComputedStyle(found);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
        if (!visible) hidden.push(`${card} ${name}: 값 글자가 보이지 않는다`);
        else if ((found.textContent ?? '').trim() === '') hidden.push(`${card} ${name}: 값 글자가 비어 있다`);
      }
      return { total: inputs.length, hidden };
    });
    test.info().annotations.push({ type: '조절기 수', description: String(report.total) });
    expect(report.total, '조절기를 하나도 못 찾았다').toBeGreaterThan(PEDAL_COUNT);
    expect(report.hidden, `값이 보이지 않는 조절기 ${report.hidden.length}개`).toEqual([]);
  });

  test('E-20 ⑥ 키보드(화살표·Home·End)와 더블클릭(기본값)은 그대로 동작한다', async ({ page }) => {
    const spec = KNOBS[0];
    const knob = knobOf(page, spec);
    const defaultValue = await valueOf(knob);
    await knob.focus();
    await page.keyboard.press('ArrowUp');
    expect(await valueOf(knob)).toBe(defaultValue + spec.step);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await valueOf(knob)).toBe(defaultValue - spec.step);
    await page.keyboard.press('End');
    expect(await valueOf(knob)).toBe(spec.max);
    await page.keyboard.press('Home');
    expect(await valueOf(knob)).toBe(spec.min);

    await dragKnob(page, knob, 80);
    expect(await valueOf(knob)).not.toBe(defaultValue);
    const { x, y } = await centerOf(knob);
    await page.mouse.dblclick(x, y);
    expect(await valueOf(knob), '더블클릭하면 기본값으로 돌아온다').toBe(defaultValue);
  });
});

/** CDP 로 손가락 하나가 `from` 에서 `to` 까지 움직이게 한다(16 ms 마다 한 칸). */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
    });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await page.waitForTimeout(400); // 스크롤이 멎을 때까지
}

test.describe('E-20 ⑤ 휴대폰(터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  /** 첫 화면에 통째로 보이는 첫 노브(도크 위)의 번호와 가운데 */
  async function firstVisibleKnob(page: Page): Promise<{ index: number; x: number; y: number; label: string }> {
    const found = await page.evaluate(() => {
      const dock = document.querySelector('.mobile-control-dock');
      const bottom = dock ? Math.min(window.innerHeight, dock.getBoundingClientRect().top) : window.innerHeight;
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.pedal-board .pedal-card input[type="range"]'));
      for (const [index, input] of inputs.entries()) {
        const rect = input.getBoundingClientRect();
        if (rect.width > 0 && rect.top >= 0 && rect.bottom <= bottom - 20 && rect.left >= 0 && rect.right <= window.innerWidth) {
          return { index, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: input.getAttribute('aria-label') ?? '' };
        }
      }
      return null;
    });
    if (!found) throw new Error('첫 화면에 통째로 보이는 노브가 없습니다');
    return found;
  }

  const scrollTopOf = (page: Page) => page.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? window.scrollY));
  const boardScrollLeftOf = (page: Page) => page.evaluate(() => Math.round(document.querySelector('.pedal-board')?.scrollLeft ?? 0));

  test('E-20 ⑤-1 노브 위에서 세로로 쓸면 페이지가 스크롤되고 값은 그대로다', async ({ page }) => {
    const knobInfo = await firstVisibleKnob(page);
    const knob = page.locator('.pedal-board .pedal-card input[type="range"]').nth(knobInfo.index);
    const before = await valueOf(knob);
    const scrollBefore = await scrollTopOf(page);
    await swipe(page, { x: knobInfo.x, y: knobInfo.y }, { x: knobInfo.x + 4, y: knobInfo.y - 220 }, 16);
    expect(await scrollTopOf(page), `노브(${knobInfo.label}) 위에서 시작한 세로 쓸기가 페이지를 스크롤하지 않았다`).toBeGreaterThan(scrollBefore + 40);
    expect(await valueOf(knob), `노브(${knobInfo.label}) 위에서 세로로 쓸었더니 값이 바뀜`).toBe(before);
  });

  test('E-20 ⑤-2 노브 위에서 가로로 끌면 조절된다(오른쪽 = 증가) — 페이지·보드는 움직이지 않는다', async ({ page }) => {
    const knobInfo = await firstVisibleKnob(page);
    const knob = page.locator('.pedal-board .pedal-card input[type="range"]').nth(knobInfo.index);
    const min = Number(await knob.getAttribute('min'));
    const max = Number(await knob.getAttribute('max'));
    const range = max - min;
    await knob.focus();
    await page.keyboard.press('Home');
    const start = await valueOf(knob);
    const scrollBefore = await scrollTopOf(page);
    const boardBefore = await boardScrollLeftOf(page);

    // 노브(껍데기) 안에서 시작해 오른쪽으로 60 px(5 px 씩 12번). 방향을 가리는 데 쓴 첫 움직임(5~10 px)은 값에 반영하지 않으므로
    // 범위의 30% 보다 조금 적게(약 25%) 는다.
    await swipe(page, { x: knobInfo.x - 20, y: knobInfo.y }, { x: knobInfo.x + 40, y: knobInfo.y }, 12);
    const increased = (await valueOf(knob)) - start;
    expect(increased, `오른쪽으로 끌었더니 값이 늘어야 한다(범위 ${range})`).toBeGreaterThan(range * 0.2);
    expect(increased, '오른쪽 60 px 에 범위의 30% 를 넘지 않는다').toBeLessThanOrEqual(range * 0.32);
    expect(await scrollTopOf(page), '가로로 끌 때 페이지가 스크롤되지 않는다').toBe(scrollBefore);
    expect(await boardScrollLeftOf(page), '가로로 끌 때 페달 보드가 옆으로 넘어가지 않는다').toBe(boardBefore);

    const high = await valueOf(knob);
    await swipe(page, { x: knobInfo.x + 20, y: knobInfo.y }, { x: knobInfo.x - 20, y: knobInfo.y }, 8);
    expect(await valueOf(knob), '왼쪽으로 끌면 줄어든다').toBeLessThan(high);
  });

  test('E-20 ⑤-3 노브를 가볍게 한 번 누르는 것(탭)은 값을 바꾸지 않고, 두 번 누르면(더블탭) 기본값이 된다', async ({ page }) => {
    const knobInfo = await firstVisibleKnob(page);
    const knob = page.locator('.pedal-board .pedal-card input[type="range"]').nth(knobInfo.index);
    const defaultValue = await valueOf(knob);
    await page.touchscreen.tap(knobInfo.x, knobInfo.y);
    await page.waitForTimeout(500);
    expect(await valueOf(knob), '탭만으로 값이 바뀌지 않는다').toBe(defaultValue);

    await knob.focus();
    await page.keyboard.press('End');
    expect(await valueOf(knob)).not.toBe(defaultValue);
    await page.touchscreen.tap(knobInfo.x, knobInfo.y);
    await page.touchscreen.tap(knobInfo.x, knobInfo.y);
    await expect.poll(() => valueOf(knob), { message: '더블탭하면 기본값으로 돌아온다' }).toBe(defaultValue);
  });

  test('E-20 ⑤-4 포인터를 받는 곳은 끌기 껍데기: 노브는 pan-y, 세로 페이더는 none, 투명 range 는 포인터를 받지 않는다', async ({ page }) => {
    const report = await page.evaluate(() => {
      const wrong: string[] = [];
      const counts = { knobs: 0, faders: 0, native: 0, disabled: 0 };
      for (const input of document.querySelectorAll<HTMLInputElement>('.pedal-board .pedal-card input[type="range"]')) {
        const name = `${input.closest('.pedal-card')?.getAttribute('aria-label') ?? ''} ${input.getAttribute('aria-label')}`;
        const shell = input.closest<HTMLElement>('[data-knob-drag]');
        const transparent = Number(getComputedStyle(input).opacity) === 0;
        if (!shell) {
          // 껍데기가 없는 입력은 눈에 보이는 일반 슬라이더(Cab 컷·Graphic EQ Mix/Level)여야 한다. 안 보이는 range 가 껍데기 밖에 있으면 안 된다.
          counts.native += 1;
          if (transparent) wrong.push(`${name}: 투명한 range 인데 끌기 껍데기 밖에 있다`);
          continue;
        }
        if (getComputedStyle(input).pointerEvents !== 'none') wrong.push(`${name}: 껍데기 안의 range 가 포인터를 받는다(${getComputedStyle(input).pointerEvents})`);
        const fader = shell.matches('.vertical-fader-rail, .graphic-eq-slot');
        const expected = input.disabled ? 'auto' : fader ? 'none' : 'pan-y';
        if (input.disabled) counts.disabled += 1; else if (fader) counts.faders += 1; else counts.knobs += 1;
        const actual = getComputedStyle(shell).touchAction;
        if (actual !== expected) wrong.push(`${name}: 껍데기 touch-action ${actual}(기대 ${expected})`);
      }
      return { wrong, ...counts };
    });
    expect(report.knobs, '노브 수').toBeGreaterThan(40);
    expect(report.faders, '세로 페이더 수').toBeGreaterThan(0);
    expect(report.native, '일반 슬라이더 수(Cab 컷 등)').toBeGreaterThan(0);
    expect(report.wrong, '끌기 껍데기의 포인터 처리가 어긋난 조절기').toEqual([]);
  });
});
