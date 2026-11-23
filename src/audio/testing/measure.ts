// 소리 측정 함수. 오디오 렌더 프로브(probes.ts)가 쓰는 순수 계산이라 DOM·Web Audio 에 의존하지 않는다.
// 모든 dB 는 dBFS(만점 = 1.0)이고, 0 이거나 너무 작으면 FLOOR_DB 로 막아 JSON 에 -Infinity 가 들어가지 않게 한다.

export type Samples = Float32Array | Float64Array;

export const FLOOR_DB = -200;

export function dbOf(linear: number): number {
  return linear <= 1e-10 ? FLOOR_DB : 20 * Math.log10(linear);
}

export function fromDb(db: number): number {
  return 10 ** (db / 20);
}

function clampRange(length: number, start: number, end: number): [number, number] {
  return [Math.max(0, Math.floor(start)), Math.min(length, Math.floor(end))];
}

export function rmsLinear(samples: Samples, start = 0, end = samples.length): number {
  const [from, to] = clampRange(samples.length, start, end);
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

export function rmsDb(samples: Samples, start = 0, end = samples.length): number {
  return dbOf(rmsLinear(samples, start, end));
}

export function peakLinear(samples: Samples, start = 0, end = samples.length): number {
  const [from, to] = clampRange(samples.length, start, end);
  let peak = 0;
  for (let i = from; i < to; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

export function peakDb(samples: Samples, start = 0, end = samples.length): number {
  return dbOf(peakLinear(samples, start, end));
}

/** 여러 채널의 전력 평균으로 낸 RMS(dBFS). 모노 신호가 양쪽에 같게 나오면 한 채널의 RMS 와 같다. */
export function stereoRmsDb(channels: Samples[], start = 0, end = channels[0]?.length ?? 0): number {
  if (channels.length === 0) return FLOOR_DB;
  let power = 0;
  for (const channel of channels) power += rmsLinear(channel, start, end) ** 2;
  return dbOf(Math.sqrt(power / channels.length));
}

export function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return value > 0 ? 1e6 : FLOOR_DB;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// ---------------------------------------------------------------------------------------------
// FFT (radix-2, 제자리). size 는 2의 거듭제곱이어야 한다.
// ---------------------------------------------------------------------------------------------
export function fft(re: Float64Array, im: Float64Array): void {
  const size = re.length;
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT 크기는 2의 거듭제곱이어야 합니다: ${size}`);
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tempRe = re[i];
      re[i] = re[j];
      re[j] = tempRe;
      const tempIm = im[i];
      im[i] = im[j];
      im[j] = tempIm;
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    const half = length >> 1;
    for (let start = 0; start < size; start += length) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const tRe = re[b] * wRe - im[b] * wIm;
        const tIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = wRe * stepRe - wIm * stepIm;
        wIm = wRe * stepIm + wIm * stepRe;
        wRe = nextRe;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();

export function hannWindow(size: number): Float64Array {
  let window = hannCache.get(size);
  if (!window) {
    window = new Float64Array(size);
    for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    hannCache.set(size, window);
  }
  return window;
}

// ---------------------------------------------------------------------------------------------
// Welch 스펙트럼 추정: 입력 x, 출력 y 의 평균 전력(Sxx, Syy)과 교차 스펙트럼(Sxy = conj(X)·Y).
// 같은 신호를 두 번 넣으면(x = y) 평범한 평균 전력 스펙트럼이 된다.
// ---------------------------------------------------------------------------------------------
export interface WelchOptions {
  fftSize: number;
  /** 분석 구간(샘플 번호). 끝은 포함하지 않는다. */
  start: number;
  end: number;
  hop?: number;
}

export interface WelchSpectra {
  sampleRate: number;
  fftSize: number;
  frames: number;
  frequencies: Float64Array;
  sxx: Float64Array;
  syy: Float64Array;
  sxyRe: Float64Array;
  sxyIm: Float64Array;
}

export function welchSpectra(input: Samples, output: Samples, sampleRate: number, options: WelchOptions): WelchSpectra {
  const { fftSize, start, end } = options;
  const hop = options.hop ?? fftSize / 2;
  const bins = fftSize / 2 + 1;
  const window = hannWindow(fftSize);
  const sxx = new Float64Array(bins);
  const syy = new Float64Array(bins);
  const sxyRe = new Float64Array(bins);
  const sxyIm = new Float64Array(bins);
  const xRe = new Float64Array(fftSize);
  const xIm = new Float64Array(fftSize);
  const yRe = new Float64Array(fftSize);
  const yIm = new Float64Array(fftSize);
  let frames = 0;
  for (let position = start; position + fftSize <= end; position += hop) {
    for (let i = 0; i < fftSize; i += 1) {
      const weight = window[i];
      xRe[i] = input[position + i] * weight;
      xIm[i] = 0;
      yRe[i] = output[position + i] * weight;
      yIm[i] = 0;
    }
    fft(xRe, xIm);
    fft(yRe, yIm);
    for (let k = 0; k < bins; k += 1) {
      sxx[k] += xRe[k] * xRe[k] + xIm[k] * xIm[k];
      syy[k] += yRe[k] * yRe[k] + yIm[k] * yIm[k];
      sxyRe[k] += xRe[k] * yRe[k] + xIm[k] * yIm[k];
      sxyIm[k] += xRe[k] * yIm[k] - xIm[k] * yRe[k];
    }
    frames += 1;
  }
  if (frames === 0) throw new Error('분석 구간이 FFT 크기보다 짧습니다.');
  const frequencies = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) frequencies[k] = (k * sampleRate) / fftSize;
  return { sampleRate, fftSize, frames, frequencies, sxx, syy, sxyRe, sxyIm };
}

/** H1 추정(선형 전달함수 크기, dB). 입력에 섞이지 않은 잡음에 강하다. */
export function h1MagnitudeDb(spectra: WelchSpectra): Float64Array {
  const bins = spectra.sxx.length;
  const result = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) {
    const cross = Math.hypot(spectra.sxyRe[k], spectra.sxyIm[k]);
    result[k] = spectra.sxx[k] > 0 ? dbOf(cross / spectra.sxx[k]) : FLOOR_DB;
  }
  return result;
}

/** center 마다 ±fraction/2 옥타브 안의 전력 비 10·log10(ΣSyy / ΣSxx). 압축기처럼 비선형인 처리의 대역 이득에 쓴다. */
export function bandGainDb(spectra: WelchSpectra, centers: number[], fraction: number): number[] {
  return centers.map((center) => {
    const low = center * 2 ** (-fraction / 2);
    const high = center * 2 ** (fraction / 2);
    let input = 0;
    let output = 0;
    for (let k = 0; k < spectra.frequencies.length; k += 1) {
      const frequency = spectra.frequencies[k];
      if (frequency < low || frequency >= high) continue;
      input += spectra.sxx[k];
      output += spectra.syy[k];
    }
    return input > 0 && output > 0 ? 10 * Math.log10(output / input) : FLOOR_DB;
  });
}

/** 출력만 본 대역 전력(dB). 대역마다 같은 bin 을 합하므로 두 신호의 차이를 비교하기에 알맞다. */
export function bandPowerDb(spectra: WelchSpectra, centers: number[], fraction: number): number[] {
  return centers.map((center) => {
    const low = center * 2 ** (-fraction / 2);
    const high = center * 2 ** (fraction / 2);
    let power = 0;
    for (let k = 0; k < spectra.frequencies.length; k += 1) {
      const frequency = spectra.frequencies[k];
      if (frequency >= low && frequency < high) power += spectra.syy[k];
    }
    return power > 0 ? 10 * Math.log10(power) : FLOOR_DB;
  });
}

export function octaveCenters(fMin: number, fMax: number, perOctave: number): number[] {
  const centers: number[] = [];
  for (let step = 0; fMin * 2 ** (step / perOctave) <= fMax * 1.0001; step += 1) {
    centers.push(fMin * 2 ** (step / perOctave));
  }
  return centers;
}

// ---------------------------------------------------------------------------------------------
// 노치(골) 찾기
// ---------------------------------------------------------------------------------------------
export interface Notch {
  frequency: number;
  valueDb: number;
  /** 양옆 봉우리 중 낮은 쪽과의 차(dB). 얕은 흔들림을 걸러내는 데 쓴다. */
  prominenceDb: number;
}

export interface NotchOptions {
  fMin: number;
  fMax: number;
  minProminenceDb?: number;
  /** 앞뒤로 이만큼 bin 을 평균해 잔떨림을 줄인다. */
  smoothBins?: number;
}

export function findNotches(frequencies: Float64Array, magnitudeDb: Float64Array, options: NotchOptions): Notch[] {
  const smoothBins = options.smoothBins ?? 1;
  const minProminence = options.minProminenceDb ?? 1;
  const count = magnitudeDb.length;
  const smooth = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    let used = 0;
    for (let j = Math.max(0, i - smoothBins); j <= Math.min(count - 1, i + smoothBins); j += 1) {
      sum += magnitudeDb[j];
      used += 1;
    }
    smooth[i] = sum / used;
  }
  const notches: Notch[] = [];
  for (let i = 1; i < count - 1; i += 1) {
    const frequency = frequencies[i];
    if (frequency < options.fMin || frequency > options.fMax) continue;
    if (!(smooth[i] < smooth[i - 1] && smooth[i] <= smooth[i + 1])) continue;
    let leftPeak = smooth[i];
    for (let j = i - 1; j >= 0 && smooth[j] >= smooth[i]; j -= 1) leftPeak = Math.max(leftPeak, smooth[j]);
    let rightPeak = smooth[i];
    for (let j = i + 1; j < count && smooth[j] >= smooth[i]; j += 1) rightPeak = Math.max(rightPeak, smooth[j]);
    const prominenceDb = Math.min(leftPeak, rightPeak) - smooth[i];
    if (prominenceDb >= minProminence) notches.push({ frequency, valueDb: smooth[i], prominenceDb });
  }
  return notches;
}

/**
 * 응답에서 완만한 굴곡(±halfWidthHz 이동 평균)을 뺀 나머지의 최대−최소(dB).
 * 넓게 퍼진 설계상의 노치·공진은 빠지고, 좁은 간격으로 반복되는 빗살 무늬만 남는다.
 */
export function detrendedRippleDb(
  frequencies: Float64Array,
  magnitudeDb: Float64Array,
  fMin: number,
  fMax: number,
  halfWidthHz: number,
): number {
  const count = magnitudeDb.length;
  const prefix = new Float64Array(count + 1);
  for (let i = 0; i < count; i += 1) prefix[i + 1] = prefix[i] + magnitudeDb[i];
  const binWidth = frequencies[1] - frequencies[0];
  const half = Math.max(1, Math.round(halfWidthHz / binWidth));
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    if (frequencies[i] < fMin || frequencies[i] > fMax) continue;
    const from = Math.max(0, i - half);
    const to = Math.min(count, i + half + 1);
    const residual = magnitudeDb[i] - (prefix[to] - prefix[from]) / (to - from);
    low = Math.min(low, residual);
    high = Math.max(high, residual);
  }
  return Number.isFinite(low) ? high - low : 0;
}

// ---------------------------------------------------------------------------------------------
// 사인 성분 크기·왜곡률
// ---------------------------------------------------------------------------------------------
export interface HarmonicAmplitudes {
  /** index 0 이 기본음, 1 이 2배음 … 나이퀴스트를 넘는 배음은 0. */
  amplitudes: number[];
}

/**
 * Hann 창 FFT 한 번으로 기본음과 배음의 크기(피크 진폭)를 잰다. 주파수 bin 에 딱 맞지 않아도
 * 주변 ±3 bin 의 에너지를 합하므로 같은 진폭의 사인이면 같은 값이 나온다.
 */
export function harmonicAmplitudes(
  signal: Samples,
  sampleRate: number,
  fundamental: number,
  start: number,
  size: number,
  count: number,
): HarmonicAmplitudes {
  const window = hannWindow(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let windowEnergy = 0;
  for (let i = 0; i < size; i += 1) {
    re[i] = signal[start + i] * window[i];
    windowEnergy += window[i] * window[i];
  }
  fft(re, im);
  const amplitudes: number[] = [];
  for (let harmonic = 1; harmonic <= count; harmonic += 1) {
    const frequency = fundamental * harmonic;
    if (frequency >= sampleRate / 2 - 100) {
      amplitudes.push(0);
      continue;
    }
    const center = Math.round((frequency * size) / sampleRate);
    let energy = 0;
    for (let k = Math.max(1, center - 3); k <= Math.min(size / 2 - 1, center + 3); k += 1) {
      energy += re[k] * re[k] + im[k] * im[k];
    }
    amplitudes.push(Math.sqrt((4 * energy) / (size * windowEnergy)));
  }
  return { amplitudes };
}

export function toneAmplitude(signal: Samples, sampleRate: number, frequency: number, start: number, size: number): number {
  return harmonicAmplitudes(signal, sampleRate, frequency, start, size, 1).amplitudes[0];
}

/** 2~count 배음의 합성 크기 ÷ 기본음 크기(%). */
export function thdPercent(
  signal: Samples,
  sampleRate: number,
  fundamental: number,
  start: number,
  size: number,
  count = 10,
): number {
  const { amplitudes } = harmonicAmplitudes(signal, sampleRate, fundamental, start, size, count);
  const base = amplitudes[0];
  if (base <= 1e-9) return 0;
  let sum = 0;
  for (let i = 1; i < amplitudes.length; i += 1) sum += amplitudes[i] * amplitudes[i];
  return (Math.sqrt(sum) / base) * 100;
}

// ---------------------------------------------------------------------------------------------
// 영점 통과로 본 순간 주파수(음정 흔들림)
// ---------------------------------------------------------------------------------------------
export interface CycleFrequencies {
  /** 각 주기가 끝나는 시각(샘플 번호). */
  positions: number[];
  frequencies: number[];
}

export function cycleFrequencies(signal: Samples, sampleRate: number, start: number, end: number): CycleFrequencies {
  const crossings: number[] = [];
  const to = Math.min(signal.length, end);
  for (let i = Math.max(1, start); i < to; i += 1) {
    if (signal[i - 1] < 0 && signal[i] >= 0) {
      crossings.push(i - 1 + -signal[i - 1] / (signal[i] - signal[i - 1]));
    }
  }
  const positions: number[] = [];
  const frequencies: number[] = [];
  for (let i = 1; i < crossings.length; i += 1) {
    positions.push(crossings[i]);
    frequencies.push(sampleRate / (crossings[i] - crossings[i - 1]));
  }
  return { positions, frequencies };
}

// ---------------------------------------------------------------------------------------------
// 지연 측정
// ---------------------------------------------------------------------------------------------
/** x 를 y 와 견주어 y 가 얼마나 늦는지(샘플, 소수 포함). 0..maxLag 범위에서 |상호상관|이 가장 큰 곳. */
export function crossCorrelationLag(
  x: Samples,
  y: Samples,
  maxLag: number,
  start: number,
  end: number,
): { lagSamples: number; coefficient: number } {
  const last = Math.min(x.length, y.length - maxLag, end);
  let xEnergy = 0;
  let yEnergy = 0;
  for (let n = start; n < last; n += 1) {
    xEnergy += x[n] * x[n];
    yEnergy += y[n] * y[n];
  }
  const values = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let n = start; n < last; n += 1) sum += x[n] * y[n + lag];
    values[lag] = Math.abs(sum);
  }
  let best = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) if (values[lag] > values[best]) best = lag;
  let refined = best;
  if (best > 0 && best < maxLag) {
    const a = values[best - 1];
    const b = values[best];
    const c = values[best + 1];
    const denominator = a - 2 * b + c;
    if (denominator !== 0) refined = best + (0.5 * (a - c)) / denominator;
  }
  const norm = Math.sqrt(xEnergy * yEnergy);
  return { lagSamples: refined, coefficient: norm > 0 ? values[best] / norm : 0 };
}

/** start 이후 처음으로 |신호| 가 threshold 이상인 샘플 번호. 없으면 -1. */
export function firstIndexAtOrAbove(signal: Samples, threshold: number, start = 0, end = signal.length): number {
  for (let i = Math.max(0, start); i < Math.min(signal.length, end); i += 1) {
    if (Math.abs(signal[i]) >= threshold) return i;
  }
  return -1;
}

/** 표본 간 변화(1차 차분)의 최댓값. 클릭(불연속)을 찾는 데 쓴다. */
export function maxStep(signal: Samples, start: number, end: number): number {
  let step = 0;
  for (let i = Math.max(1, start); i < Math.min(signal.length, end); i += 1) {
    step = Math.max(step, Math.abs(signal[i] - signal[i - 1]));
  }
  return step;
}
