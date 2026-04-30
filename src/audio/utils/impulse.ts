export function createImpulseResponse(
  context: BaseAudioContext,
  seconds: number,
  decay: number,
): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const progress = i / length;
      const envelope = Math.pow(1 - progress, decay);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
  }

  return impulse;
}
