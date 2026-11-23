// 마스터 리미터 사양(설계서 GS-6). 오디오 스레드의 limiter.worklet.ts 와 메인 스레드의 OutputStage·오프라인 렌더가
// 같은 값을 쓰도록 한곳에 둔다. 값만 있는 순수 모듈이라 워클릿 번들에 그대로 들어가도 된다.

/** limiter.worklet.ts 가 등록하는 이름 */
export const LIMITER_PROCESSOR_NAME = 'limiter-processor';
/** 천장(dBFS). 이 값을 넘는 샘플 피크는 나가지 않는다. */
export const LIMITER_CEILING_DB = -1;
/** 룩어헤드(초). 소리를 이만큼 늦추는 동안 그 사이의 피크를 미리 본다. */
export const LIMITER_LOOKAHEAD_SECONDS = 0.001;
/** 릴리즈 시상수(초). 즉시 어택, 릴리즈는 1 로 지수 복귀한다. */
export const LIMITER_RELEASE_SECONDS = 0.08;

/** 리미터가 소리를 늦추는 길이(샘플). 출력 단계의 고정 지연이다. */
export function limiterLookaheadFrames(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate * LIMITER_LOOKAHEAD_SECONDS));
}
