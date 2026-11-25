// 이펙트가 쓰는 타이머. 실시간 엔진은 창 타이머를 쓰고, 오프라인 렌더(프로브)와 Node 시험은 자기 시계를 주입한다(S3.2).
// `window` 는 호출할 때 읽는다. 그래서 창이 없는 Node 에서도 이 모듈을 불러올 수 있다.
export interface Timers {
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(handle: number): void;
}

// 창에서는 globalThis 가 window 라서 window.setTimeout 과 같다. 창이 없는 Node 시험이 이펙트를 만들고 끄기만 해도(S4.2: 꺼진 페달은 쉬려고 타이머를 건다)
// 터지지 않게 globalThis 를 쓴다. Node 의 타이머 객체는 unref 해 이벤트 루프를 붙잡지 않게 한다(시험이 타이머를 기다리며 늦게 끝나지 않도록).
export const windowTimers: Timers = {
  setTimeout: (callback, milliseconds) => {
    const handle: unknown = globalThis.setTimeout(callback, milliseconds);
    if (typeof handle === 'object' && handle !== null && 'unref' in handle) (handle as { unref(): void }).unref();
    return handle as number;
  },
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

// 이펙트는 생성자에서 컨텍스트만 받으므로(타이머 인자를 15개 생성자에 모두 달지 않으려고), 오프라인 렌더는 컨텍스트에 자기 시계를 등록해 둔다(S4.2).
// 등록이 없으면(실시간 엔진) 창 타이머다.
const contextTimers = new WeakMap<object, Timers>();

export function setContextTimers(context: object, timers: Timers): void {
  contextTimers.set(context, timers);
}

/**
 * 등록을 지운다. 오프라인 렌더는 끝나면 반드시 불러야 한다: 등록된 시계는 컨텍스트를 붙잡고 있어서(렌더 시계가 context 를 읽는다)
 * 지우지 않으면 브라우저가 컨텍스트와 워클릿 영역을 거두지 못하고, 렌더를 수백 번 돌리는 프로브에서 어느 순간 렌더가 끝나지 않고 멈춘다(L-268).
 */
export function clearContextTimers(context: object): void {
  contextTimers.delete(context);
}

export function timersFor(context: object): Timers {
  return contextTimers.get(context) ?? windowTimers;
}
