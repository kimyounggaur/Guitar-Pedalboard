// 15개 페달 스위치의 도달성·노출 비율을 한꺼번에 재는 도우미(E-04, E-06 이 함께 쓴다).
import type { Page } from '@playwright/test';
import { pedalSwitches } from './app';
import { reachable, reachableAboveDock, visibleRatio } from './geometry';

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

export interface DockSwitchReport {
  count: number;
  reachable: number;
  /** 닿은 스위치 ÷ 전체 (0~1) */
  reachableRatio: number;
  /** 스크롤한 뒤 상자 전체가 도크 위 빈 영역 안에 들어온 스위치 수 */
  boxAboveDock: number;
  reasons: Record<string, number>;
  blockedBy: Record<string, number>;
  /** 스위치 상자 가운데 가장 작은 너비·높이(px). 터치 영역 ≥ 44×44 를 지키는지 본다. */
  minWidth: number;
  minHeight: number;
  /** 도크 위 빈 영역의 높이(px). 도크가 접혀 있으면 화면 높이에서 탭 줄을 뺀 값 */
  freeHeight: number;
  /** 닿지 않았거나 상자가 도크 위에 다 들어오지 않은 스위치의 번호(0 부터, 진단용) */
  failed: number[];
}

/**
 * 도크가 있는 화면(휴대폰)에서 15개 스위치의 도달성을 잰다. 스위치마다 reachableAboveDock 으로 '손가락으로 도크 위까지 스크롤해 가져온 뒤'를 본다.
 * 도크가 접혔든 펼쳐졌든 같은 방법이다(접힌 도크는 탭 줄만큼만 가린다).
 */
export async function measureSwitchesAboveDock(page: Page): Promise<DockSwitchReport> {
  const switches = pedalSwitches(page);
  const count = await switches.count();
  const reasons: Record<string, number> = {};
  const blockedBy: Record<string, number> = {};
  const failed: number[] = [];
  let reachableCount = 0;
  let boxAbove = 0;
  let minWidth = Number.POSITIVE_INFINITY;
  let minHeight = Number.POSITIVE_INFINITY;
  let freeHeight = 0;
  for (let index = 0; index < count; index += 1) {
    const result = await reachableAboveDock(switches.nth(index));
    freeHeight = result.freeHeight;
    minWidth = Math.min(minWidth, result.size.width);
    minHeight = Math.min(minHeight, result.size.height);
    if (result.boxAboveDock) boxAbove += 1;
    if (result.reachable) reachableCount += 1;
    else {
      reasons[result.reason ?? 'unknown'] = (reasons[result.reason ?? 'unknown'] ?? 0) + 1;
      if (result.blockedBy) blockedBy[result.blockedBy] = (blockedBy[result.blockedBy] ?? 0) + 1;
    }
    if (!result.reachable || !result.boxAboveDock) failed.push(index);
  }
  return {
    count,
    reachable: reachableCount,
    reachableRatio: count === 0 ? 0 : reachableCount / count,
    boxAboveDock: boxAbove,
    reasons,
    blockedBy,
    minWidth: Number.isFinite(minWidth) ? minWidth : 0,
    minHeight: Number.isFinite(minHeight) ? minHeight : 0,
    freeHeight,
    failed,
  };
}

export function describeDockSwitchReport(report: DockSwitchReport): string {
  const blockers = Object.entries(report.blockedBy)
    .map(([name, count]) => `${name}×${count}`)
    .join(', ');
  return `스위치 ${report.reachable}/${report.count} 도달(${Math.round(report.reachableRatio * 100)}%), 상자가 도크 위에 통째로 ${report.boxAboveDock}/${report.count}, 최소 ${report.minWidth}×${report.minHeight}px, 빈 영역 ${report.freeHeight}px${blockers ? `, 가린 것: ${blockers}` : ''}`;
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
