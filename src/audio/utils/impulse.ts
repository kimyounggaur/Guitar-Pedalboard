import type { ReverbParams } from '../types';

const modeDecayShape: Record<ReverbParams['mode'], number> = {
  room: 2.8,
  hall: 1.8,
  plate: 2.1,
  spring: 2.4,
  ambient: 1.15,
};

export function createImpulseResponse(
  context: BaseAudioContext,
  seconds: number,
  mode: ReverbParams['mode'],
): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const decayShape = modeDecayShape[mode];

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const progress = i / length;
      const envelope = Math.pow(1 - progress, decayShape);
      const springColor = mode === 'spring' ? Math.sin(i * 0.08) * 0.32 : 0;
      const plateColor = mode === 'plate' ? Math.sin(i * 0.013) * 0.12 : 0;
      data[i] = (Math.random() * 2 - 1 + springColor + plateColor) * envelope;
    }
  }

  return impulse;
}
