// 하울링 감지 코어(설계서 4.3절 알고리즘, 부록 B 수치, 결정 D9). Web Audio 에 의존하지 않는 순수 계산이다.
// output-guard.worklet.ts 가 오디오 스레드에서 쓰고, 프로브(P-07)와 Node 시험이 같은 코드를 그대로 부른다.
//
// 왜 입력 쪽인가: 기타 줄의 원신호는 반드시 줄어든다. 하울링은 스피커 소리가 마이크로 되돌아오는 것이라 입력의 한 음이
// 줄지 않거나 커진다. 출력 레벨은 보지 않으므로 컴프레서·퍼즈가 출력을 평평하게 만들어도, 기본 구성의 낮은 출력에서도 동작한다.
//
// 흐름: 매 hop(1024 샘플)마다 최근 2048 샘플을 Hann 창으로 FFT 해서
//   levelDb(RMS), fPeak(대역 안 최대 성분, 주파수), tonal(상위 피크 8개의 에너지 비율)을 구하고,
//   '후보 프레임'(레벨 ≥ −50 dBFS, tonal ≥ 0.8, 기준 음높이 ±20센트)이 1.0초 이어지면 그 구간 레벨의 기울기를 본다.
//   기울기가 −1.0 dB/s 이상이면(줄지 않으면) 하울링이다.

import {
  HOWL_BAND_HIGH_HZ,
  HOWL_BAND_LOW_HZ,
  HOWL_HOLD_SECONDS,
  HOWL_HOP_SAMPLES,
  HOWL_LEVEL_FLOOR_DB,
  HOWL_MIN_SLOPE_DB_PER_SECOND,
  HOWL_ONSET_LOOKBACK_FRAMES,
  HOWL_ONSET_RISE_DB,
  HOWL_PITCH_TOLERANCE_CENTS,
  HOWL_REFERENCE_HOLD_DB,
  HOWL_SLOPE_SKIP_FRAMES,
  HOWL_TONAL_PEAK_COUNT,
  HOWL_TONAL_PEAK_HALF_WIDTH_BINS,
  HOWL_TONAL_RATIO,
  HOWL_WINDOW_SAMPLES,
  LEVEL_SILENT_DB,
} from '../engine/guardSpec';

// ---------------------------------------------------------------------------------------------
// 스펙트럼 분석: 한 프레임에서 레벨·최대 성분·톤 비율을 뽑는다.
// ---------------------------------------------------------------------------------------------
export interface HowlFrameFeatures {
  /** 창 전체의 RMS(dBFS). 무음이면 LEVEL_SILENT_DB. */
  levelDb: number;
  /** 분석 대역 안에서 가장 큰 성분의 주파수(Hz). 대역에 소리가 없으면 0. */
  peakHz: number;
  /** 톤 성분 비율(0~1): 상위 피크들 에너지 ÷ 대역 전체 에너지. */
  tonal: number;
}

/** 대역의 에너지가 이보다 작으면 비율을 정하지 않는다(무음에 가까운 신호의 0/0 방지). */
const MIN_BAND_ENERGY = 1e-18;

export class HowlSpectrum {
  readonly sampleRate: number;
  readonly size: number;
  /** FFT 빈 하나의 폭(Hz) */
  readonly binHz: number;
  /** 분석 대역의 첫·마지막 빈 */
  readonly bandLow: number;
  readonly bandHigh: number;

  private readonly half: number;
  private readonly window: Float64Array;
  private readonly cosHalf: Float64Array;
  private readonly sinHalf: Float64Array;
  private readonly cosFull: Float64Array;
  private readonly sinFull: Float64Array;
  private readonly reverse: Uint16Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly power: Float64Array;
  private readonly claimed: Uint32Array;
  private claimStamp = 0;

