// F-n 회귀 시험: 이미 고친 결함이 되살아나지 않는지 본다. 시험 제목 앞에 REFACTOR_LOG 의 결함 번호(F-n)를 적는다.
import type { Page } from '@playwright/test';
import { openApp, pedalSwitches } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { reachable } from '../helpers/geometry';
import { measureSwitches } from '../helpers/switches';
import { settledScroll, touchDrag } from '../helpers/touch';
import { knobKoName, pedalRegionName } from '../helpers/ko-names';

/** 그래픽 EQ 페달의 고정 대역 수(GraphicEQEffect 의 7밴드). 바꾸면 이 값과 시험을 같이 바꾼다. */
const GRAPHIC_EQ_FADERS = 7;

test.describe('F-1 그래픽 EQ 숫자 입력이 화면을 덮던 결함', () => {
  test('F-1 숫자 입력은 자기 칸 안에 머물고 포인터를 받지 않는다', async ({ page }) => {
    await openApp(page);
    const faders = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.vertical-fader')).map((fader) => {
        const number = fader.querySelector<HTMLElement>(':scope > input.knob-number-input');
        if (!number) return null;
        const box = fader.getBoundingClientRect();
        const rect = number.getBoundingClientRect();
        const style = getComputedStyle(number);
        return {
          position: style.position,
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          // 1 px 는 반올림 오차로 본다
          inside:
            rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1,
          size: { width: Math.round(rect.width), height: Math.round(rect.height), boxWidth: Math.round(box.width), boxHeight: Math.round(box.height) },
        };
      }),
    );
    expect(faders).toHaveLength(GRAPHIC_EQ_FADERS);
    for (const [index, fader] of faders.entries()) {
      expect(fader, `페이더 ${index + 1} 에 숫자 입력이 없다`).not.toBeNull();
      expect(fader, `페이더 ${index + 1}`).toMatchObject({ position: 'absolute', opacity: '0', pointerEvents: 'none', inside: true });
    }
  });

  test('F-1 키보드 포커스가 오면 숫자 입력이 드러나고, 벗어나면 다시 숨는다', async ({ page }) => {
    await openApp(page);
    const number = page.locator('.vertical-fader > input.knob-number-input').first();
    await expect(number).toHaveCSS('opacity', '0');
    await number.focus();
    await expect(number).toHaveCSS('opacity', '1');
    await expect(number).toHaveCSS('pointer-events', 'auto');
    await number.blur();
    await expect(number).toHaveCSS('opacity', '0');
    await expect(number).toHaveCSS('pointer-events', 'none');
  });

  // S4.4 부터 끌기는 레일(`[data-knob-drag]`)이 받고 레일 안의 투명 range 는 포인터를 받지 않는다(`pointer-events: none`).
  // 그래서 '숫자 입력이 레일을 덮지 않는다'는 레일의 가운데 점을 받는 것이 레일 자신(또는 그 안쪽 장식)이라는 것으로 본다.
  test('F-1 레일은 포인터를 받는다(숫자 입력이 덮지 않고, 드래그 대상이 유지된다)', async ({ page }) => {
    await openApp(page);
    const rails = page.locator('.vertical-fader-rail[data-knob-drag]');
    await expect(rails).toHaveCount(GRAPHIC_EQ_FADERS);
    for (let index = 0; index < GRAPHIC_EQ_FADERS; index += 1) {
      const result = await reachable(rails.nth(index));
      expect(result, `페이더 ${index + 1}`).toMatchObject({ reachable: true });
    }
  });

  test('F-1 모든 페달 스위치를 마우스로 누를 수 있다(데스크톱)', async ({ page }) => {
    await openApp(page);
    const report = await measureSwitches(page);
    expect(report.blockedBy).toEqual({});
    expect(report.reachable).toBe(report.count);

    // 실제 마우스 클릭: 위를 가린 요소가 있으면 Playwright 가 '다른 요소가 클릭을 받는다'며 실패한다.
    for (const target of [pedalSwitches(page).first(), pedalSwitches(page).last()]) {
      const before = await target.getAttribute('aria-pressed');
      await target.click({ timeout: 5_000 });
      await expect(target).not.toHaveAttribute('aria-pressed', before ?? '');
    }
  });
});

