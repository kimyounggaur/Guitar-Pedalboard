// 오프라인 렌더용 타이머. 창 타이머는 렌더가 도는 속도와 무관하게(실시간으로) 울리므로 렌더 안의 시각을 알 수 없다.
// 이 타이머는 "렌더 시각" 으로 잰다: 타이머를 건 시점의 `context.currentTime` 에서 지연만큼 지난 뒤, 렌더 퀀텀(128샘플) 경계에서
// 렌더를 잠깐 멈추고(suspend) 콜백을 실행한다. 콜백이 안에서 다시 타이머를 걸어도 된다(앞 시각이면).
import type { Timers } from '../utils/timers';

export const RENDER_QUANTUM_FRAMES = 128;

/** `frame` 에서 렌더를 멈추고 `run` 을 실행하는 함수(renderChain 이 suspend 로 구현한다). 같은 프레임은 알아서 비켜 간다. */
export type ScheduleAtFrame = (frame: number, run: () => void) => void;

export function createContextTimers(context: BaseAudioContext, scheduleAtFrame: ScheduleAtFrame): Timers {
  let nextHandle = 1;
  const pending = new Set<number>();
  return {
    setTimeout(callback, milliseconds) {
      const handle = nextHandle;
      nextHandle += 1;
      const sampleRate = context.sampleRate;
      const nowFrame = Math.round(context.currentTime * sampleRate);
      // 올림해서 요청한 시간보다 일찍 울리지 않게 한다(페이드가 끝나기 전에 IR 을 바꾸면 안 된다). 지금 퀀텀 안에는 걸 수 없으니 최소 한 퀀텀 뒤.
      const wanted = nowFrame + (milliseconds / 1000) * sampleRate;
      const frame = Math.max(nowFrame + RENDER_QUANTUM_FRAMES, Math.ceil(wanted / RENDER_QUANTUM_FRAMES) * RENDER_QUANTUM_FRAMES);
      pending.add(handle);
      scheduleAtFrame(frame, () => {
        if (pending.delete(handle)) callback();
      });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
  };
}