  constructor(sampleRate: number, size: number = HOWL_WINDOW_SAMPLES) {
    if (size < 8 || (size & (size - 1)) !== 0) throw new Error('FFT 크기는 2 의 거듭제곱이어야 합니다.');
    this.sampleRate = sampleRate;
    this.size = size;
    this.half = size / 2;
    this.binHz = sampleRate / size;
    this.bandLow = Math.ceil(HOWL_BAND_LOW_HZ / this.binHz);
    this.bandHigh = Math.min(this.half - 2, Math.floor(HOWL_BAND_HIGH_HZ / this.binHz));

    // 주기 Hann 창(DFT 짝수형). 이 창이면 인접 두 빈의 크기 비로 주파수를 정확히 풀 수 있다(peakFrequency).
    this.window = new Float64Array(size);
    for (let n = 0; n < size; n += 1) this.window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);

    // 실수 FFT 를 size/2 점 복소 FFT 로 푼다(짝수·홀수 표본을 실수·허수로 묶는다).
    const half = this.half;
    this.cosHalf = new Float64Array(half / 2);
    this.sinHalf = new Float64Array(half / 2);
    for (let m = 0; m < half / 2; m += 1) {
      this.cosHalf[m] = Math.cos((2 * Math.PI * m) / half);
      this.sinHalf[m] = -Math.sin((2 * Math.PI * m) / half);
    }
    this.cosFull = new Float64Array(half + 1);
    this.sinFull = new Float64Array(half + 1);
    for (let k = 0; k <= half; k += 1) {
      this.cosFull[k] = Math.cos((2 * Math.PI * k) / size);
      this.sinFull[k] = -Math.sin((2 * Math.PI * k) / size);
    }
    this.reverse = new Uint16Array(half);
    const bits = Math.log2(half);
    for (let n = 0; n < half; n += 1) {
      let reversed = 0;
      for (let b = 0; b < bits; b += 1) reversed |= ((n >> b) & 1) << (bits - 1 - b);
      this.reverse[n] = reversed;
    }
    this.re = new Float64Array(half);
    this.im = new Float64Array(half);
    this.power = new Float64Array(half + 1);
    this.claimed = new Uint32Array(half + 1);
  }

  /** 마지막 analyze() 의 전력 스펙트럼(빈 0..size/2). 시험용. */
  get lastPower(): Float64Array {
    return this.power;
  }

  /**
   * frame(길이 size)을 분석한다. referenceHz 가 있으면(후보가 이어지는 중) 그 음의 피크가 가장 큰 피크에서 3 dB 안에 있는 한
   * 그 음을 '가장 큰 성분'으로 본다(HOWL_REFERENCE_HOLD_DB).
   */
  analyze(frame: ArrayLike<number>, referenceHz: number | null = null): HowlFrameFeatures {
    const { size, half, window: hann, re, im, reverse, power } = this;

    let sumSquares = 0;
    for (let n = 0; n < half; n += 1) {
      const even = frame[2 * n];
      const odd = frame[2 * n + 1];
      sumSquares += even * even + odd * odd;
      const target = reverse[n];
      re[target] = even * hann[2 * n];
      im[target] = odd * hann[2 * n + 1];
    }
    const meanSquare = sumSquares / size;
    const levelDb = meanSquare > 1e-12 ? 10 * Math.log10(meanSquare) : LEVEL_SILENT_DB;

    // half 점 복소 FFT(제자리, 비트 반전 입력)
    for (let length = 2; length <= half; length <<= 1) {
      const halfLength = length >> 1;
      const step = half / length;
      for (let start = 0; start < half; start += length) {
        for (let j = 0, t = 0; j < halfLength; j += 1, t += step) {
          const wr = this.cosHalf[t];
          const wi = this.sinHalf[t];
          const a = start + j;
          const b = a + halfLength;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }

    // 실수 입력의 스펙트럼 X[k] (k = 0..size/2)를 풀어 전력으로 둔다.
    for (let k = 0; k <= half; k += 1) {
      const ia = k % half;
      const ib = (half - k) % half;
      const zr = re[ia];
      const zi = im[ia];
      const cr = re[ib];
      const ci = -im[ib];
      const evenR = 0.5 * (zr + cr);
      const evenI = 0.5 * (zi + ci);
      const oddR = 0.5 * (zi - ci);
      const oddI = -0.5 * (zr - cr);
      const wr = this.cosFull[k];
      const wi = this.sinFull[k];
      const xr = evenR + wr * oddR - wi * oddI;
      const xi = evenI + wr * oddI + wi * oddR;
      power[k] = xr * xr + xi * xi;
    }

    const { bandLow, bandHigh, claimed } = this;
    let bandEnergy = 0;
    for (let k = bandLow; k <= bandHigh; k += 1) bandEnergy += power[k];
    if (bandEnergy < MIN_BAND_ENERGY) return { levelDb, peakHz: 0, tonal: 0 };

    // 상위 피크 N 개(각 ±2 빈)의 에너지. 앞서 고른 피크의 이웃은 다시 세지 않는다.
    this.claimStamp += 1;
    const stamp = this.claimStamp;
    let peakEnergy = 0;
    let strongestBin = -1;
    let strongestPower = 0;
    for (let pick = 0; pick < HOWL_TONAL_PEAK_COUNT; pick += 1) {
      let bestBin = -1;
      let bestPower = 0;
      for (let k = bandLow; k <= bandHigh; k += 1) {
        const value = power[k];
        // 대역 가장자리의 빈은 바깥 이웃과 견주지 않는다(대역 밖으로 걸친 음도 가장자리 빈에서 피크로 잡는다).
        if (
          value > bestPower &&
          claimed[k] !== stamp &&
          (k === bandLow || value >= power[k - 1]) &&
          (k === bandHigh || value >= power[k + 1])
        ) {
          bestPower = value;
          bestBin = k;
        }
      }
      if (bestBin < 0) break;
      if (pick === 0) {
        strongestBin = bestBin;
        strongestPower = bestPower;
      }
      const from = Math.max(bandLow, bestBin - HOWL_TONAL_PEAK_HALF_WIDTH_BINS);
      const to = Math.min(bandHigh, bestBin + HOWL_TONAL_PEAK_HALF_WIDTH_BINS);
      for (let k = from; k <= to; k += 1) {
        if (claimed[k] !== stamp) {
          claimed[k] = stamp;
          peakEnergy += power[k];
        }
      }
    }
    if (strongestBin < 0) return { levelDb, peakHz: 0, tonal: 0 };

    let chosenBin = strongestBin;
    if (referenceHz !== null && referenceHz > 0) {
      // 기준 음 근처(±1 빈)의 가장 큰 빈이 가장 큰 피크에서 HOLD dB 안에 있으면 그 음을 따라간다.
      const center = Math.round(referenceHz / this.binHz);
      let nearBin = -1;
      let nearPower = 0;
      for (let k = Math.max(bandLow, center - 1); k <= Math.min(bandHigh, center + 1); k += 1) {
        if (power[k] > nearPower && (k === bandLow || power[k] >= power[k - 1]) && (k === bandHigh || power[k] >= power[k + 1])) {
          nearPower = power[k];
          nearBin = k;
        }
      }
      if (nearBin >= 0 && nearPower >= strongestPower * 10 ** (-HOWL_REFERENCE_HOLD_DB / 10)) chosenBin = nearBin;
    }

    return { levelDb, peakHz: this.peakFrequency(chosenBin), tonal: Math.min(1, peakEnergy / bandEnergy) };
  }

  /**
   * 피크 빈 주변 세 빈의 크기로 주파수를 구한다. 주기 Hann 창에서는 참 주파수가 k 와 k+1 사이(오프셋 d)일 때
   * r = |X[k+1]| / |X[k]| 가 (1 + d) / (2 − d) 이므로 d = (2r − 1) / (1 + r) 로 정확히 풀린다. 반대쪽 이웃이 더 크면 거울로 푼다.
   */
  private peakFrequency(bin: number): number {
    const { power } = this;
    const center = Math.sqrt(power[bin]);
    if (center <= 0) return bin * this.binHz;
    const below = Math.sqrt(power[bin - 1]);
    const above = Math.sqrt(power[bin + 1]);
    let offset: number;
    if (above >= below) {
      const ratio = above / center;
      offset = (2 * ratio - 1) / (1 + ratio);
    } else {
      const ratio = below / center;
      offset = -((2 * ratio - 1) / (1 + ratio));
    }
    offset = Math.min(0.5, Math.max(-0.5, offset));
    return (bin + offset) * this.binHz;
  }
}

// ---------------------------------------------------------------------------------------------
// 판정: 프레임마다 나온 값으로 '줄지 않는 한 음이 1초 넘게 이어지는지' 본다.
// ---------------------------------------------------------------------------------------------
export interface HowlDetectorOptions {
  /** 새로 친 음(레벨이 단번에 뜀)이 끼면 후보를 처음부터 센다. 기본 켬(L-44). 끄면 부록 B 를 글자 그대로 따른다. */
  onsetRestart?: boolean;
  /** 후보가 이어지는 동안 기준 음을 붙든다. 기본 켬(L-44). 끄면 프레임마다 가장 큰 성분만 본다. */
  holdReference?: boolean;
  /** 기울기를 잴 때 후보 맨 앞 프레임(분석 창이 덜 찬)을 뺀다. 기본 켬(L-44). */
  skipLeadFrames?: boolean;
}

export type HowlEvent =
  /** 판정 진행 중(약 0.25초마다). 로그·디버그용이다. */
  | { type: 'suspect'; freqHz: number; heldMs: number; atSample: number }
  /** 하울링 판정. 이 뒤로는 reset() 전까지 더 판정하지 않는다. */
  | { type: 'cut'; freqHz: number; atSample: number };

/** 판정 진행 상황을 알리는 간격(초) */
const SUSPECT_INTERVAL_SECONDS = 0.25;

function centsBetween(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference);
}

