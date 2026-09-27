export interface TapTempoState {
  taps: number[];
  bpm: number;
}

export const TAP_TEMPO_MIN_BPM = 40;
export const TAP_TEMPO_MAX_BPM = 240;
export const TAP_TEMPO_DEFAULT_BPM = 120;
export const TAP_TEMPO_RESET_GAP_MS = 2_000;
export const TAP_TEMPO_MAX_TAPS = 4;

export function normalizeTapTempoBpm(
  value: number,
  fallback = TAP_TEMPO_DEFAULT_BPM,
): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : TAP_TEMPO_DEFAULT_BPM;
  const safeValue = Number.isFinite(value) ? value : safeFallback;
  return Math.round(Math.min(TAP_TEMPO_MAX_BPM, Math.max(TAP_TEMPO_MIN_BPM, safeValue)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function addTapTempoTap(state: TapTempoState, timestampMs: number): TapTempoState {
  const currentBpm = normalizeTapTempoBpm(state.bpm);
  if (!Number.isFinite(timestampMs)) {
    return { taps: [], bpm: currentBpm };
  }

  const recentTaps = state.taps
    .filter((tap) => Number.isFinite(tap))
    .slice(-(TAP_TEMPO_MAX_TAPS - 1));
  const previousTap = recentTaps.at(-1);

  if (
    previousTap === undefined ||
    timestampMs <= previousTap ||
    timestampMs - previousTap > TAP_TEMPO_RESET_GAP_MS
  ) {
    return { taps: [timestampMs], bpm: currentBpm };
  }

  const taps = [...recentTaps, timestampMs].slice(-TAP_TEMPO_MAX_TAPS);
  const intervals = taps.slice(1).map((tap, index) => tap - taps[index]);
  const intervalMs = median(intervals);

  return {
    taps,
    bpm: normalizeTapTempoBpm(60_000 / intervalMs, currentBpm),
  };
}
