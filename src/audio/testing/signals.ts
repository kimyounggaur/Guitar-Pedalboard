// 오디오 렌더 프로브와 브라우저 시나리오가 함께 쓰는 기준 신호(설계서 부록 A).
// 난수는 고정 시드의 PRNG만 쓰므로 같은 인자로 부르면 항상 같은 신호가 나온다.
// 브라우저 의존이 없어서 Node(scripts/make-fixture-wavs.mjs)와 브라우저(probe.html)에서 모두 쓴다.

import {
  addSawtoothVoice,
  allocate,
  dbToLinear,
  normalizePeak,
  peakOf,
  refPc,
  REF_PC_NOTES_HZ,
  REF_PC_PEAK_DB,
  type Samples,
} from '../offline/referenceSignal';

// REF-PC 와 그 재료는 앱도 쓰므로 src/audio/offline/referenceSignal.ts 로 옮겼다(S1.4c). 이 파일이 그대로 다시 내보낸다.
export { dbToLinear, normalizePeak, peakOf, refPc, REF_PC_NOTES_HZ, REF_PC_PEAK_DB };
export type { Samples };
export type Channels = Float32Array[];

/** 신호를 만들 때 쓰는 고정 시드(바꾸면 모든 기준선이 달라진다). */
export const SIGNAL_SEED = 0x5eed0001;

export const linearToDb = (value: number): number => 20 * Math.log10(Math.max(value, 1e-12));

/** mulberry32. 같은 시드면 같은 수열이다. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rmsOf(samples: Samples, start = 0, end = samples.length): number {
  let sum = 0;
  const from = Math.max(0, start);
  const to = Math.min(samples.length, end);
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

export function toStereo(left: Samples, right: Samples | null = left): Channels {
  return [left, right ?? new Float32Array(left.length)];
}

/** 왼쪽에만 신호가 있고 오른쪽은 무음이다(P-06, E-02). */
export function leftOnly(mono: Samples): Channels {
  return [mono, new Float32Array(mono.length)];
}

export function rightOnly(mono: Samples): Channels {
  return [new Float32Array(mono.length), mono];
}

/** 시작 부분에 아주 짧은 선형 페이드인을 건다(클릭 방지). */
function fadeIn(samples: Samples, sampleRate: number, seconds: number): void {
  const count = Math.min(samples.length, Math.round(sampleRate * seconds));
  for (let i = 0; i < count; i += 1) samples[i] *= i / count;
}

function fadeOut(samples: Samples, sampleRate: number, seconds: number): void {
  const count = Math.min(samples.length, Math.round(sampleRate * seconds));
  for (let i = 0; i < count; i += 1) samples[samples.length - 1 - i] *= i / count;
}

// ---------------------------------------------------------------------------------------------
// REF-NOISE — 백색잡음(가우시안). rmsDb 에 정확히 맞춘다.
// ---------------------------------------------------------------------------------------------
export function refNoise(sampleRate: number, seconds: number, rmsDb: number, seed = SIGNAL_SEED): Samples {
  const out = allocate(sampleRate, seconds);
  const random = createRng(seed);
  for (let i = 0; i < out.length; i += 2) {
    // Box–Muller. 한 번에 두 샘플을 만든다.
    const radius = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12)));
    const angle = 2 * Math.PI * random();
    out[i] = radius * Math.cos(angle);
    if (i + 1 < out.length) out[i + 1] = radius * Math.sin(angle);
  }
  const scale = dbToLinear(rmsDb) / Math.max(rmsOf(out), 1e-12);
  for (let i = 0; i < out.length; i += 1) out[i] *= scale;
  return out;
}

// ---------------------------------------------------------------------------------------------
// REF-DECAY — 110 Hz 감쇠 톱니파. 피크 −12 dBFS 에서 시작해 4초 동안 55 dB 줄어든다(dB 로 직선).
// ---------------------------------------------------------------------------------------------
export const REF_DECAY_SECONDS = 4;
export const REF_DECAY_DROP_DB = 55;

