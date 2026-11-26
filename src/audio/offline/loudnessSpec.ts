// 프리셋 음량 정렬의 기준과 공식(설계서 4.5절 GS-1·GS-2·GS-7, 결정 D6, S1.4c).
// 순수 계산만 있어서 엔진·스토어·화면·계산 스크립트·오디오 프로브가 모두 이 파일 하나를 쓴다. 기준값은 여기에만 둔다.
// 이 파일은 Web Audio 를 쓰지 않는다 → 스토어가 가져와도 렌더 코드(renderChain)가 번들에 끌려오지 않는다.
import { LIMITER_CEILING_DB } from '../engine/limiterSpec';

/**
 * D6 — REF-PC 를 넣었을 때 프리셋 출력의 평균 음량(RMS, dBFS). **이 값 하나만 바꾸면** `npm run trims` 로 팩토리 trim 을 다시 계산한다.
 * 정확한 값은 실제 기타로 들어 보고 확정하기로 했다(설계서 D6) — 지금은 설계서의 잠정값이다.
 */
export const PRESET_TARGET_RMS_DBFS = -20;

/** GS-2 의 허용 폭(± dB). P-05 가 프리셋마다 이 안에 있는지 판정한다. */
export const PRESET_TARGET_TOLERANCE_DB = 2;

/**
 * D6 의 예외 규칙: 표준 목표에서 얼마나 다르게 둘지(dB). 프리셋 id → 오프셋.
 * 'Headphone Safe Start' 는 이름과 설명(낮은 레벨로 시작하는 안전 프리셋)이 '작게 시작'이 목적이라 표준보다 6 dB 낮게 둔다.
 * 사람이 정할 일을 자율 모드에서 작업자가 정했다 — REFACTOR_LOG L-38. 0 으로 바꾸거나 이 줄을 지우면 표준과 같아진다.
 */
export const PRESET_TARGET_OFFSETS_DB: Readonly<Record<string, number>> = {
  'factory-headphone-safe-start': -6,
};

/** 비정상 값 방지: trim 은 ±24 dB 안에서만 쓴다(GS-2). */
export const PRESET_TRIM_LIMIT_DB = 24;

/**
 * GS-7 — 보정을 적용한 REF-PC 의 피크가 리미터 천장(−1 dBFS)을 넘어도 되는 양(dB). 리미터는 사고 방지용이라 평소에 이보다 더 누르지 않게 한다.
 * 그래서 trim 은 '피크가 0 dBFS 를 넘지 않는' 값까지만 키운다. 순간 피크가 큰 클린 프리셋은 평균 음량이 목표보다 조금 낮게 남는다(REFACTOR_LOG L-40).
 */
export const PRESET_MAX_LIMITER_REDUCTION_DB = 1;

/** 프리셋을 불러올 때 trim 이 새 값으로 바뀌는 시간(초). 소리가 갑자기 뛰지 않게 한다. */
export const PRESET_TRIM_RAMP_SECONDS = 0.03;

/** 이보다 작게 측정되면 소리가 없는 것으로 보고 trim 을 계산하지 않는다(게이트가 다 막는 체인 등). */
export const MIN_MEASURABLE_RMS_DBFS = -80;

/** 이 프리셋의 목표 음량(dBFS). 예외가 있으면 그만큼 다르다. 사용자 프리셋(id 모름)은 표준이다. */
export function targetRmsDbfsFor(presetId?: string): number {
  return PRESET_TARGET_RMS_DBFS + (presetId ? PRESET_TARGET_OFFSETS_DB[presetId] ?? 0 : 0);
}

/** 저장된 trim 값을 정리한다. 숫자가 아니면 0(설계서 M6), 아니면 ±24 dB 로 제한한다. */
export function clampTrimDb(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-PRESET_TRIM_LIMIT_DB, Math.min(PRESET_TRIM_LIMIT_DB, value));
}

