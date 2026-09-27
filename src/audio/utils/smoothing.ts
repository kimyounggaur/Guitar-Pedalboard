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
