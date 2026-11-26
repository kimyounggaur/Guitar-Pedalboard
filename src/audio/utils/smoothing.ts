export function smoothParam(
  param: AudioParam,
  value: number,
  context: BaseAudioContext,
  timeConstant = 0.012,
): void {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}

/** 볼륨 같은 값이 목표의 98% 까지 가는 데 걸리는 시간(S5.2 설계: 값 스무딩 20 ms). */
export const VOLUME_SMOOTHING_SECONDS = 0.02;

/**
 * 빠르게 움직이는 값(MIDI 볼륨 CC, 슬라이더)을 지퍼 잡음 없이 목표로 옮긴다(S5.2).
 *
 * `rampParam` 대신 쓰는 이유: Chrome 157 의 실제 렌더에서 `rampParam` 은 20 ms 램프가 아니라 한 표본 만에 거의 목표로 건너뛰는
 * 계단이다(1 → 0.2 로 바꾸면 첫 표본 차 0.67). 연달아 오는 CC 마다 계단이 생기면 지퍼 잡음이 된다(REFACTOR_LOG L-222, F-5).
 * `setTargetAtTime` 은 직전 자동화가 무엇이든 지금 값에서 출발하고, 새 목표가 연달아 와도 값이 이어진다.
 * 시간 상수를 `VOLUME_SMOOTHING_SECONDS / 4` 로 잡아 20 ms 뒤에 98% 에 닿는다.
 */
export function smoothVolume(param: AudioParam, value: number, context: BaseAudioContext): void {
  smoothParam(param, value, context, VOLUME_SMOOTHING_SECONDS / 4);
}

export function rampParam(
  param: AudioParam,
  value: number,
  context: BaseAudioContext,
  duration = 0.02,
): void {
  const now = context.currentTime;
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    const currentValue = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(currentValue, now);
  }
  param.linearRampToValueAtTime(value, now + duration);
}

/**
 * 지금 값에서 `value` 까지 `duration` 초 동안 직선으로 옮긴다(S3.2).
 *
 * `rampParam` 대신 쓰는 이유: Chrome 153 의 실제 렌더에서 `cancelAndHoldAtTime(now)` 바로 뒤에 `linearRampToValueAtTime` 을 걸면
 * 램프가 지금 시각이 아니라 파라미터가 만들어진 시각(0)에서 출발해, 값이 `duration` 을 기다리지 않고 거의 바로 목표로 건너뛴다
 * (직전 자동화가 `setTargetAtTime` 이면 아예 0 으로 끊긴다. 프로브 측정: REFACTOR_LOG L-220). 그러면 '페이드' 가 클릭이 된다.
 * 여기서는 현재 값을 직접 읽어 `setValueAtTime` 으로 못 박은 뒤 램프를 걸어 항상 지금 값에서 출발한다.
 */
export function fadeParam(
  param: AudioParam,
  value: number,
  context: BaseAudioContext,
  duration = 0.02,
): void {
  const now = context.currentTime;
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(value, now + duration);
}
