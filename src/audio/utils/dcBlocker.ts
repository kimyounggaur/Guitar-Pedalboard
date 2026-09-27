export function createDcBlocker(context: AudioContext): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 22;
  filter.Q.value = 0.707;
  return filter;
}
