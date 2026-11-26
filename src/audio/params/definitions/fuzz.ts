import type { EffectSchema } from '../types';
import { choice, fmtSlider, levelParam, mixParam, param, percentParam } from './shared';

// ── Fuzz Gate(설계서 D15, S2.2) ────────────────────────────────────────────────
// 퍼즈 셰이퍼 앞에서 입력을 지켜보다가, 문턱보다 작은 소리(연주하지 않을 때의 잡음)를 막는다.
//   Gate 0        = 끔(소리가 전혀 달라지지 않는다)
//   Gate 1 ~ 100  = 문턱 −80 ~ −30 dBFS(1 이 −80, 100 이 −30)
//   히스테리시스  = 6 dB 고정(문턱에서 6 dB 아래로 내려가야 닫힌다)
// 열리고 닫히는 속도는 설계서가 정하지 않은 값이라 퍼즈에 맞게 빠르게 잡았다(S2.2 기록 L-83).
export const FUZZ_GATE_MIN_THRESHOLD_DB = -80;
export const FUZZ_GATE_MAX_THRESHOLD_DB = -30;
export const FUZZ_GATE_HYSTERESIS_DB = 6;
export const FUZZ_GATE_ATTACK_MS = 1;
export const FUZZ_GATE_HOLD_MS = 30;
export const FUZZ_GATE_RELEASE_MS = 80;
/** 닫혔을 때 줄이는 크기(dB). 노이즈 게이트 페달의 기본 Reduction 과 같다. */
export const FUZZ_GATE_CLOSED_REDUCTION_DB = -80;

/** Gate 값(0~100) → 문턱(dBFS). 끔(0 에 가까운 값)이면 null. */
export function fuzzGateThresholdDb(gate: number): number | null {
  if (!Number.isFinite(gate) || gate < 0.5) return null;
  const clamped = Math.min(100, Math.max(1, gate));
  return FUZZ_GATE_MIN_THRESHOLD_DB + ((clamped - 1) / 99) * (FUZZ_GATE_MAX_THRESHOLD_DB - FUZZ_GATE_MIN_THRESHOLD_DB);
}

/**
 * Gate 값 → 게이트 워클릿에 넣을 문턱과 줄이는 크기. 0(끔)은 줄이는 크기가 0 dB 라 게이트가 닫혀도 입력이 한 샘플도 바뀌지 않고 지나간다.
 * 1 이상은 문턱이 −80 ~ −30 dBFS 이고 닫히면 FUZZ_GATE_CLOSED_REDUCTION_DB 만큼 줄인다.
 */
export function fuzzGateWorkletSettings(gate: number): { thresholdDb: number; reductionDb: number } {
  const thresholdDb = fuzzGateThresholdDb(gate);
  return thresholdDb === null
    ? { thresholdDb: FUZZ_GATE_MIN_THRESHOLD_DB, reductionDb: 0 }
    : { thresholdDb, reductionDb: FUZZ_GATE_CLOSED_REDUCTION_DB };
}

export const fuzzSchema: EffectSchema = {
  type: 'fuzz',
  params: [
    levelParam(90, 100),
    percentParam('fuzz', 'Fuzz', '퍼즈(왜곡 세기)', 60),
    percentParam('tone', 'Tone', '톤(밝기)', 55),
    percentParam('bias', 'Bias', '바이어스(비대칭 정도)', 50),
    param({
      key: 'gate',
      label: 'Gate',
      name: '퍼즈 게이트(문턱보다 작은 소리를 막음)',
      unit: 'dB',
      min: 0,
      max: 100,
      step: 1,
      default: 15,
      format: (value) => {
        const threshold = fuzzGateThresholdDb(value);
        return threshold === null ? '끔' : `${Math.round(threshold)} dB`;
      },
    }),
    param({ key: 'lowCut', label: 'Low Cut', name: '로우컷 주파수', unit: 'Hz', min: 40, max: 180, step: 1, default: 70, format: fmtSlider(' Hz') }),
    mixParam(90),
  ],
  choices: [
    choice({
      key: 'mode',
      label: 'Mode',
      name: '퍼즈 방식',
      kind: 'enum',
      options: [
        { value: 'classic', label: 'Classic' },
        { value: 'gated', label: 'Gated' },
        { value: 'velcro', label: 'Velcro' },
      ],
      default: 'classic',
    }),
  ],
  defaultMix: 90,
};
