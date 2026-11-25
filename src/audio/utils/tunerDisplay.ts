// 튜너의 읽은 값을 화면 문구로 바꾼다(설계서 S2.12). React 에 기대지 않는 순수 함수라 Node 에서 모든 경우를 시험한다.
import type { PitchReading } from '../types';

export type TunerStatus = 'idle' | 'in-tune' | 'near' | 'far';

/** 이 안이면 '정확함', 이 안이면 '가까움' (센트) */
export const IN_TUNE_CENTS = 5;
export const NEAR_CENTS = 15;

export interface TunerDisplay {
  hasPitch: boolean;
  status: TunerStatus;
  /** 큰 글씨의 음 이름과 옥타브('D2'). 없으면 '--' */
  note: string;
  /** '6번 줄(E2)'. 줄을 정하지 못했거나 크로매틱이면 null */
  stringLabel: string | null;
  frequencyText: string;
  /** '200센트 낮음'·'정확함'·'6번 줄(E2)보다 한 옥타브 높습니다'·'줄 번호를 확인하세요'·'신호 대기'·'튜너 꺼짐' */
  statusText: string;
  centsText: string;
  /** 센트 막대: 바늘 위치(0~100, 가운데 50)와 −50~50 으로 자른 값 */
  needlePercent: number;
  boundedCents: number;
}

const OCTAVE_WORDS: Readonly<Record<number, string>> = { 1: '한', 2: '두', 3: '세', 4: '네' };

function octaveWord(octaves: number): string {
  return `${OCTAVE_WORDS[octaves] ?? octaves} 옥타브`;
}

export function describeTuner(pitch: PitchReading, active: boolean): TunerDisplay {
  const hasPitch = active && pitch.frequency !== null && pitch.note !== null;
  if (!hasPitch) {
    return {
      hasPitch: false,
      status: 'idle',
      note: '--',
      stringLabel: null,
      frequencyText: '주파수 --',
      statusText: active ? '신호 대기' : '튜너 꺼짐',
      centsText: '-- ¢',
      needlePercent: 50,
      boundedCents: 0,
    };
  }

  const frequencyText = `${(pitch.frequency as number).toFixed(1)} Hz`;
  const note = pitch.note as string;
  const stringLabel =
    pitch.stringNumber !== undefined && pitch.targetNote !== undefined
      ? `${pitch.stringNumber}번 줄(${pitch.targetNote})`
      : null;

  // 줄을 정하지 못하면 센트가 무엇에 대한 차이인지 알 수 없으니 숫자와 막대를 비워 둔다.
  if (pitch.checkString) {
    return {
      hasPitch: true,
      status: 'far',
      note,
      stringLabel: null,
      frequencyText,
      statusText: '줄 번호를 확인하세요',
      centsText: '-- ¢',
      needlePercent: 50,
      boundedCents: 0,
    };
  }

  const rounded = Math.round(pitch.cents);
  const centsText = `${rounded > 0 ? '+' : ''}${rounded} ¢`;
  const needlePercent = Math.min(100, Math.max(0, 50 + pitch.cents));
  const boundedCents = Math.round(Math.min(50, Math.max(-50, pitch.cents)));
  const absoluteCents = Math.abs(pitch.cents);

  if (pitch.octavesAbove !== undefined && stringLabel) {
    return {
      hasPitch: true,
      status: 'far',
      note,
      stringLabel,
      frequencyText,
      statusText: `${stringLabel}보다 ${octaveWord(pitch.octavesAbove)} 높습니다`,
      centsText,
      needlePercent,
      boundedCents,
    };
  }

  const status: TunerStatus = absoluteCents <= IN_TUNE_CENTS ? 'in-tune' : absoluteCents <= NEAR_CENTS ? 'near' : 'far';
  return {
    hasPitch: true,
    status,
    note,
    stringLabel,
    frequencyText,
    statusText: status === 'in-tune' ? '정확함' : `${Math.abs(rounded)}센트 ${rounded > 0 ? '높음' : '낮음'}`,
    centsText,
    needlePercent,
    boundedCents,
  };
}
