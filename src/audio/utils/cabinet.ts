import type { CabParams } from '../types';
import { clamp } from './db';

type ActiveCabModel = Exclude<CabParams['model'], 'off'>;

type CabinetProfile = {
  durationMs: number;
  midPeakHz: number;
  highCutHz: number;
  lowCutHz: number;
  midGainDb: number;
  upperCharacterDb: number;
  decayShape: number;
  reflections: ReadonlyArray<readonly [delayMs: number, gain: number]>;
};

const cabinetProfiles: Record<ActiveCabModel, CabinetProfile> = {
  'v30-4x12': {
    durationMs: 120,
    midPeakHz: 2200,
    highCutHz: 5400,
    lowCutHz: 85,
    midGainDb: 5.2,
    upperCharacterDb: 1.5,
    decayShape: 5.2,
    reflections: [[7, 0.2], [16, -0.13], [31, 0.09]],
  },
  'greenback-4x12': {
    durationMs: 110,
    midPeakHz: 1600,
    highCutHz: 4600,
    lowCutHz: 90,
    midGainDb: 4.5,
    upperCharacterDb: -1.2,
    decayShape: 5.6,
    reflections: [[8, 0.18], [19, -0.11], [34, 0.08]],
  },
  'blue-1x12': {
    durationMs: 78,
    midPeakHz: 2800,
    highCutHz: 6200,
    lowCutHz: 100,
    midGainDb: 4.2,
    upperCharacterDb: 2.2,
    decayShape: 6.3,
    reflections: [[6, 0.17], [14, -0.1], [26, 0.07]],
  },
  'jensen-1x12': {
    durationMs: 70,
    midPeakHz: 1900,
    highCutHz: 5000,
    lowCutHz: 110,
    midGainDb: 3.8,
    upperCharacterDb: 0.3,
    decayShape: 6.7,
    reflections: [[5, 0.16], [13, -0.09], [24, 0.06]],
  },
  'tweed-1x10': {
    durationMs: 42,
    midPeakHz: 1400,
    highCutHz: 4200,
    lowCutHz: 130,
    midGainDb: 5.5,
    upperCharacterDb: -1.8,
    decayShape: 7.4,
    reflections: [[4, 0.14], [10, -0.08]],
  },
};

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
};

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function applyBiquad(samples: Float32Array, coefficients: BiquadCoefficients): void {
  const { a0 } = coefficients;
  const b0 = coefficients.b0 / a0;
  const b1 = coefficients.b1 / a0;
  const b2 = coefficients.b2 / a0;
  const a1 = coefficients.a1 / a0;
  const a2 = coefficients.a2 / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    samples[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

function createHighPass(frequency: number, sampleRate: number, q = 0.707): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  return {
    b0: (1 + cosine) / 2,
    b1: -(1 + cosine),
    b2: (1 + cosine) / 2,
    a0: 1 + alpha,
    a1: -2 * cosine,
    a2: 1 - alpha,
  };
}

function createLowPass(frequency: number, sampleRate: number, q = 0.707): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  return {
    b0: (1 - cosine) / 2,
    b1: 1 - cosine,
    b2: (1 - cosine) / 2,
    a0: 1 + alpha,
    a1: -2 * cosine,
    a2: 1 - alpha,
  };
}

function createPeak(
  frequency: number,
  gainDb: number,
  sampleRate: number,
  q = 1.1,
): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const amplitude = Math.pow(10, gainDb / 40);
  return {
    b0: 1 + alpha * amplitude,
    b1: -2 * cosine,
    b2: 1 - alpha * amplitude,
    a0: 1 + alpha / amplitude,
    a1: -2 * cosine,
    a2: 1 - alpha / amplitude,
  };
}

function applyHighShelfProxy(
  samples: Float32Array,
  sampleRate: number,
  gainDb: number,
): void {
  const highGain = Math.pow(10, gainDb / 20);
  const cutoff = 2200;
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let low = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const input = samples[index];
    low += alpha * (input - low);
    samples[index] = low + (input - low) * highGain;
  }
}

function safeControl(value: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 100) : fallback;
}

export function createCabinetImpulse(
  context: BaseAudioContext,
  model: CabParams['model'],
  micPosition: number,
  distance: number,
): AudioBuffer {
  if (model === 'off') {
    const impulse = context.createBuffer(2, 1, context.sampleRate);
    impulse.getChannelData(0)[0] = 1;
    impulse.getChannelData(1)[0] = 1;
    return impulse;
  }

  const profile = cabinetProfiles[model] ?? cabinetProfiles['v30-4x12'];
  const mic = safeControl(micPosition, 55) / 100;
  const roomDistance = safeControl(distance, 30) / 100;
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.round((sampleRate * profile.durationMs) / 1000));
  const impulse = context.createBuffer(2, length, sampleRate);
  const lowCut = profile.lowCutHz * (1 + roomDistance * 0.55);
  const highCut = profile.highCutHz * (0.92 + mic * 0.16);
  const shelfGain = -6 + mic * 9 + profile.upperCharacterDb;
  let absolutePeak = 0;

  for (let channel = 0; channel < 2; channel += 1) {
    const samples = impulse.getChannelData(channel);
    const random = createSeededRandom(
      hashSeed(`${model}:${Math.round(mic * 100)}:${Math.round(roomDistance * 100)}:${channel}`),
    );
    const directGain = 0.92 - roomDistance * 0.22;
    samples[0] = directGain * (channel === 0 ? 1 : 0.985);

    for (let index = 1; index < length; index += 1) {
      const progress = index / length;
      const envelope = Math.exp(-progress * profile.decayShape);
      const coneNoise = random() * 2 - 1;
      const coneResonance = Math.sin((2 * Math.PI * profile.midPeakHz * index) / sampleRate);
      samples[index] = envelope * (coneNoise * 0.095 + coneResonance * 0.018);
    }

    profile.reflections.forEach(([delayMs, gain], reflectionIndex) => {
      const stereoOffset = channel === 0 ? -reflectionIndex : reflectionIndex + 1;
      const delayWithDistance = delayMs + roomDistance * (5 + reflectionIndex * 2);
      const sampleIndex = Math.round((delayWithDistance * sampleRate) / 1000) + stereoOffset;
      if (sampleIndex > 0 && sampleIndex < samples.length) {
        samples[sampleIndex] += gain * (0.3 + roomDistance * 0.9);
      }
    });

    applyBiquad(samples, createHighPass(lowCut, sampleRate));
    applyBiquad(samples, createPeak(profile.midPeakHz, profile.midGainDb, sampleRate));
    applyHighShelfProxy(samples, sampleRate, shelfGain);
    applyBiquad(samples, createLowPass(highCut, sampleRate));

    for (let index = 0; index < samples.length; index += 1) {
      absolutePeak = Math.max(absolutePeak, Math.abs(samples[index]));
    }
  }

  if (absolutePeak > 0) {
    const scale = 0.92 / absolutePeak;
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const samples = impulse.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] *= scale;
      }
    }
  }

  return impulse;
}