export class HowlDetector {
  /** 사건이 생기면 부른다. */
  onEvent: ((event: HowlEvent) => void) | null = null;

  readonly sampleRate: number;
  readonly hopSeconds: number;
  /** 후보가 이만큼(프레임) 이어져야 기울기를 본다. HOWL_HOLD_SECONDS 이상이 되도록 올림한다. */
  readonly holdFrames: number;

  private readonly spectrum: HowlSpectrum;
  private readonly options: Required<HowlDetectorOptions>;
  private readonly ring = new Float32Array(HOWL_WINDOW_SAMPLES);
  private readonly frame = new Float32Array(HOWL_WINDOW_SAMPLES);
  private readonly runLevels: Float64Array;
  private ringWrite = 0;
  private total = 0;
  private sinceHop = 0;

  private runCount = 0;
  private runReferenceHz = 0;
  private runLastHz = 0;
  private tripped = false;

  constructor(sampleRate: number, options: HowlDetectorOptions = {}) {
    this.sampleRate = sampleRate;
    this.hopSeconds = HOWL_HOP_SAMPLES / sampleRate;
    this.holdFrames = Math.ceil(HOWL_HOLD_SECONDS / this.hopSeconds - 1e-9);
    this.spectrum = new HowlSpectrum(sampleRate);
    this.options = {
      onsetRestart: options.onsetRestart ?? true,
      holdReference: options.holdReference ?? true,
      skipLeadFrames: options.skipLeadFrames ?? true,
    };
    this.runLevels = new Float64Array(this.holdFrames);
  }

