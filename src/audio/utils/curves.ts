import type { DriveParams } from '../types';

export function createDriveCurve(
  mode: DriveParams['mode'],
  drive: number,
  bias: number,
  samples = 4096,
): Float32Array {
  const curve = new Float32Array(samples);
  const amount = 1 + (drive / 100) * 60;
  const asymmetry = bias * 0.35;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    const shifted = x + asymmetry;
    let shaped = shifted;

    if (mode === 'overdrive') {
      shaped = Math.tanh(shifted * amount) / Math.tanh(amount);
    } else if (mode === 'crunch') {
      const soft = Math.tanh(shifted * amount * 0.55);
      const hard = Math.max(-0.72, Math.min(0.72, shifted * amount * 0.18)) / 0.72;
      shaped = soft * 0.62 + hard * 0.38;
    } else if (mode === 'distortion') {
      const threshold = Math.max(0.12, 0.78 - (drive / 100) * 0.55);
      shaped = Math.max(-threshold, Math.min(threshold, shifted * amount * 0.16)) / threshold;
    } else {
      const threshold = Math.max(0.05, 0.3 - (drive / 100) * 0.22);
      shaped = shifted >= threshold ? 1 : shifted <= -threshold ? -1 : shifted / threshold;
    }

    curve[i] = Math.max(-1, Math.min(1, shaped - asymmetry * 0.25));
  }

  return curve;
}
