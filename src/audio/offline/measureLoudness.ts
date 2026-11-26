// 프리셋 하나가 REF-PC 를 받았을 때 얼마나 큰 소리를 내는지 오프라인 렌더로 잰다(설계서 GS-1·GS-2, S1.4c).
// '음량 맞추기' 버튼(앱)과 오디오 프로브(src/audio/testing)·팩토리 trim 계산이 같은 렌더·같은 측정을 쓴다.
// 앱 코드는 src/audio/testing/ 을 가져오지 않으므로 공통 코드는 여기에 있다. 렌더가 무거우니 화면에서는 동적 import 로 부른다.
import type { PedalState } from '../types';
import { refPc } from './referenceSignal';
import { isHeadroomLimited, MIN_MEASURABLE_RMS_DBFS, PRESET_TARGET_RMS_DBFS, peakDbfs, stereoRmsDbfs, trimDbFor } from './loudnessSpec';
import { renderChain } from './renderChain';

/**
 * '음량 맞추기' 가 렌더하는 REF-PC 길이(초). 설계서는 2초였지만 4초로 늘렸다(REFACTOR_LOG L-39).
 * REF-PC 는 2초마다 다시 친다. 2초만 렌더하면 리버브·딜레이 꼬리가 쌓이기 전이라 시간계열 프리셋
 * (Ambient Delay·Tape Swell·Post-Rock Wash)이 8초 기준과 최대 1.5 dB 어긋나 '−20 ± 1 dBFS' 를 못 지킨다.
 * 4초(두 번 침)는 40개 프리셋 모두 0.53 dB 안(44.1·48 kHz)이고, 5초처럼 2초의 배수가 아닌 길이는 오히려 나빠진다.
 */
export const QUICK_MEASURE_SECONDS = 4;

export interface PresetLoudness {
  /** trim 0 에서의 평균 음량(RMS, dBFS). 리미터를 거치지 않은 소리다. */
  rmsDb: number;
  /** 같은 렌더의 샘플 피크(dBFS). 리미터가 눌러야 할 양(GS-7)을 가늠하는 데 쓴다. */
  peakDb: number;
}

/** 꺼진 페달은 신호를 그대로 통과시키므로 빼도 소리가 같다(P-05 가 확인). 렌더 시간을 줄인다. */
export function activeChain(pedals: PedalState[]): PedalState[] {
  return pedals.filter((pedal) => pedal.active);
}

/**
 * 체인을 trim 0·리미터 없이 REF-PC 로 렌더해 평균 음량과 피크를 잰다.
 * 리미터를 빼는 이유: 리미터가 눌러 버리기 전의 소리가 있어야 trim 과 리미터 감소량(GS-7)을 따로 읽을 수 있다.
 */
export async function measurePresetLoudness(
  pedals: PedalState[],
  options: { sampleRate: number; seconds?: number },
): Promise<PresetLoudness> {
  const { sampleRate, seconds = QUICK_MEASURE_SECONDS } = options;
  const render = await renderChain({
    sampleRate,
    input: [refPc(sampleRate, seconds)],
    pedals: activeChain(pedals),
    limiter: false,
    presetTrimDb: 0,
  });
  const end = render.leadFrames + render.signalFrames;
  return {
    rmsDb: stereoRmsDbfs(render.output, render.leadFrames, end),
    peakDb: peakDbfs(render.output, render.leadFrames, end),
  };
}

export interface TrimResult {
  /** 목표에 맞추는 보정(dB). 피크 여유 때문에 평균 목표보다 작을 수 있다(`headroomLimited`). */
  trimDb: number;
  loudness: PresetLoudness;
  /** 소리가 있어 측정이 의미 있는가. 아니면 `trimDb` 는 0. */
  audible: boolean;
  /** 순간 피크가 커서 평균 음량을 목표까지 올리지 못했는가(GS-7: 리미터가 1 dB 넘게 눌러야 하게 되기 때문). */
  headroomLimited: boolean;
  /** 보정을 적용했을 때 REF-PC 의 평균 음량(dBFS) 예상값. */
  resultRmsDb: number;
}

/** '음량 맞추기': 현재 체인을 재서 목표(기본 −20 dBFS)에 맞추는 trim(dB). 소리가 없으면 `audible: false`. */
export async function computeTrimForChain(
  pedals: PedalState[],
  options: { sampleRate: number; seconds?: number; targetDbfs?: number },
): Promise<TrimResult> {
  const loudness = await measurePresetLoudness(pedals, options);
  const target = options.targetDbfs ?? PRESET_TARGET_RMS_DBFS;
  const trimDb = trimDbFor(loudness.rmsDb, target, loudness.peakDb);
  return {
    trimDb,
    loudness,
    audible: loudness.rmsDb >= MIN_MEASURABLE_RMS_DBFS,
    headroomLimited: isHeadroomLimited(loudness.rmsDb, loudness.peakDb, target),
    resultRmsDb: loudness.rmsDb + trimDb,
  };
}
