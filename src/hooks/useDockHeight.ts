import { useLayoutEffect } from 'react';

/** 문서 루트에 적는 CSS 변수 이름. 값은 도크의 실제 높이(px). */
export const DOCK_HEIGHT_VAR = '--dock-h';

/**
 * 화면 아래에 고정된 도크의 실제 높이를 `--dock-h` 로 문서 루트에 적어 둔다(설계서 4.10).
 * 본문 아래 여백(`.app-shell` 의 padding-bottom)이 이 값을 따라가므로, 도크가 접히거나 펼쳐지거나 화면 높이가 바뀌어도
 * 끝까지 스크롤하면 마지막 페달이 도크 위로 올라온다.
 *
 * `dock` 이 null(도크가 없는 데스크톱 배치)이면 변수를 지운다. 첫 값은 레이아웃 직후 동기로 적어 한 프레임도 어긋나지 않게 한다.
 * ResizeObserver 는 AudioWorklet 을 쓸 수 있는 브라우저라면 모두 있으므로 대체 경로를 따로 두지 않는다.
 */
export function useDockHeight(dock: HTMLElement | null): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!dock) {
      root.style.removeProperty(DOCK_HEIGHT_VAR);
      return undefined;
    }
    const publish = () => {
      root.style.setProperty(DOCK_HEIGHT_VAR, `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(dock, { box: 'border-box' });
    return () => {
      observer.disconnect();
      root.style.removeProperty(DOCK_HEIGHT_VAR);
    };
  }, [dock]);
}
