// level-meter 워클릿 메시지(LevelMsg)를 화면·경고가 쓰는 LevelReading 으로 바꾸는 순수 계산(설계서 4.3절).
// 브라우저·Web Audio·zustand 와 무관해서 Node 시험이 그대로 부른다. 시각(nowMs)은 부르는 쪽이 넘긴다.
//
// 예전 MeterNode.read() 와 같은 규칙을 이어받는다:
//   · linear = min(1, RMS × 4), peakLinear = min(1, 피크)  — 막대 길이 눈금
//   · 피크가 0.99 이상인 측정이 3번 이어지면 클리핑으로 보고 1.5초 동안 표시를 붙든다
import { LEVEL_CLIP_THRESHOLD, LEVEL_SILENT_DB, type LevelMsg } from '../engine/guardSpec';
import type { LevelReading } from '../types';

/** 클리핑으로 본 뒤 표시를 붙드는 시간(ms). */
export const CLIP_HOLD_MS = 1500;
/** 클리핑 측정이 이만큼 이어져야 클리핑으로 본다. 30 Hz 보고에서 약 0.1초다. */
export const CLIP_CONSECUTIVE_REPORTS = 3;
/** LEVEL_CLIP_THRESHOLD 를 dB 로 쓴 값(−0.087 dBFS). 채널별 피크(dB)로 클리핑을 가를 때 쓴다. */
const CLIP_PEAK_DB = 20 * Math.log10(LEVEL_CLIP_THRESHOLD) - 1e-9;

/** 어느 채널을 표시에 쓸지. 'all' 은 있는 채널 모두(큰 쪽), 숫자는 그 채널 하나(0 = 1번 입력). */
export type ChannelSelection = 'all' | 0 | 1;

export interface TapState {
  /** 선택한 채널 중 가장 큰 RMS·피크(dBFS) */
  rmsDb: number;
  peakDb: number;
  /** 메시지에 실린 채널 수 */
  channels: number;
  /** 이 측정이 끝난 오디오 시계(샘플). 아직 측정이 없으면 0. */
  frame: number;
  /** 클리핑 측정이 이어진 횟수와, 표시를 붙드는 시각(performance.now 기준) */
  consecutiveClipped: number;
  clipHoldUntil: number;
}

export const SILENT_TAP: TapState = {
  rmsDb: LEVEL_SILENT_DB,
  peakDb: LEVEL_SILENT_DB,
  channels: 0,
  frame: 0,
  consecutiveClipped: 0,
  clipHoldUntil: 0,
};

/** 새 측정(LevelMsg)을 받아 탭의 상태를 갱신한다. `previous` 는 바꾸지 않는다. */
export function applyLevel(previous: TapState, message: LevelMsg, selection: ChannelSelection, nowMs: number): TapState {
  const available = message.rmsDb.length;
  const indexes = selection === 'all' ? Array.from({ length: available }, (_, index) => index) : selection < available ? [selection] : [];

  let rmsDb = LEVEL_SILENT_DB;
  let peakDb = LEVEL_SILENT_DB;
  let clipped = false;
  for (const index of indexes) {
    rmsDb = Math.max(rmsDb, message.rmsDb[index]);
    peakDb = Math.max(peakDb, message.peakDb[index]);
    if (message.peakDb[index] >= CLIP_PEAK_DB) clipped = true;
  }

  const consecutiveClipped = clipped ? previous.consecutiveClipped + 1 : 0;
  const clipHoldUntil = consecutiveClipped >= CLIP_CONSECUTIVE_REPORTS ? nowMs + CLIP_HOLD_MS : previous.clipHoldUntil;
  return { rmsDb, peakDb, channels: available, frame: message.frame, consecutiveClipped, clipHoldUntil };
}

export function toLevelReading(tap: TapState, nowMs: number): LevelReading {
  const rms = 10 ** (tap.rmsDb / 20);
  const peak = 10 ** (tap.peakDb / 20);
  return {
    db: tap.rmsDb,
    linear: Math.min(1, rms * 4),
    peakDb: tap.peakDb,
    peakLinear: Math.min(1, peak),
    isClipping: nowMs < tap.clipHoldUntil,
    clipHoldUntil: tap.clipHoldUntil,
  };
}

/** 채널별 RMS(dBFS)를 InputStage 의 자동 판정이 받는 두 채널 값으로 맞춘다. 없는 채널은 무음이다(예: 모노 소스의 2번). */
export function channelPair(rmsDb: readonly number[]): [number, number] {
  return [rmsDb[0] ?? LEVEL_SILENT_DB, rmsDb[1] ?? LEVEL_SILENT_DB];
}
