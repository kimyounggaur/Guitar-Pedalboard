// 손가락 드래그에 가까운 터치 입력을 보내는 도우미.
// Playwright 의 touchscreen 은 탭(tap)만 있어서, 스크롤처럼 '눌러서 끄는' 동작은 CDP 의 Input.dispatchTouchEvent 로 보낸다.
// (Input.synthesizeScrollGesture 는 touch-action 을 거치지 않거나 결과가 믿기 어려워 쓰지 않는다 — REFACTOR_LOG F-3.)
import type { Page } from '@playwright/test';

export interface TouchPoint {
  x: number;
  y: number;
}

export interface TouchDragOptions {
  /** 이동 단계 수(기본 12) */
  steps?: number;
  /** 단계 사이 대기(ms, 기본 16 ≈ 한 프레임) */
  stepDelayMs?: number;
}

/** from → to 로 손가락 하나를 대고 끈 뒤 뗀다. 타임스탬프가 필요 없도록 단계마다 한 프레임쯤 기다린다. */
export async function touchDrag(page: Page, from: TouchPoint, to: TouchPoint, options: TouchDragOptions = {}): Promise<void> {
  const steps = Math.max(2, options.steps ?? 12);
  const stepDelayMs = options.stepDelayMs ?? 16;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }],
      });
      await page.waitForTimeout(stepDelayMs);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/**
 * 스크롤 위치(문서 세로, 페달 보드 가로)가 120 ms 동안 변하지 않을 때까지 기다린 뒤 돌려준다.
 * 손가락을 뗀 뒤의 관성(fling)과 scroll-snap 이 끝나기를 기다리는 용도다. 최대 3 초.
 */
export async function settledScroll(page: Page): Promise<{ y: number; boardX: number }> {
  return page.evaluate(
    () =>
      new Promise<{ y: number; boardX: number }>((resolve) => {
        const board = document.querySelector('.pedal-board');
        const read = () => ({ y: Math.round(window.scrollY), boardX: Math.round(board?.scrollLeft ?? 0) });
        let last = read();
        let stableSince = performance.now();
        const startedAt = stableSince;
        const tick = () => {
          const now = performance.now();
          const current = read();
          if (current.y !== last.y || current.boardX !== last.boardX) {
            last = current;
            stableSince = now;
          }
          if (now - stableSince >= 120 || now - startedAt >= 3_000) resolve(last);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}
