// E-04 휴대폰 도달성 — 정식 단언(설계서 S1.6, 6.3절). 15개 페달 스위치를 손가락이 누를 수 있는지 본다.
//   · 390×844 · 360×640 · 412×915 에서, 도크가 접힌 상태('페달' 탭)와 펼친 상태('입력'·'미터'·'프리셋' 탭 각각)에서 15개 모두 도달,
//   · 스위치 상자는 44×44 px 이상, 390×844 첫 화면에는 페달 노브가 2개 이상 통째로 보임,
//   · 도크를 펼친 채 문서 끝까지 스크롤하면 마지막 페달의 아래쪽 끝이 도크 위로 나옴.
// '도달'은 손가락이 페이지를 스크롤해 스위치를 도크에 가려지지 않는 영역으로 가져온 뒤 가운데 점을 누를 수 있는가다(reachableAboveDock).
// S0.4 에서는 이 시험이 '고치기 전' 값(도달 0%)만 기록했고, S1.6 이 판정으로 바꿨다. 값은 지금도 기준선(docs/baseline/e2e.json)에 남긴다
// (E2E_UPDATE_BASELINE=1 일 때만 갱신). 스크롤이 막히던 F-3, 투명 입력이 덮던 F-1 의 개별 회귀는 f-regressions.spec.ts 가 지킨다.
import type { Page } from '@playwright/test';
import { openApp, PEDAL_COUNT, setMobileDock, type MobileTab } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { visibleKnobs } from '../helpers/geometry';
import { recordMeasurement, recordScreenshot } from '../helpers/record';
import { PHONE_PROFILES } from '../helpers/screens';
import { describeDockSwitchReport, measureSwitchesAboveDock, type DockSwitchReport } from '../helpers/switches';

/** 설계서 S1.6 수용 기준: 스위치 터치 영역 */
const MIN_TOUCH_PX = 44;
/** 설계서 S1.6 수용 기준: 390×844 첫 화면에서 통째로 보여야 하는 노브 수 */
const MIN_FIRST_SCREEN_KNOBS = 2;
/** 펼침 상태로 점검하는 탭. 패널 높이가 탭마다 달라 도크 높이도 달라진다. */
const EXPANDED_TABS = ['input', 'meter', 'preset'] as const satisfies readonly MobileTab[];

function expectAllReachable(report: DockSwitchReport, label: string): void {
  expect(report.count, `${label}: 페달 스위치 수`).toBe(PEDAL_COUNT);
  expect(report.failed, `${label}: 닿지 않았거나 도크 위에 다 들어오지 않은 스위치 번호 — ${describeDockSwitchReport(report)}`).toEqual([]);
  expect(report.reachable, `${label}: ${describeDockSwitchReport(report)}`).toBe(PEDAL_COUNT);
  expect(report.boxAboveDock, `${label}: 상자가 도크 위에 통째로 들어온 스위치`).toBe(PEDAL_COUNT);
  expect(report.minWidth, `${label}: 가장 좁은 스위치`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  expect(report.minHeight, `${label}: 가장 낮은 스위치`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
}

/**
 * 문서 맨 끝까지 스크롤하고(마지막 페달 카드가 보이게 보드도 끝으로 넘긴다) 마지막 페달 카드의 아래쪽 끝이 도크 위쪽 끝보다 위에 있는지 잰다.
 * 카드들은 높이가 같아(grid stretch) 아래쪽 끝이 같다. 양수면 그만큼 도크 위로 올라와 있다.
 */
async function lastPedalGapAboveDock(page: Page): Promise<{ gap: number; cardBottom: number; dockTop: number; scrolled: number }> {
  return page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const board = document.querySelector<HTMLElement>('.pedal-board');
    const cards = document.querySelectorAll('.pedal-board .pedal-card');
    const dock = document.querySelector('.mobile-control-dock');
    if (!board || cards.length === 0 || !dock) throw new Error('페달보드나 도크가 없다');
    board.scrollLeft = board.scrollWidth;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior });
    await frame();
    await frame();
    const last = cards[cards.length - 1].getBoundingClientRect();
    const dockTop = dock.getBoundingClientRect().top;
    return { gap: Math.round((dockTop - last.bottom) * 10) / 10, cardBottom: Math.round(last.bottom * 10) / 10, dockTop: Math.round(dockTop * 10) / 10, scrolled: Math.round(window.scrollY) };
  });
}

