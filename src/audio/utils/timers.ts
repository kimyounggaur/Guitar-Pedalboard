// 이펙트가 쓰는 타이머. 실시간 엔진은 창 타이머를 쓰고, 오프라인 렌더(프로브)와 Node 시험은 자기 시계를 주입한다(S3.2).
// `window` 는 호출할 때 읽는다. 그래서 창이 없는 Node 에서도 이 모듈을 불러올 수 있다.
export interface Timers {
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(handle: number): void;
}

export const windowTimers: Timers = {
  setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
  clearTimeout: (handle) => window.clearTimeout(handle),
};