  /** 지금까지 넣은 샘플 수 */
  get samplesPushed(): number {
    return this.total;
  }

  /** 후보가 이어진 프레임 수(진행 중이 아니면 0). 시험용. */
  get runFrames(): number {
    return this.runCount;
  }

  get hasTripped(): boolean {
    return this.tripped;
  }

  /** 판정 상태를 비우고 다시 시작한다(새 세션). 입력 이력도 비운다. */
  reset(): void {
    this.ring.fill(0);
    this.ringWrite = 0;
    this.total = 0;
    this.sinceHop = 0;
    this.runCount = 0;
    this.runReferenceHz = 0;
    this.runLastHz = 0;
    this.tripped = false;
  }

  /** 모노 샘플을 흘려 넣는다. hop 이 찰 때마다 한 프레임을 분석한다. */
  push(samples: ArrayLike<number>, length: number = samples.length): void {
    for (let i = 0; i < length; i += 1) {
      this.ring[this.ringWrite] = samples[i];
      this.ringWrite = (this.ringWrite + 1) % HOWL_WINDOW_SAMPLES;
      this.total += 1;
      this.sinceHop += 1;
      if (this.sinceHop >= HOWL_HOP_SAMPLES) {
        this.sinceHop = 0;
        if (!this.tripped) this.analyzeFrame();
      }
    }
  }

