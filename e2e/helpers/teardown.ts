// 정지 정리(E-01)가 끝났는지 페이지 안에서 재는 도우미.
import type { Page } from '@playwright/test';

export interface TeardownReading {
  /** 사용자 동작(`markTriggers` 로 남긴 시각)부터 정리가 끝났다고 처음 관찰될 때까지 ms */
  elapsedMs: number;
}

/**
 * 모든 입력 트랙이 'ended', 모든 AudioContext 가 'closed', 화면에 '기타 연결하기' 버튼이 보일 때까지 기다린다.
 * `trackAudioContexts` 와 `markTriggers` 가 먼저 심겨 있어야 한다. 시간이 `limitMs` 를 넘으면 그때의 상태와 함께 실패한다.
 */
export async function waitForTeardown(page: Page, limitMs = 500): Promise<TeardownReading> {
  const outcome = await page.evaluate(
    ({ limit }) =>
      new Promise<{ ok: boolean; elapsedMs: number; detail: string }>((resolve) => {
        const holder = window as unknown as {
          __lastTrigger?: number;
          __audioTracking: () => {
            contexts: Array<{ state: string }>;
            inputTracks: Array<{ readyState: string }>;
          };
        };
        const origin = holder.__lastTrigger ?? performance.now();
        const read = () => {
          const tracking = holder.__audioTracking();
          const tracksEnded = tracking.inputTracks.length > 0 && tracking.inputTracks.every((track) => track.readyState === 'ended');
          const contextsClosed = tracking.contexts.length > 0 && tracking.contexts.every((context) => context.state === 'closed');
          const disconnected = Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === '기타 연결하기');
          return { tracksEnded, contextsClosed, disconnected, tracking };
        };
        const poll = () => {
          const now = read();
          const elapsedMs = performance.now() - origin;
          if (now.tracksEnded && now.contextsClosed && now.disconnected) {
            resolve({ ok: true, elapsedMs, detail: '' });
            return;
          }
          if (elapsedMs > limit) {
            resolve({
              ok: false,
              elapsedMs,
              detail: `tracksEnded=${now.tracksEnded} contextsClosed=${now.contextsClosed} connectButton=${now.disconnected} tracks=${JSON.stringify(now.tracking.inputTracks)} contexts=${JSON.stringify(now.tracking.contexts)}`,
            });
            return;
          }
          setTimeout(poll, 4);
        };
        poll();
      }),
    { limit: limitMs },
  );
  if (!outcome.ok) {
    throw new Error(`${limitMs} ms 안에 정지 정리가 끝나지 않았습니다(${Math.round(outcome.elapsedMs)} ms 경과): ${outcome.detail}`);
  }
  return { elapsedMs: outcome.elapsedMs };
}
