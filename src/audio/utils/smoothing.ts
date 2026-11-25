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