export function refDecay(sampleRate: number, seconds = REF_DECAY_SECONDS): Samples {
  const out = allocate(sampleRate, seconds);
  const dropPerSecond = REF_DECAY_DROP_DB / REF_DECAY_SECONDS;
  addSawtoothVoice(out, sampleRate, 110, 40, (time) => dbToLinear(-dropPerSecond * time));
  // 처음 1초의 피크가 −12 dBFS 가 되도록 맞추고, 그 배율을 전체에 같게 적용한다.
  const head = out.subarray(0, Math.min(out.length, sampleRate));
  const scale = dbToLinear(-12) / Math.max(peakOf(head), 1e-12);
  for (let i = 0; i < out.length; i += 1) out[i] *= scale;
  return out;
}

// ---------------------------------------------------------------------------------------------
// REF-SINE / REF-SINES / REF-IMPULSE
// ---------------------------------------------------------------------------------------------
export function refSine(sampleRate: number, seconds: number, frequency: number, peakDb: number): Samples {
  const out = allocate(sampleRate, seconds);
  const amplitude = dbToLinear(peakDb);
  const step = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin(step * i);
  return out;
}

export interface SineTone {
  frequency: number;
  startSeconds: number;
  endSeconds: number;
}

export const REF_SINES_TONE_SECONDS = 0.5;
export const REF_SINES_PEAK_DB = -20;

/** 80 Hz ~ 5 kHz 를 1/3 옥타브 간격으로, 각 0.5초. 음마다 5 ms 페이드를 건다. */
export function refSines(sampleRate: number): { samples: Samples; tones: SineTone[] } {
  const tones: SineTone[] = [];
  for (let step = 0; 80 * 2 ** (step / 3) <= 5000; step += 1) {
    tones.push({
      frequency: 80 * 2 ** (step / 3),
      startSeconds: step * REF_SINES_TONE_SECONDS,
      endSeconds: (step + 1) * REF_SINES_TONE_SECONDS,
    });
  }
  const out = allocate(sampleRate, tones.length * REF_SINES_TONE_SECONDS);
  const toneLength = Math.round(sampleRate * REF_SINES_TONE_SECONDS);
  tones.forEach((tone, index) => {
    const segment = refSine(sampleRate, REF_SINES_TONE_SECONDS, tone.frequency, REF_SINES_PEAK_DB);
    fadeIn(segment, sampleRate, 0.005);
    fadeOut(segment, sampleRate, 0.005);
    out.set(segment, index * toneLength);
  });
  return { samples: out, tones };
}

/** 단일 샘플 amplitude(기본 0.5) 뒤 무음. position 은 샘플 번호. */
export function refImpulse(sampleRate: number, seconds = 1, position = 0, amplitude = 0.5): Samples {
  const out = allocate(sampleRate, seconds);
  out[position] = amplitude;
  return out;
}

// ---------------------------------------------------------------------------------------------
// H-1 ~ H-4 — 하울링 판정용 신호 (P-07, E-03 — 판정 구현은 S1.5)
// ---------------------------------------------------------------------------------------------
/** H-1: 순음 하울링. 1 kHz, −20 dBFS, 5초 지속. */
export function howl1(sampleRate: number): Samples {
  return refSine(sampleRate, 5, 1000, -20);
}

/** H-2: 커지는 하울링. 2.5 kHz, −50 → −6 dBFS(약 +11 dB/s, 4초), 이후 4초 유지. */
export function howl2(sampleRate: number): Samples {
  const out = allocate(sampleRate, 8);
  const step = (2 * Math.PI * 2500) / sampleRate;
  for (let i = 0; i < out.length; i += 1) {
    const time = i / sampleRate;
    const levelDb = Math.min(-6, -50 + 11 * time);
    out[i] = dbToLinear(levelDb) * Math.sin(step * i);
  }
  return out;
}

