// 화면 시험 전용 렌더 카운터(S4.3). 컴포넌트가 화면에 반영된 횟수를 이름별로 센다.
// 페이지가 `window.__GPB_RENDER_COUNTS__` 객체를 먼저 만들어 둔 때만 센다(E2E 가 addInitScript 로 만든다).
// 제품 화면에서는 그 객체가 없으므로 `useRenderCount` 는 아무것도 하지 않는 함수로 정해져 훅 호출 비용이 없다.
import { useEffect } from 'react';

type RenderCounts = Record<string, number>;

const sink: RenderCounts | undefined =
  typeof window === 'undefined' ? undefined : (window as unknown as { __GPB_RENDER_COUNTS__?: RenderCounts }).__GPB_RENDER_COUNTS__;

function useActiveRenderCount(name: string): void {
  // 의존성이 없어서 화면에 반영될 때마다 한 번 돈다. 메모로 건너뛴 렌더는 반영되지 않으므로 세지 않는다.
  useEffect(() => {
    if (sink) sink[name] = (sink[name] ?? 0) + 1;
  });
}

function useInertRenderCount(_name: string): void {
  // 제품 화면: 아무것도 하지 않는다.
}

export const useRenderCount: (name: string) => void = sink ? useActiveRenderCount : useInertRenderCount;
