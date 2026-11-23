// 화면 기하(幾何) 측정 도우미: 손가락·마우스가 닿는가, 얼마나 보이는가, 글자가 겹치는가.
// 모두 브라우저 안(page.evaluate)에서 실제 렌더 결과를 읽는다. 앱 코드는 건드리지 않는다.
import type { Locator } from '@playwright/test';

export type ReachFailure = 'hidden' | 'zero-size' | 'offscreen' | 'covered';

export interface ReachResult {
  reachable: boolean;
  /** 닿지 않은 이유. 닿으면 undefined */
  reason?: ReachFailure;
  /** 가운데 점을 대신 받은 요소(예: 'div.mobile-control-dock'). reason 이 'covered' 일 때만 */
  blockedBy?: string;
  /** 스크롤한 뒤 요소의 가운데 점(뷰포트 기준 px) */
  point?: { x: number; y: number };
}

export interface VisibleRatioOptions {
  /** 'center'(기본): 요소를 화면 가운데로 스크롤한 뒤 잰다. 'none': 지금 스크롤 위치 그대로 잰다. */
  scroll?: 'center' | 'none';
  /** 가로·세로 표본 점 수(기본 12 → 144점) */
  samples?: number;
}

export interface OverlapPair {
  a: string;
  b: string;
  /** 겹친 영역 크기(px) */
  width: number;
  height: number;
}

export interface OverlapReport {
  /** 서로 다른 글자 덩어리 상자끼리 겹친 쌍의 수 */
  count: number;
  /** 검사한 글자 상자 수 */
  boxes: number;
  /** 앞쪽 몇 쌍(진단용) */
  pairs: OverlapPair[];
}

/**
 * 도달성: 요소를 화면 가운데로 스크롤한 뒤 그 가운데 점의 `document.elementFromPoint` 가
 * 그 요소(또는 자손)인지 본다. 다른 요소가 위를 덮거나 화면 밖이면 닿지 않는 것으로 센다.
 * `pointer-events: none` 인 요소는 elementFromPoint 가 건너뛰므로 역시 닿지 않는 것으로 나온다.
 */
export async function reachable(locator: Locator): Promise<ReachResult> {
  return locator.evaluate(async (element): Promise<ReachResult> => {
    const describe = (node: Element | null): string => {
      if (!node) return 'null';
      const className = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
      return `${node.tagName.toLowerCase()}${className ? `.${className}` : ''}`;
    };
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || element.closest('[hidden]')) {
      return { reachable: false, reason: 'hidden' };
    }
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { reachable: false, reason: 'zero-size' };
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (point.x < 0 || point.y < 0 || point.x >= window.innerWidth || point.y >= window.innerHeight) {
      return { reachable: false, reason: 'offscreen', point };
    }
    const hit = document.elementFromPoint(point.x, point.y);
    if (hit && (hit === element || element.contains(hit))) return { reachable: true, point };
    return { reachable: false, reason: 'covered', blockedBy: describe(hit), point };
  });
}

/**
 * 보이는 비율: 요소 상자 안의 표본 점 가운데, 뷰포트 안에 있고 다른 요소가 덮지 않은 점의 비율(0~1).
 * 뷰포트 밖에 걸친 부분과 위를 덮는 요소가 있는 부분은 보이지 않는 것으로 센다.
 */
export async function visibleRatio(locator: Locator, options: VisibleRatioOptions = {}): Promise<number> {
  const scroll = options.scroll ?? 'center';
  const samples = Math.max(2, options.samples ?? 12);
  return locator.evaluate(
    async (element, { scrollMode, sampleCount }) => {
      if (scrollMode === 'center') {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return 0;
      let visible = 0;
      for (let row = 0; row < sampleCount; row += 1) {
        for (let column = 0; column < sampleCount; column += 1) {
          const x = rect.left + ((column + 0.5) / sampleCount) * rect.width;
          const y = rect.top + ((row + 0.5) / sampleCount) * rect.height;
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === element || element.contains(hit))) visible += 1;
        }
      }
      return visible / (sampleCount * sampleCount);
    },
    { scrollMode: scroll, sampleCount: samples },
  );
}

/**
 * 같은 카드 안에서 서로 다른 글자 덩어리의 상자가 겹친 쌍의 수.
 * 보이는 글자(display·visibility 가 숨김이 아닌 것)를 한 줄씩의 사각형으로 모아 쌍마다 겹침을 본다.
 * 같은 글자 덩어리의 여러 줄끼리는 비교하지 않는다. 겹침이 가로·세로 모두 2 px 미만이면 반올림 오차로 보고 센다.
 */
export async function overlapsInCard(card: Locator): Promise<OverlapReport> {
  return card.evaluate((root): OverlapReport => {
    interface Box {
      id: number;
      label: string;
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
    const boxes: Box[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let id = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (!text || !parent) continue;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || parent.closest('[hidden]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      id += 1;
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue;
        boxes.push({ id, label: text.slice(0, 18), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      }
    }
    const pairs: OverlapPair[] = [];
    const counted = new Set<string>();
    let count = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.id === b.id) continue;
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width < 2 || height < 2) continue;
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (counted.has(key)) continue;
        counted.add(key);
        count += 1;
        if (pairs.length < 8) pairs.push({ a: a.label, b: b.label, width: Math.round(width), height: Math.round(height) });
      }
    }
    return { count, boxes: boxes.length, pairs };
  });
}