/** H-3: 왜곡된 하울링. 800 Hz 사인을 tanh(4x) 로 왜곡하고 피크 −12 dBFS 로 맞춘 5초. */
export function howl3(sampleRate: number): Samples {
  const out = allocate(sampleRate, 5);
  const step = (2 * Math.PI * 800) / sampleRate;
  for (let i = 0; i < out.length; i += 1) out[i] = Math.tanh(4 * Math.sin(step * i));
  return normalizePeak(out, -12);
}

export const HOWL4_TONES_HZ = [80, 200, 500, 1250, 3200] as const;

/**
 * H-4: 기본 구성 고레벨 지속음. 80 Hz ~ 3.2 kHz 의 대표 5개 음을 합친 5초(피크 −12 dBFS).
 * 설계서의 "입력 한계 +20 dB 상당"은 신호가 아니라 시험 설정(입력 이득 +20 dB)으로 준다.
 */
export function howl4(sampleRate: number): Samples {
  const out = allocate(sampleRate, 5);
  for (const frequency of HOWL4_TONES_HZ) {
    const step = (2 * Math.PI * frequency) / sampleRate;
    for (let i = 0; i < out.length; i += 1) out[i] += Math.sin(step * i);
  }
  return normalizePeak(out, -12);
}

// ---------------------------------------------------------------------------------------------
// G-1 ~ G-3 — 오차단 시험 신호 (P-07, E-03 — 판정 구현은 S1.5)
// ---------------------------------------------------------------------------------------------
const GOOD_SECONDS = 60;

/** G-1: 서스테인 리드. 196 Hz 배음 10개, −4 dB/s 감쇠, 5 Hz ±15센트 비브라토, 4초씩 60초 반복. */
export function sustainLead(sampleRate: number, seconds = GOOD_SECONDS): Samples {
  const out = allocate(sampleRate, seconds);
  const noteLength = Math.round(sampleRate * 4);
  const peak = dbToLinear(-12);
  for (let start = 0; start < out.length; start += noteLength) {
    const length = Math.min(noteLength, out.length - start);
    let phase = 0;
    for (let i = 0; i < length; i += 1) {
      const time = i / sampleRate;
      const cents = 15 * Math.sin(2 * Math.PI * 5 * time);
      const frequency = 196 * 2 ** (cents / 1200);
      phase += (2 * Math.PI * frequency) / sampleRate;
      let sum = 0;
      for (let harmonic = 1; harmonic <= 10; harmonic += 1) sum += Math.sin(phase * harmonic) / harmonic;
      out[start + i] = peak * dbToLinear(-4 * time) * sum * 0.5;
    }
  }
  return out;
}

/** G-2: 스트러밍. REF-DECAY 를 2초마다 다시 쳐서 60초(다음 스트럼이 앞 소리를 끊는다). */
export function strumming(sampleRate: number, seconds = GOOD_SECONDS): Samples {
  const strum = refDecay(sampleRate);
  const out = allocate(sampleRate, seconds);
  const interval = Math.round(sampleRate * 2);
  for (let start = 0; start < out.length; start += interval) {
    const length = Math.min(interval, out.length - start);
    out.set(strum.subarray(0, length), start);
  }
  return out;
}

/** G-3: 잡음 바닥. 무음 + −70 dBFS(RMS) 잡음 60초. */
export function noiseFloor(sampleRate: number, seconds = GOOD_SECONDS): Samples {
  return refNoise(sampleRate, seconds, -70, SIGNAL_SEED + 3);
}

// ---------------------------------------------------------------------------------------------
// 입력 레벨 경고 시험용(S2.5, E-09, 설계서 4.12). 부록 A 에 없는 신호라 REFACTOR_LOG L-119 에 적는다.
// '정상 입력(피크 −12 dBFS)'은 REF-PC 그대로 쓰고, 나머지는 REF-PC 의 피크만 바꾼 것(2초마다 다시 치는 '연주 중' 입력)과 무음, 한 번 치고 멈춘 연주다.
// ---------------------------------------------------------------------------------------------
/**
 * REF-PC 의 타건(2초 간격)마다 피크를 peakDb 로 맞춘다. REF-PC 는 전체를 한 번에 −12 dBFS 로 맞춰서 첫 타건만 −12 이고
 * 뒤의 타건은 세 음의 위상이 어긋나 1~3 dB 낮다. 레벨 경고 시험은 '모든 타건이 같은 크기'여야 판정을 시간에 걸쳐 같은 조건으로 볼 수 있다.
 */