test.describe('F-3 페달 카드 위에서 시작한 터치 스크롤', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  /** 첫 페달 카드 안에서 컨트롤이 아닌 빈 자리(카드 가장자리) 두 곳. 컨트롤 위에서 시작하면 스크롤이 막히는 것이 정상이라 피한다. */
  async function passiveSpots(page: Page) {
    return page.evaluate(() => {
      const card = document.querySelector('.pedal-board .pedal-card');
      if (!card) throw new Error('페달 카드가 없다');
      const rect = card.getBoundingClientRect();
      const y = Math.round(Math.min(window.innerHeight - 200, rect.bottom - 20));
      return [Math.round(rect.left + 4), Math.round(rect.right - 4)].map((x) => {
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}` : 'null',
          inCard: Boolean(hit?.closest('.pedal-card')),
          interactive: Boolean(hit?.closest('button, input, select, textarea, a, [role="slider"], .drag-handle')),
        };
      });
    });
  }

  test('F-3 카드 가장자리에서 위로 끄는 터치가 문서를 세로로 스크롤한다', async ({ page }) => {
    await openApp(page);
    const documentOverflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(documentOverflow, '문서가 화면보다 충분히 길어야 시험이 의미가 있다').toBeGreaterThan(400);

    const [spot] = await passiveSpots(page);
    expect(spot, `시작 점이 카드 안의 빈 자리여야 한다(${spot.hit})`).toMatchObject({ inCard: true, interactive: false });

    expect((await settledScroll(page)).y).toBe(0);
    await touchDrag(page, { x: spot.x, y: spot.y }, { x: spot.x, y: spot.y - 300 });
    const after = await settledScroll(page);
    test.info().annotations.push({ type: 'F-3 세로 스크롤', description: `손가락 300 px → 문서 ${after.y} px` });
    // 예전(pan-x)에는 0 에 머물렀다. 손가락이 300 px 움직였으니 절반 이상은 따라와야 한다.
    expect(after.y).toBeGreaterThan(150);
  });

  test('F-3 카드 가장자리에서 옆으로 끄는 터치는 여전히 페달 보드를 가로로 넘긴다', async ({ page }) => {
    await openApp(page);
    const [, spot] = await passiveSpots(page);
    expect(spot, `시작 점이 카드 안의 빈 자리여야 한다(${spot.hit})`).toMatchObject({ inCard: true, interactive: false });

    expect((await settledScroll(page)).boardX).toBe(0);
    await touchDrag(page, { x: spot.x, y: spot.y }, { x: spot.x - 260, y: spot.y });
    const after = await settledScroll(page);
    test.info().annotations.push({ type: 'F-3 가로 스와이프', description: `손가락 260 px → 보드 ${after.boardX} px, 문서 ${after.y} px` });
    expect(after.boardX).toBeGreaterThan(100);
    expect(after.y, '가로로 끌었는데 문서가 세로로 움직이면 안 된다').toBeLessThan(40);
  });
});

// F-4(S1.8 에서 고침, REFACTOR_LOG L-55·L-77): 노브의 장식 층(링·바늘·가운데 캡)이 투명한 range 입력의 가운데를 덮어,
// 마우스로 노브 한가운데를 끌어도 값이 바뀌지 않았다. 데스크톱 화면의 range 입력 101개 중 13개였다.
// S4.4 부터 끌기는 노브의 껍데기(`[data-knob-drag]`)가 받고 투명 range 는 포인터를 받지 않는다(`pointer-events: none`).
// 그래서 '가운데 점을 받는 것'은 입력 자신이거나(껍데기가 없는 일반 슬라이더) 그 입력을 품은 끌기 껍데기의 안쪽이어야 한다.
test.describe('F-4 노브 가운데를 눌러도 끌기를 받는다', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('F-4 모든 노브 입력의 가운데 점을 받는 것은 입력 자신이거나 그 입력을 품은 끌기 껍데기다', async ({ page }) => {
    await openApp(page);
    const blocked = await page.evaluate(async () => {
      const found: string[] = [];
      for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('.pedal-board input[type="range"]'))) {
        input.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const rect = input.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const shell = input.closest('[data-knob-drag]');
        const receives = shell ? hit !== null && shell.contains(hit) : hit === input;
        if (!receives) {
          const card = input.closest('.pedal-card')?.getAttribute('aria-label') ?? '?';
          found.push(`${card} / ${input.getAttribute('aria-label') ?? '?'} ← ${hit ? `${hit.tagName.toLowerCase()}.${String((hit as HTMLElement).className)}` : 'null'}`);
        }
      }
      return found;
    });
    expect(blocked, '가운데 점을 끌기 껍데기(또는 일반 슬라이더 자신)가 받지 않는 노브').toEqual([]);
  });

  // 전에는 값이 그대로였던 노브들(장식 층 종류별로 하나씩): Noise Gate(`i` 캡), Chorus(공용 껍데기 바늘), Drive(튜브 껍데기), Reverb(리버브 껍데기).
  const knobs = [
    { card: 'Noise Gate', label: 'Threshold' },
    { card: 'Chorus', label: 'Rate' },
    { card: 'Drive', label: 'Tone' },
    { card: 'Reverb', label: 'Mix' },
  ] as const;
  for (const knob of knobs) {
    test(`F-4 ${knob.card} ${knob.label}: 마우스로 가운데를 위로 끌면 값이 바뀐다`, async ({ page }) => {
      await openApp(page);
      const input = page.locator(`.pedal-card[aria-label="${pedalRegionName(knob.card)}"] input[type="range"][aria-label="${knobKoName(knob.card, knob.label)}"]`);
      await input.scrollIntoViewIfNeeded();
      const box = await input.boundingBox();
      expect(box, `${knob.card} ${knob.label} 입력 상자`).not.toBeNull();
      const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
      const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
      const before = await input.inputValue();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - 40, { steps: 6 });
      await page.mouse.up();
      expect(await input.inputValue(), `${knob.card} ${knob.label}: 가운데를 끈 뒤의 값`).not.toBe(before);
    });
  }
});