  private analyzeFrame(): void {
    // 링 버퍼를 시간 순서로 펴서 한 프레임으로 만든다(가장 오래된 표본이 ringWrite 위치다).
    const tail = HOWL_WINDOW_SAMPLES - this.ringWrite;
    this.frame.set(this.ring.subarray(this.ringWrite), 0);
    this.frame.set(this.ring.subarray(0, this.ringWrite), tail);

    const reference = this.options.holdReference && this.runCount > 0 ? this.runReferenceHz : null;
    const { levelDb, peakHz, tonal } = this.spectrum.analyze(this.frame, reference);

    if (levelDb < HOWL_LEVEL_FLOOR_DB || tonal < HOWL_TONAL_RATIO || peakHz <= 0) {
      this.runCount = 0; // 후보가 끊겼다: 기준 음높이와 타이머를 처음부터
      return;
    }

    if (this.runCount > 0) {
      const pitchBroken = Math.abs(centsBetween(peakHz, this.runReferenceHz)) > HOWL_PITCH_TOLERANCE_CENTS;
      if (pitchBroken || (this.options.onsetRestart && this.isOnset(levelDb))) this.runCount = 0; // 이 프레임부터 새 후보
    }

    if (this.runCount === 0) this.runReferenceHz = peakHz;
    this.runLevels[this.runCount % this.holdFrames] = levelDb;
    this.runCount += 1;
    this.runLastHz = peakHz;

    const sampleIndex = this.total;
    if (this.runCount % Math.round(SUSPECT_INTERVAL_SECONDS / this.hopSeconds) === 0 && this.runCount < this.holdFrames) {
      this.onEvent?.({ type: 'suspect', freqHz: peakHz, heldMs: this.runCount * this.hopSeconds * 1000, atSample: sampleIndex });
    }

    if (this.runCount >= this.holdFrames && this.recentSlope() >= HOWL_MIN_SLOPE_DB_PER_SECOND) {
      this.tripped = true;
      this.onEvent?.({ type: 'cut', freqHz: this.runLastHz, atSample: sampleIndex });
    }
  }

  /** 이 프레임의 레벨이 후보가 이어지는 동안의 최근 몇 프레임보다 크게 뛰었는가(= 새로 친 음). */
  private isOnset(levelDb: number): boolean {
    const available = Math.min(HOWL_ONSET_LOOKBACK_FRAMES, this.runCount);
    let lowest = Infinity;
    for (let back = 1; back <= available; back += 1) {
      const level = this.runLevels[(this.runCount - back) % this.holdFrames];
      if (level < lowest) lowest = level;
    }
    return levelDb - lowest >= HOWL_ONSET_RISE_DB;
  }

  /**
   * 후보가 이어진 마지막 holdFrames 프레임에서 맨 앞 HOWL_SLOPE_SKIP_FRAMES 개를 뺀 레벨의 기울기(최소제곱 직선, dB/s).
   * 맨 앞 프레임은 분석 창이 아직 다 차지 않아 레벨이 낮게 나온다(HOWL_SLOPE_SKIP_FRAMES).
   */
  private recentSlope(): number {
    const skip = this.options.skipLeadFrames ? HOWL_SLOPE_SKIP_FRAMES : 0;
    const count = this.holdFrames - skip;
    const first = this.runCount - count;
    const mean = (count - 1) / 2;
    let levelSum = 0;
    for (let i = 0; i < count; i += 1) levelSum += this.runLevels[(first + i) % this.holdFrames];
    const levelMean = levelSum / count;
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < count; i += 1) {
      const dx = i - mean;
      numerator += dx * (this.runLevels[(first + i) % this.holdFrames] - levelMean);
      denominator += dx * dx;
    }
    return numerator / denominator / this.hopSeconds;
  }
}