function everyStrikeAt(samples: Samples, sampleRate: number, peakDb: number): Samples {
  const segment = Math.round(sampleRate * 2);
  for (let start = 0; start < samples.length; start += segment) {
    normalizePeak(samples.subarray(start, Math.min(samples.length, start + segment)), peakDb);
  }
  return samples;
}

/** LVL-SMALL: 작은 입력. REF-PC 의 모든 타건을 피크 −40 dBFS 로(표의 '너무 작음' 기준 −36 dBFS 보다 4 dB 작다). */
export function levelSmall(sampleRate: number, seconds = 8): Samples {
  return everyStrikeAt(refPc(sampleRate, seconds), sampleRate, -40);
}

/** LVL-HOT: 한계 초과. REF-PC 의 모든 타건을 피크 0 dBFS 로(표의 '너무 큼' 기준 −0.5 dBFS 이상). */
export function levelHot(sampleRate: number, seconds = 8): Samples {
  return everyStrikeAt(refPc(sampleRate, seconds), sampleRate, 0);
}

/** LVL-SILENT: 디지털 무음(연결은 되었는데 소리가 없다). 16비트 WAV 에서도 정확히 0 이다. */
export function levelSilent(sampleRate: number, seconds = 10): Samples {
  return allocate(sampleRate, seconds);
}

/**
 * LVL-STOP: 파워코드를 한 번 치고 멈춘 연주. REF-PC 와 같은 음·어택·시정수(1.2초)로 첫 타건만 만들고, 여운이 다시 치지 않은 채 끝까지 줄어든다
 * (피크 −12 dBFS 에서 초당 약 7.2 dB 씩, 약 12초 뒤 16비트 바닥 아래). '연주를 멈췄다'를 가짜 마이크로 만드는 신호다.
 */
export function levelStop(sampleRate: number, seconds = 14): Samples {
  const out = allocate(sampleRate, seconds);
  const envelope = (time: number): number => Math.min(1, time / 0.002) * Math.exp(-time / 1.2);
  for (const note of REF_PC_NOTES_HZ) addSawtoothVoice(out, sampleRate, note, 20, envelope);
  return normalizePeak(out, REF_PC_PEAK_DB);
}

// ---------------------------------------------------------------------------------------------
// 튜너 시험용 음(P-22, E-16): 기본음 + 배음 6개가 2초 시정수로 줄어드는 뜯은 현 소리.
// ---------------------------------------------------------------------------------------------
export const OPEN_STRINGS_HZ = [82.41, 110, 146.83, 196, 246.94, 329.63] as const;

export function pluckedNote(sampleRate: number, frequency: number, seconds = 3): Samples {
  const out = allocate(sampleRate, seconds);
  addSawtoothVoice(out, sampleRate, frequency, 7, (time) => Math.min(1, time / 0.003) * Math.exp(-time / 2));
  return normalizePeak(out, -12);
}

// ---------------------------------------------------------------------------------------------
// 파일(WAV)·브라우저 시나리오용 목록
// ---------------------------------------------------------------------------------------------
export interface FixtureSignal {
  /** e2e/fixtures/{file}.wav */
  file: string;
  /** 설계서 부록 A 의 ID */
  id: string;
  description: string;
  create(sampleRate: number): Channels;
}

const mono = (create: (sampleRate: number) => Samples) => (sampleRate: number): Channels => [create(sampleRate)];

