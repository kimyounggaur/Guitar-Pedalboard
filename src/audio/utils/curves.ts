import type { DriveParams } from '../types';

/** Drive Bias 저장값의 한도(설계서 S3.5). 화면·저장소·곡선이 모두 이 범위만 쓴다. 이전 범위는 ±1 이었다. */
export const DRIVE_BIAS_LIMIT = 0.3;

/** Distortion 모드 이득(곡선 기울기)의 양 끝. 노브 0% 에서 이 값, 100% 에서 MAX 이고 사이는 로그 간격이다. */
export const DISTORTION_GAIN_MIN = 6.5;
export const DISTORTION_GAIN_MAX = 255;

/**
 * Distortion 모드의 이득. 노브가 한 칸 오를 때마다 같은 비율(dB)로 커진다.
 *
 * 예전 식 `(1 + 60d)(0.16 + 0.8d) / (0.78 − 0.55d)` 는 노브 0 에서 0.2 배(−14 dB)로 시작해 30% 에서도
 * 보통 세기(REF-SINE −18 dBFS) 신호를 자르지 못했다. 같은 노브의 Overdrive 보다 깨끗했다(R3-5).
 * 노브 68% 이상에서는 예전 값보다 9% 안쪽으로만 크다. 프리셋(Distortion 은 68~82%)은 이미 깊이 잘리는 구간이라 소리가 거의 그대로다.
 */
export function distortionGain(drive: number): number {
  const knob = knobUnit(drive);
  return DISTORTION_GAIN_MIN * (DISTORTION_GAIN_MAX / DISTORTION_GAIN_MIN) ** knob;
}

/**
 * 바이어스 래퍼(10월 계획서 `withBias`, 설계서 S3.5): 이득을 곱한 **뒤** 바이어스를 더하고, 바이어스 자리의
 * 값을 빼서 입력 0 이 출력 0 이 되게 한다. 곡선이 0 을 지나므로 DC 가 생기지 않고, 이득이 바이어스보다
 * 훨씬 커도 신호가 포화 구간에 갇혀 사라지지 않는다.
 *
 * 예전 방식은 이득을 곱하기 **전** 입력에 `bias × 0.35` 를 더했다. 이득이 60 배일 때 바이어스 1 은 21 배 포화
 * 구간으로 신호를 통째로 밀어 넣어 소리가 사라졌다(입력 −6.1 dBpk → 출력 −68.2 dBpk).
 */
export function withBias(shape: (u: number) => number, gain: number, bias: number): (x: number) => number {
  const zero = shape(bias);
  return (x) => shape(x * gain + bias) - zero;
}

/** 노브 값(0~100)을 0~1 로. 숫자가 아니면 0. */
function knobUnit(drive: number): number {
  return Number.isFinite(drive) ? Math.min(1, Math.max(0, drive / 100)) : 0;
}

/** 표본 수가 홀수라 가운데 표본이 입력 0 에 정확히 놓인다(곡선의 0점 값을 곧바로 볼 수 있다). */
const DRIVE_CURVE_SAMPLES = 4097;

export function createDriveCurve(
  mode: DriveParams['mode'],
  drive: number,
  bias: number,
  samples = DRIVE_CURVE_SAMPLES,
): Float32Array {
  const curve = new Float32Array(samples);
  const knob = knobUnit(drive);
  const amount = 1 + knob * 60;
  const safeBias = Number.isFinite(bias) ? Math.min(DRIVE_BIAS_LIMIT, Math.max(-DRIVE_BIAS_LIMIT, bias)) : 0;

  let shape: (u: number) => number;
  let gain: number;
  if (mode === 'overdrive') {
    const norm = Math.tanh(amount);
    gain = amount;
    shape = (u) => Math.tanh(u) / norm;
  } else if (mode === 'crunch') {
    gain = amount;
    shape = (u) => {
      const soft = Math.tanh(u * 0.55);
      const hard = Math.max(-0.72, Math.min(0.72, u * 0.18)) / 0.72;
      return soft * 0.62 + hard * 0.38;
    };
  } else if (mode === 'distortion') {
    gain = distortionGain(drive);
    shape = (u) => Math.max(-1, Math.min(1, u));
  } else {
    gain = 1 / Math.max(0.05, 0.3 - knob * 0.22);
    shape = (u) => Math.max(-1, Math.min(1, u));
  }

  const apply = withBias(shape, gain, safeBias);
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    // 바이어스가 있으면 양쪽 포화 높이가 1 ∓ tanh(b) 로 갈린다. 둘의 합(꼭대기-꼭대기)은 늘 2 라서 1 로 자르지 않는다.
    curve[i] = Math.max(-2, Math.min(2, apply(x)));
  }

  return curve;
}

export function createCrunchCurve(gain: number, samples = 4096): Float32Array {
  const curve = new Float32Array(samples);
  const drive = 1.4 + (gain / 100) * 6;
  const hardClip = 0.86 - (gain / 100) * 0.36;
  const sag = 0.08 + (gain / 100) * 0.12;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    // Scale the input instead of adding a fixed offset: both halves meet at zero.
    const asymmetrical = x * (x > 0 ? 1 + sag * 0.18 : 1 - sag * 0.08);
    const soft = Math.tanh(asymmetrical * drive) / Math.tanh(drive);
    const clipped = Math.max(-hardClip, Math.min(hardClip, soft)) / hardClip;
    const body = Math.tanh((soft * 0.7 + clipped * 0.3) * 1.08);

    curve[i] = Math.max(-1, Math.min(1, body));
  }

  return curve;
}

export function createFuzzCurve(
  mode: 'classic' | 'gated' | 'velcro',
  fuzz: number,
  bias: number,
  samples = 4096,
): Float32Array {
  const curve = new Float32Array(samples);
  const amount = 2 + (fuzz / 100) * 92;
  const asymmetry = (bias - 50) / 100;
  const threshold = Math.max(0.055, 0.42 - (fuzz / 100) * 0.34);
  const starve = mode === 'velcro' ? 0.22 : mode === 'gated' ? 0.12 : 0.04;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    const shifted = x + asymmetry * 0.28;
    const folded = shifted > 0.74 ? 1.48 - shifted : shifted < -0.82 ? -1.64 - shifted : shifted;
    const hard = Math.max(-threshold, Math.min(threshold, folded * amount * 0.09)) / threshold;
    const square = hard >= 0 ? 1 - Math.exp(-Math.abs(hard) * 2.6) : -1 + Math.exp(-Math.abs(hard) * 2.2);
    const sputter = Math.abs(x) < starve ? 0 : square;
    const shaped = mode === 'classic' ? hard * 0.38 + square * 0.62 : sputter;

    curve[i] = Math.max(-1, Math.min(1, shaped - asymmetry * 0.16));
  }

  return curve;
}
