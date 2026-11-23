// F-n 회귀 시험: 이미 고친 결함이 되살아나지 않는지 본다. 시험 제목 앞에 REFACTOR_LOG 의 결함 번호(F-n)를 적는다.
import { openApp, pedalSwitches } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { reachable } from '../helpers/geometry';
import { measureSwitches } from '../helpers/switches';

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

  test('F-1 레일 안의 range 입력은 포인터를 받는다(드래그 대상이 유지된다)', async ({ page }) => {
    await openApp(page);
    const ranges = page.locator('.vertical-fader-rail input[type="range"]');
    await expect(ranges).toHaveCount(GRAPHIC_EQ_FADERS);
    for (let index = 0; index < GRAPHIC_EQ_FADERS; index += 1) {
      const result = await reachable(ranges.nth(index));
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
