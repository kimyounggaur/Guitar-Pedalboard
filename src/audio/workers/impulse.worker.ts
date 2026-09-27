import type { ReverbMode } from '../types';
import type {
  ImpulseWorkerFailure,
  ImpulseWorkerRequest,
  ImpulseWorkerSuccess,
} from './impulseProtocol';

const modeDecayShape: Record<ReverbMode, number> = {
  room: 2.8,
  hall: 1.8,
  plate: 2.1,
  spring: 2.4,
  ambient: 1.15,
};

interface ReflectionProfile {
  count: number;
  minSeconds: number;
  maxSeconds: number;
  spacingCurve: number;
}

const reflectionProfiles: Record<ReverbMode, ReflectionProfile> = {
  room: { count: 9, minSeconds: 0.008, maxSeconds: 0.024, spacingCurve: 0.82 },
  hall: { count: 5, minSeconds: 0.014, maxSeconds: 0.045, spacingCurve: 1.24 },
  plate: { count: 7, minSeconds: 0.009, maxSeconds: 0.034, spacingCurve: 0.96 },
  spring: { count: 6, minSeconds: 0.011, maxSeconds: 0.041, spacingCurve: 1.08 },
  ambient: { count: 8, minSeconds: 0.012, maxSeconds: 0.045, spacingCurve: 1.36 },
};

const modeSeed: Record<ReverbMode, number> = {
  room: 0x243f6a88,
  hall: 0x85a308d3,
  plate: 0x13198a2e,
  spring: 0x03707344,
  ambient: 0xa4093822,
};

interface WorkerScope {
  onmessage: ((event: MessageEvent<ImpulseWorkerRequest>) => void) | null;
  postMessage(message: ImpulseWorkerSuccess | ImpulseWorkerFailure, transfer?: ArrayBuffer[]): void;
}

const workerScope = self as unknown as WorkerScope;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createChannel(
  length: number,
  sampleRate: number,
  seconds: number,
  mode: ReverbMode,
  channel: number,
): Float32Array {
  const data = new Float32Array(length);
  const durationSeed = Math.round(seconds * 1000) * 0x9e3779b1;
  const channelSeed = channel === 0 ? 0x51ed270b : 0x7f4a7c15;
  const random = createRandom(modeSeed[mode] ^ durationSeed ^ channelSeed);
  const decayShape = modeDecayShape[mode];
  let filtered = 0;

  for (let i = 0; i < length; i += 1) {
    const progress = length > 1 ? i / (length - 1) : 1;
    const envelope = Math.pow(1 - progress, decayShape);
    const springColor = mode === 'spring' ? Math.sin(i * 0.08) * 0.32 : 0;
    const plateColor = mode === 'plate' ? Math.sin(i * 0.013) * 0.12 : 0;
    const raw = random() * 2 - 1 + springColor + plateColor;
    const coefficient = 0.48 - progress * 0.4;

    filtered += coefficient * (raw - filtered);
    data[i] = filtered * envelope;
  }

  const reflectionProfile = reflectionProfiles[mode];
  for (let index = 0; index < reflectionProfile.count; index += 1) {
    const normalizedIndex = (index + 1) / (reflectionProfile.count + 1);
    const spread = Math.pow(normalizedIndex, reflectionProfile.spacingCurve);
    const jitterSeconds = (random() - 0.5) * 0.0018;
    const timeSeconds = clamp(
      reflectionProfile.minSeconds +
        (reflectionProfile.maxSeconds - reflectionProfile.minSeconds) * spread +
        jitterSeconds,
      0.008,
      0.045,
    );
    const sampleIndex = Math.min(length - 1, Math.max(0, Math.round(timeSeconds * sampleRate)));
    const polarity = random() >= 0.5 ? 1 : -1;
    const amplitude = (0.68 - spread * 0.48) * polarity;

    data[sampleIndex] += amplitude;
  }

  return data;
}

workerScope.onmessage = (event) => {
  const request = event.data;

  try {
    const seconds = clamp(Number.isFinite(request.seconds) ? request.seconds : 1.8, 0.2, 6);
    const sampleRate = Math.round(
      clamp(Number.isFinite(request.sampleRate) ? request.sampleRate : 48000, 8000, 384000),
    );
    const length = Math.max(1, Math.floor(sampleRate * seconds));
    const left = createChannel(length, sampleRate, seconds, request.mode, 0);
    const right = createChannel(length, sampleRate, seconds, request.mode, 1);
    const response: ImpulseWorkerSuccess = { id: request.id, left, right };

    workerScope.postMessage(response, [left.buffer as ArrayBuffer, right.buffer as ArrayBuffer]);
  } catch (error) {
    const response: ImpulseWorkerFailure = {
      id: request.id,
      error: error instanceof Error ? error.message : 'Impulse response generation failed.',
    };
    workerScope.postMessage(response);
  }
};

export {};
