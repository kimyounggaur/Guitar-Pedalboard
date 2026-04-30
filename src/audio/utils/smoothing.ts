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
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + duration);
}