/** 0.1 dB 단위로 반올림한다(화면에 '+x.x dB' 로 보이는 값과 저장 값이 같도록). -0 은 0 으로. */
export function roundTrimDb(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** 0.1 dB 단위로 내린다(피크 여유 한도를 넘지 않도록 한도 쪽은 반올림하지 않고 내린다). -0 은 0 으로. */
function floorTrimDb(value: number): number {
  const floored = Math.floor(value * 10 + 1e-9) / 10;
  return floored === 0 ? 0 : floored;
}

/**
 * GS-7 — 보정 전 피크(`measuredPeakDbfs`)를 가진 소리에 줄 수 있는 trim 의 상한(dB).
 * 이 trim 이면 피크가 천장 + 허용 감소량(= 0 dBFS)에 닿는다. 피크가 이미 0 dBFS 를 넘으면 음수(반드시 줄여야 한다).
 */
export function headroomTrimLimitDb(measuredPeakDbfs: number): number {
  return LIMITER_CEILING_DB + PRESET_MAX_LIMITER_REDUCTION_DB - measuredPeakDbfs;
}

/**
 * GS-2 + GS-7 — 보정 전 REF-PC 출력(리미터 없음)의 평균 음량·피크로 정하는 trim(dB).
 * 평균을 목표(`targetDbfs`)에 맞추되, 피크가 0 dBFS 를 넘어 리미터가 1 dB 보다 더 눌러야 하게 되면 거기서 멈춘다.
 * 피크를 모르면(`measuredPeakDbfs` 생략) 평균만 맞춘다. 측정할 소리가 없거나 숫자가 아니면 0(보정하지 않음).
 */
export function trimDbFor(
  measuredRmsDbfs: number,
  targetDbfs: number = PRESET_TARGET_RMS_DBFS,
  measuredPeakDbfs?: number,
): number {
  if (!Number.isFinite(measuredRmsDbfs) || measuredRmsDbfs < MIN_MEASURABLE_RMS_DBFS) return 0;
  const byLevel = roundTrimDb(clampTrimDb(targetDbfs - measuredRmsDbfs));
  if (measuredPeakDbfs === undefined || !Number.isFinite(measuredPeakDbfs)) return byLevel;
  return Math.min(byLevel, floorTrimDb(clampTrimDb(headroomTrimLimitDb(measuredPeakDbfs))));
}

/**
 * 피크 여유까지 따졌을 때 이 프리셋이 도달할 수 있는 가장 큰 목표(dBFS). 여유가 충분하면 목표 그대로다.
 * 순간 피크가 큰 소리는 평균 음량을 목표까지 올리면 리미터가 눌러야 하므로 목표보다 낮은 곳에서 멈춘다.
 */
export function achievableTargetDbfs(
  measuredRmsDbfs: number,
  measuredPeakDbfs: number,
  targetDbfs: number = PRESET_TARGET_RMS_DBFS,
): number {
  if (!Number.isFinite(measuredRmsDbfs) || !Number.isFinite(measuredPeakDbfs)) return targetDbfs;
  return Math.min(targetDbfs, measuredRmsDbfs + headroomTrimLimitDb(measuredPeakDbfs));
}

/** 피크 여유 때문에 trim 이 평균 목표에 못 미치는가(그 프리셋은 목표보다 조용하게 남는다). */
export function isHeadroomLimited(
  measuredRmsDbfs: number,
  measuredPeakDbfs: number,
  targetDbfs: number = PRESET_TARGET_RMS_DBFS,
): boolean {
  return trimDbFor(measuredRmsDbfs, targetDbfs, measuredPeakDbfs) < trimDbFor(measuredRmsDbfs, targetDbfs) - 1e-9;
}

/** GS-7 — 이 피크(dBFS)를 리미터가 천장까지 내려야 하는 양(dB). 천장 아래면 0. */
export function limiterReductionDb(peakDbfs: number): number {
  return Math.max(0, peakDbfs - LIMITER_CEILING_DB);
}

/** 화면 표시: '+3.4 dB', '−2.0 dB', '0.0 dB'. */
export function formatTrimDb(trimDb: number): string {
  const value = roundTrimDb(clampTrimDb(trimDb));
  if (value === 0) return '0.0 dB';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} dB`;
}

// ---------------------------------------------------------------------------------------------
// 렌더 결과에서 음량을 읽는 계산. src/audio/testing/measure.ts 와 같은 식이라 프로브의 측정값과 같은 숫자가 나온다.
// ---------------------------------------------------------------------------------------------
const FLOOR_DB = -200;

function dbOf(linear: number): number {
  return linear <= 1e-10 ? FLOOR_DB : 20 * Math.log10(linear);
}

function rmsLinear(samples: Float32Array, start: number, end: number): number {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(samples.length, Math.floor(end));
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

/** 여러 채널의 전력 평균으로 낸 RMS(dBFS). 모노 신호가 양쪽에 같게 나오면 한 채널의 RMS 와 같다. */
export function stereoRmsDbfs(channels: Float32Array[], start = 0, end = channels[0]?.length ?? 0): number {
  if (channels.length === 0) return FLOOR_DB;
  let power = 0;
  for (const channel of channels) power += rmsLinear(channel, start, end) ** 2;
  return dbOf(Math.sqrt(power / channels.length));
}

/** 채널 전체에서 가장 큰 샘플 피크(dBFS). */
export function peakDbfs(channels: Float32Array[], start = 0, end = channels[0]?.length ?? 0): number {
  let peak = 0;
  for (const channel of channels) {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(channel.length, Math.floor(end));
    for (let i = from; i < to; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return dbOf(peak);
}
