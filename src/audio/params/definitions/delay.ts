import type { DelayParams } from '../../types';
import { clamp } from '../../utils/db';
import type { EffectSchema } from '../types';
import { choice, fmtPercent, fmtRounded, levelParam, mixParam, param } from './shared';

// ── Delay 시간 계산 — 엔진과 화면이 같은 함수를 쓴다 ──────────────────────────────
// Sync 를 켜면 템포와 음표 단위가 시간을 정한다. 단 Slapback 모드는 Sync 를 무시하고 D.Time 을 20~140 ms 로 쓴다.
// (화면이 Sync 만 보고 D.Time 을 막으면, Slapback 에서는 돌려야 하는 노브를 막는 결과가 된다.)
export const DELAY_DIVISION_BEATS: Record<DelayParams['division'], number> = {
  '1/4': 1,
  '1/8': 0.5,
  'dotted1/8': 0.75,
  '1/16': 0.25,
};

export const DELAY_DIVISION_LABELS: Record<DelayParams['division'], string> = {
  '1/4': '1/4',
  '1/8': '1/8',
  'dotted1/8': 'Dotted 1/8',
  '1/16': '1/16',
};

type DelayTimeParams = Pick<DelayParams, 'mode' | 'timeMs' | 'sync' | 'bpm' | 'division'>;

/** Sync 가 지금 시간을 정하는가(Slapback 이면 아니다). */
export function delayFollowsSync(params: Pick<DelayParams, 'mode' | 'sync'>): boolean {
  return params.sync && params.mode !== 'slapback';
}

/** 엔진이 실제로 쓰는 지연 시간(초). DelayEffect 가 이 함수를 그대로 쓴다. */
export function delayTimeSeconds(params: DelayTimeParams): number {
  if (params.mode === 'slapback') return clamp(params.timeMs / 1000, 0.02, 0.14);
  if (!params.sync) return clamp(params.timeMs / 1000, 0.02, 2);

  const secondsPerBeat = 60 / clamp(params.bpm, 40, 240);
  return clamp(secondsPerBeat * DELAY_DIVISION_BEATS[params.division], 0.02, 2);
}

/** Sync 가 켜졌을 때 D.Time 자리에 보여 주는 글: '1/4 · 500 ms' */
export function delaySyncedLabel(params: DelayTimeParams): string {
  const milliseconds = Math.round(delayTimeSeconds(params) * 1000);
  const division = DELAY_DIVISION_LABELS[params.division] ?? String(params.division);
  return `${division} · ${milliseconds} ms`;
}

export const delaySchema: EffectSchema = {
  type: 'delay',
  params: [
    // 화면의 'E.Level'(에코 레벨)이 저장 키 mix 다.
    mixParam(30, 'E.Level'),
    param({
      key: 'timeMs',
      label: 'D.Time',
      name: '지연 시간',
      unit: 'ms',
      min: 20,
      max: 2000,
      step: 1,
      default: 280,
      format: fmtRounded(' ms'),
      disabledWhen: (params) => delayFollowsSync({ mode: params.mode as DelayParams['mode'], sync: params.sync === true }),
    }),
    // 저장은 0~0.95, 화면 슬라이더는 0~95(%)다.
    param({ key: 'feedback', label: 'F.Back', name: '피드백(반복 횟수)', unit: '%', min: 0, max: 0.95, step: 0.01, default: 0.34, format: (value) => `${Math.round(value * 100)}%`, sliderScale: 100 }),
    param({ key: 'tone', label: 'Tone', name: '톤(밝기)', unit: '%', min: 0, max: 100, step: 1, default: 60, format: fmtPercent }),
    param({ key: 'bpm', label: 'BPM', name: '템포(분당 박자 수)', unit: '', min: 40, max: 240, step: 1, default: 120, format: (value) => `${value}` }),
    // 화면에 조절기가 없다. 엔진의 출력 음량 범위(0~2배)를 그대로 쓴다.
    levelParam(100, 200, 'Level', true),
  ],
  choices: [
    choice({
      key: 'mode',
      label: 'Mode',
      name: '딜레이 방식',
      kind: 'enum',
      options: [
        { value: 'digital', label: 'Digital' },
        { value: 'analog', label: 'Analog' },
        { value: 'tape', label: 'Tape' },
        { value: 'slapback', label: 'Slapback' },
        { value: 'pingpong', label: 'Pingpong' },
      ],
      default: 'digital',
    }),
    choice({ key: 'sync', label: 'Sync', name: '템포에 맞추기', kind: 'boolean', default: false }),
    choice({
      key: 'division',
      label: 'Division',
      name: '음표 단위',
      kind: 'enum',
      options: (Object.keys(DELAY_DIVISION_LABELS) as DelayParams['division'][]).map((value) => ({ value, label: DELAY_DIVISION_LABELS[value] })),
      default: '1/4',
    }),
    choice({ key: 'trails', label: 'Trails', name: '꺼도 반복음 이어가기', kind: 'boolean', default: true }),
  ],
  defaultMix: 30,
};
