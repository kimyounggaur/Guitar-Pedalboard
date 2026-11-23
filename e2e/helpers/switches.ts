// 15개 페달 스위치의 도달성·노출 비율을 한꺼번에 재는 도우미(E-04, E-06 이 함께 쓴다).
import type { Page } from '@playwright/test';
import { pedalSwitches } from './app';
import { reachable, visibleRatio } from './geometry';

export interface SwitchReport {
  count: number;
  reachable: number;
  /** 닿은 스위치 ÷ 전체 (0~1) */
  reachableRatio: number;
  /** 닿지 않은 이유별 개수. 예: { covered: 15 } */
  reasons: Record<string, number>;
  /** 가운데 점을 대신 받은 요소별 개수. 예: { 'input.knob-number-input': 15 } */
  blockedBy: Record<string, number>;
  /** 보이는 비율의 평균·최솟값 (0~1, 화면 가운데로 스크롤한 뒤 표본 점으로 잰다) */
  visibleRatioMean: number;
  visibleRatioMin: number;
}

export async function measureSwitches(page: Page): Promise<SwitchReport> {
  const switches = pedalSwitches(page);
  const count = await switches.count();
  const reasons: Record<string, number> = {};
  const blockedBy: Record<string, number> = {};
  let reachableCount = 0;
  let ratioSum = 0;
  let ratioMin = 1;
  for (let index = 0; index < count; index += 1) {
    const target = switches.nth(index);
    const result = await reachable(target);
    if (result.reachable) reachableCount += 1;
    else {
      reasons[result.reason ?? 'unknown'] = (reasons[result.reason ?? 'unknown'] ?? 0) + 1;
      if (result.blockedBy) blockedBy[result.blockedBy] = (blockedBy[result.blockedBy] ?? 0) + 1;
    }
    const ratio = await visibleRatio(target, { scroll: 'center' });
    ratioSum += ratio;
    ratioMin = Math.min(ratioMin, ratio);
  }
  return {
    count,
    reachable: reachableCount,
    reachableRatio: count === 0 ? 0 : reachableCount / count,
    reasons,
    blockedBy,
    visibleRatioMean: count === 0 ? 0 : ratioSum / count,
    visibleRatioMin: count === 0 ? 0 : ratioMin,
  };
}

/**
 * 그래픽 EQ 세로 페이더 안의 숫자 입력이 페이지를 덮는 투명 입력이 되는 문제(REFACTOR_LOG F-1)를
 * 측정에서만 걷어 낸다. 레이아웃은 그대로 두고 포인터 이벤트만 통과시키므로,
 * 이 상태로 잰 값은 '겹침이 고쳐졌다면 도크·배치만의 영향'을 보여 준다.
 * 겹침이 고쳐진 뒤에도 해롭지 않다(해당 입력이 이미 작아졌어도 같은 값이 나온다).
 */
export async function ignoreHiddenFaderInputs(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.vertical-fader > input.knob-number-input { pointer-events: none !important; }' });
}

export function describeSwitchReport(report: SwitchReport): string {
  const blockers = Object.entries(report.blockedBy)
    .map(([name, count]) => `${name}×${count}`)
    .join(', ');
  return `스위치 ${report.reachable}/${report.count} 도달(${Math.round(report.reachableRatio * 100)}%), 평균 노출 ${Math.round(report.visibleRatioMean * 100)}%${blockers ? `, 가린 것: ${blockers}` : ''}`;
}
