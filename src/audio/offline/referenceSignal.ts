// 기준 신호 REF-PC(합성 파워코드, 설계서 부록 A·GS-1)와 그것을 만드는 재료.
// 앱의 '음량 맞추기'(프리셋 trim 계산)와 오디오 프로브(src/audio/testing/signals.ts)가 **같은 신호**를 쓰도록 여기에 둔다.
// 앱 코드는 src/audio/testing/ 을 가져오지 않으므로(S1.4c) 공통 코드는 이 offline/ 폴더에 있고, signals.ts 가 다시 내보낸다.
// 난수가 없고 브라우저 의존도 없어서 같은 인자로 부르면 어디서나 같은 값이 나온다(scripts/loudness-regression.mjs 가 해시로 지킨다).

export type Samples = Float32Array;

export const dbToLinear = (db: number): number => 10 ** (db / 20);

export function peakOf(samples: Samples): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

/** 피크가 peakDb(dBFS)가 되도록 크기를 맞춘다(제자리 변경). */
export function normalizePeak(samples: Samples, peakDb: number): Samples {
  const peak = peakOf(samples);
  if (peak === 0) return samples;
  const scale = dbToLinear(peakDb) / peak;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= scale;
  return samples;
}

export function allocate(sampleRate: number, seconds: number): Float32Array {
  return new Float32Array(Math.round(sampleRate * seconds));
}

/** 배음 amplitude 1/n(톱니파 근사)을 가진 음. 나이퀴스트의 45%를 넘는 배음은 뺀다. */
export function addSawtoothVoice(
  target: Samples,
  sampleRate: number,
  fundamental: number,
  harmonics: number,
  envelope: (time: number) => number,
): void {
  const usable = Math.min(harmonics, Math.floor((sampleRate * 0.45) / fundamental));
  // 배음마다 같은 포락선을 쓰므로 한 번만 계산해 둔다.
  const shape = new Float64Array(target.length);
  for (let i = 0; i < shape.length; i += 1) shape[i] = envelope(i / sampleRate);
  for (let harmonic = 1; harmonic <= usable; harmonic += 1) {
    const step = (2 * Math.PI * fundamental * harmonic) / sampleRate;
    const amplitude = 1 / harmonic;
    for (let i = 0; i < target.length; i += 1) {
      target[i] += amplitude * Math.sin(step * i) * shape[i];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// REF-PC — 합성 파워코드
// E2·B2·E3, 각 성분은 amplitude 1/n 인 배음 20개, 피크 −12 dBFS, 시정수 1.2초 지수 감쇠, 2초마다 다시 침, 8초.
// 다시 칠 때 소리가 끊기지 않게 2 ms 선형 어택을 둔다(설계서는 어택을 정하지 않았다).
// ---------------------------------------------------------------------------------------------
export const REF_PC_NOTES_HZ = [82.41, 123.47, 164.81] as const;
export const REF_PC_PEAK_DB = -12;
const REF_PC_STRIKE_SECONDS = 2;
const REF_PC_TIME_CONSTANT = 1.2;
const REF_PC_ATTACK_SECONDS = 0.002;

export function refPc(sampleRate: number, seconds = 8): Samples {
  const out = allocate(sampleRate, seconds);
  const envelope = (time: number): number => {
    const sinceStrike = time - Math.floor(time / REF_PC_STRIKE_SECONDS) * REF_PC_STRIKE_SECONDS;
    const attack = Math.min(1, sinceStrike / REF_PC_ATTACK_SECONDS);
    return attack * Math.exp(-sinceStrike / REF_PC_TIME_CONSTANT);
  };
  for (const note of REF_PC_NOTES_HZ) addSawtoothVoice(out, sampleRate, note, 20, envelope);
  return normalizePeak(out, REF_PC_PEAK_DB);
}