for (const screen of PHONE_PROFILES) {
  test.describe(`E-04 휴대폰 ${screen.name}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height }, isMobile: true, hasTouch: true });

    test(`E-04 ${screen.name} 도크 접힘: 15개 스위치에 모두 도달하고 첫 화면에 노브가 보인다`, async ({ page }) => {
      await openApp(page);
      // 처음에는 '페달' 탭이 선택되어 도크가 접혀 있다(탭 줄만 보인다).
      await expect(page.locator('#mobile-tab-pedals')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#mobile-control-panels')).toBeHidden();
      await setMobileDock(page, false);

      // 첫 화면(스크롤하기 전)에서 노브가 통째로 보이는가.
      const firstScreen = await visibleKnobs(page);
      await recordScreenshot(page, { id: 'E-04', profile: screen.name, condition: 'dock-collapsed' });
      test.info().annotations.push({ type: '첫 화면 노브', description: `${firstScreen.fullyVisible}/${firstScreen.total} (${firstScreen.labels.join(', ')})` });
      if (screen.name === '390x844') {
        expect(firstScreen.fullyVisible, `390×844 첫 화면에서 통째로 보이는 노브(${firstScreen.labels.join(', ')})`).toBeGreaterThanOrEqual(MIN_FIRST_SCREEN_KNOBS);
      }

      const report = await measureSwitchesAboveDock(page);
      const end = await lastPedalGapAboveDock(page);
      recordMeasurement({
        id: 'E-04',
        profile: screen.name,
        condition: 'dock-collapsed',
        summary: `${describeDockSwitchReport(report)}, 첫 화면 노브 ${firstScreen.fullyVisible}개, 끝까지 스크롤 시 마지막 페달 아래끝이 도크 위 ${end.gap}px`,
        values: { ...report, firstScreenKnobs: firstScreen.fullyVisible, lastPedalGapAboveDock: end.gap },
      });
      expectAllReachable(report, `${screen.name} 도크 접힘`);
      expect(end.gap, `끝까지 스크롤했을 때 마지막 페달 아래끝(${end.cardBottom})이 도크 위쪽 끝(${end.dockTop}) 위에 있어야 한다`).toBeGreaterThanOrEqual(0);
    });

    test(`E-04 ${screen.name} 도크 펼침: 탭마다 15개 스위치에 모두 도달하고 끝까지 스크롤하면 마지막 페달이 도크 위로 나온다`, async ({ page }) => {
      await openApp(page);
      const perTab: Record<string, { reachable: number; boxAboveDock: number; dockHeight: number; lastPedalGapAboveDock: number }> = {};

      for (const tab of EXPANDED_TABS) {
        await setMobileDock(page, true, tab);
        await expect(page.locator(`#mobile-panel-${tab}`)).toBeVisible();
        const dockHeight = await page.evaluate(() => document.querySelector('.mobile-control-dock')?.getBoundingClientRect().height ?? 0);
        expect(dockHeight, `${tab} 탭: 펼친 도크는 화면 높이의 50% 이하`).toBeLessThanOrEqual(screen.height * 0.5 + 1);

        if (tab === 'input') {
          // 대표 스크린샷·기준선 값은 '입력' 탭(펼침의 기본)으로 남긴다. 스크롤하기 전 첫 화면을 찍는다.
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
          await recordScreenshot(page, { id: 'E-04', profile: screen.name, condition: 'dock-expanded' });
        }
        const report = await measureSwitchesAboveDock(page);
        const end = await lastPedalGapAboveDock(page);
        perTab[tab] = { reachable: report.reachable, boxAboveDock: report.boxAboveDock, dockHeight: Math.round(dockHeight), lastPedalGapAboveDock: end.gap };
        test.info().annotations.push({ type: `펼침 ${tab}`, description: `${describeDockSwitchReport(report)}, 도크 ${Math.round(dockHeight)}px, 마지막 페달 아래끝이 도크 위 ${end.gap}px` });
        if (tab === 'input') {
          recordMeasurement({
            id: 'E-04',
            profile: screen.name,
            condition: 'dock-expanded',
            summary: `${describeDockSwitchReport(report)}, 도크 ${Math.round(dockHeight)}px, 끝까지 스크롤 시 마지막 페달 아래끝이 도크 위 ${end.gap}px`,
            values: { ...report, dockHeight: Math.round(dockHeight), lastPedalGapAboveDock: end.gap, tabs: perTab },
          });
        }
        expectAllReachable(report, `${screen.name} 도크 펼침(${tab} 탭)`);
        expect(end.gap, `${tab} 탭을 펼친 채 끝까지 스크롤: 마지막 페달 아래끝(${end.cardBottom})이 도크 위쪽 끝(${end.dockTop}) 위에 있어야 한다`).toBeGreaterThanOrEqual(0);
      }

      // 같은 탭을 다시 누르면 접히고, 접힌 상태에서도 여전히 모두 닿는다(펼침 → 접힘 전환 뒤 --dock-h 가 줄어든다).
      await page.locator('#mobile-tab-preset').click();
      await expect(page.locator('#mobile-tab-pedals')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#mobile-control-panels')).toBeHidden();
      expectAllReachable(await measureSwitchesAboveDock(page), `${screen.name} 펼침 → 다시 눌러 접은 뒤`);
    });
  });
}