export const fixtureSignals: FixtureSignal[] = [
  { file: 'ref-pc', id: 'REF-PC', description: '합성 파워코드, 8초(모노)', create: mono(refPc) },
  { file: 'ref-pc-left-only', id: 'REF-PC', description: '합성 파워코드를 왼쪽에만(스테레오, 오른쪽 무음)', create: (sr) => leftOnly(refPc(sr)) },
  { file: 'ref-pc-right-only', id: 'REF-PC', description: '합성 파워코드를 오른쪽에만(스테레오, 왼쪽 무음)', create: (sr) => rightOnly(refPc(sr)) },
  { file: 'ref-noise-20', id: 'REF-NOISE', description: '백색잡음 RMS −20 dBFS, 10초', create: mono((sr) => refNoise(sr, 10, -20)) },
  { file: 'ref-decay', id: 'REF-DECAY', description: '110 Hz 감쇠 톱니파, 55 dB / 4초', create: mono((sr) => refDecay(sr)) },
  { file: 'ref-sine-1k', id: 'REF-SINE', description: '1 kHz 사인 −18 dBFS, 5초', create: mono((sr) => refSine(sr, 5, 1000, -18)) },
  { file: 'ref-sine-220', id: 'REF-SINE', description: '220 Hz 사인 −18 dBFS, 5초', create: mono((sr) => refSine(sr, 5, 220, -18)) },
  { file: 'ref-sines', id: 'REF-SINES', description: '80 Hz~5 kHz 1/3옥타브 사인 묶음, 각 0.5초', create: mono((sr) => refSines(sr).samples) },
  { file: 'ref-impulse', id: 'REF-IMPULSE', description: '단일 샘플 임펄스 0.5, 1초', create: mono((sr) => refImpulse(sr, 1, Math.round(sr * 0.1))) },
  { file: 'h-1', id: 'H-1', description: '순음 하울링 1 kHz −20 dBFS 5초', create: mono(howl1) },
  { file: 'h-2', id: 'H-2', description: '커지는 하울링 2.5 kHz −50→−6 dBFS', create: mono(howl2) },
  { file: 'h-3', id: 'H-3', description: '왜곡된 하울링 800 Hz tanh(4x)', create: mono(howl3) },
  { file: 'h-4', id: 'H-4', description: '기본 구성 고레벨 지속음(5개 음 합)', create: mono(howl4) },
  { file: 'g-1', id: 'G-1', description: '서스테인 리드(오차단 시험) 60초', create: mono((sr) => sustainLead(sr)) },
  { file: 'g-2', id: 'G-2', description: '스트러밍(오차단 시험) 60초', create: mono((sr) => strumming(sr)) },
  { file: 'g-3', id: 'G-3', description: '잡음 바닥 −70 dBFS(오차단 시험) 60초', create: mono((sr) => noiseFloor(sr)) },
  { file: 'lvl-small', id: 'LVL-SMALL', description: '입력 레벨 경고 시험: REF-PC 모든 타건 피크 −40 dBFS, 8초', create: mono((sr) => levelSmall(sr)) },
  { file: 'lvl-hot', id: 'LVL-HOT', description: '입력 레벨 경고 시험: REF-PC 모든 타건 피크 0 dBFS, 8초', create: mono((sr) => levelHot(sr)) },
  { file: 'lvl-silent', id: 'LVL-SILENT', description: '입력 레벨 경고 시험: 디지털 무음 10초', create: mono((sr) => levelSilent(sr)) },
  { file: 'lvl-stop', id: 'LVL-STOP', description: '입력 레벨 경고 시험: 한 번 치고 멈춘 연주(여운이 끝까지 줄어듦) 14초', create: mono((sr) => levelStop(sr)) },
  ...OPEN_STRINGS_HZ.map((frequency, index): FixtureSignal => ({
    file: `tuner-string-${index + 1}`,
    id: 'TUNER',
    description: `튜너 시험 ${frequency} Hz`,
    create: mono((sr) => pluckedNote(sr, frequency)),
  })),
];
