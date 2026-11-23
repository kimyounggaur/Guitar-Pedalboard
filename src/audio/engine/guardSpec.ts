// 출력 가드(하울링 감지)와 레벨 미터의 사양(설계서 4.3절, 부록 B, 결정 D9).
// 오디오 스레드의 워클릿, 메인 스레드의 MonitorService, 오프라인 렌더·시험이 같은 값을 쓰도록 한곳에 둔다.
// 값과 메시지 모양만 있는 순수 모듈이라 워클릿 번들에 그대로 들어가도 된다(limiterSpec.ts 와 같은 방식).

/** level-meter.worklet.ts 가 등록하는 이름 */
export const LEVEL_METER_PROCESSOR_NAME = 'level-meter';
/** output-guard.worklet.ts 가 등록하는 이름 */
export const OUTPUT_GUARD_PROCESSOR_NAME = 'output-guard';

// ---------------------------------------------------------------------------------------------
// 하울링 판정 수치 — 부록 B 의 기본값이다(D9). 바꿔야 할 것 같으면 멈추고 사람의 승인을 받는다.
// ---------------------------------------------------------------------------------------------
/** 분석 창(샘플, Hann). 48 kHz 에서 약 43 ms. */
export const HOWL_WINDOW_SAMPLES = 2048;
/** 분석 간격(샘플). 48 kHz 에서 약 21 ms. */
export const HOWL_HOP_SAMPLES = 1024;
/** 후보 프레임의 레벨 하한(RMS, dBFS). 이보다 작으면 잡음으로 보고 무시한다. */
export const HOWL_LEVEL_FLOOR_DB = -50;
/** 톤 성분 비율 하한: 상위 피크들의 에너지 / 80 Hz~8 kHz 전체 에너지. 배음이 있는 왜곡 하울링도 포함한다. */
export const HOWL_TONAL_RATIO = 0.8;
/** 톤 성분에 세는 상위 피크의 수. */
export const HOWL_TONAL_PEAK_COUNT = 8;
/** 각 피크에서 에너지를 모으는 폭(좌우 빈 수). Hann 창의 주엽이 ±2 빈이다. */
export const HOWL_TONAL_PEAK_HALF_WIDTH_BINS = 2;
/** 분석 대역(Hz). 튜너의 70 Hz~1.4 kHz 보다 넓다. */
export const HOWL_BAND_LOW_HZ = 80;
export const HOWL_BAND_HIGH_HZ = 8000;
/** 후보가 이어지는 동안 음높이가 기준에서 벗어날 수 있는 한계(센트). */
export const HOWL_PITCH_TOLERANCE_CENTS = 20;
/** 후보가 이만큼(초) 이어지면 판정한다. */
export const HOWL_HOLD_SECONDS = 1.0;
/** 그 구간 레벨의 기울기(선형회귀, dB/s)가 이 값 이상이면 '줄지 않는다'. 줄어드는 기타 줄과 하울링을 가르는 기준이다. */
export const HOWL_MIN_SLOPE_DB_PER_SECOND = -1.0;
/** 차단할 때 출력을 무음으로 만드는 램프(초). */
export const HOWL_MUTE_RAMP_SECONDS = 0.01;

// ---------------------------------------------------------------------------------------------
// 부록 B 에 없는 보강(REFACTOR_LOG L-44) — 새로 친 음을 '줄지 않는 음'으로 오해하지 않기 위한 것이다.
// 위 수치는 하나도 바꾸지 않는다. 판정 구간에 새 음(재타건)이 끼면 레벨이 단번에 뛰어 기울기가 양수가 되므로,
// 레벨이 짧은 시간에 이만큼 뛰면 새 음으로 보고 후보를 처음부터 다시 센다. 하울링은 천천히 커지거나 일정하다.
// ---------------------------------------------------------------------------------------------
/** 이 뜀(dB)을 넘는 레벨 상승은 '새로 친 음'이다. 하울링의 성장(약 +11 dB/s)은 이 안에 들지 않는다. */
export const HOWL_ONSET_RISE_DB = 6;
/** 레벨 상승을 재는 거리(프레임 수). 48 kHz 에서 약 0.1초. */
export const HOWL_ONSET_LOOKBACK_FRAMES = 5;
/**
 * 기울기를 잴 때 후보 구간의 맨 앞 프레임 몇 개는 뺀다. 소리가 막 시작한 프레임은 분석 창이 아직 다 차지 않아 레벨이 낮게 나오고,
 * 그 뒤로 오르는 것처럼 보여 기울기를 0.4~0.9 dB/s 쯤 위로 끌어올린다(−1.2 dB/s 로 줄어드는 음이 하울링으로 오판됐다).
 * 분석 창이 hop 의 두 배이므로 2프레임이면 된다. 지속 시간(HOWL_HOLD_SECONDS)은 이 프레임을 포함해 그대로 센다.
 */
export const HOWL_SLOPE_SKIP_FRAMES = 2;
/**
 * 후보의 기준 음높이를 붙들어 두는 여유(dB). 세기가 거의 같은 음이 여럿(H-4)이면 가장 큰 성분이 프레임마다 바뀔 수 있다.
 * 기준 음의 피크가 가장 큰 피크보다 이만큼(창 함수 때문에 생기는 최대 오차 1.4 dB 보다 크게) 안에 있으면 기준 음을 따라간다.
 */
export const HOWL_REFERENCE_HOLD_DB = 3;

// ---------------------------------------------------------------------------------------------
// 레벨 미터
// ---------------------------------------------------------------------------------------------
/** 레벨 메시지를 보내는 빈도(Hz). */
export const LEVEL_REPORT_HZ = 30;
/** 무음의 dB 값. −Infinity 를 메시지로 보내지 않는다. */
export const LEVEL_SILENT_DB = -120;
/** 이 값 이상의 샘플 절댓값이 있으면 그 구간을 클립으로 본다(−0.09 dBFS). 기존 MeterNode 와 같은 기준이다. */
export const LEVEL_CLIP_THRESHOLD = 0.99;

/** 리미터 감소량을 알리는 간격(초). 설계서: 최근 100 ms 의 최대 감소량. */
export const LIMITER_REPORT_SECONDS = 0.1;

// ---------------------------------------------------------------------------------------------
// 포트 메시지(설계서 4.3절). 워클릿 → 메인
// ---------------------------------------------------------------------------------------------
export type LevelTap = 'in' | 'out';

export interface LevelMsg {
  type: 'level';
  tap: LevelTap;
  /** 채널별 피크·RMS(dBFS). 입력 쪽 채널 수는 소스를 따른다(1 또는 2). */
  peakDb: number[];
  rmsDb: number[];
  clipped: boolean;
  /** 이 측정이 끝난 오디오 시계(currentFrame). 초로 바꾸려면 컨텍스트의 sampleRate 로 나눈다. */
  frame: number;
}

export type GuardMsg =
  | { type: 'howl-suspect'; freqHz: number; heldMs: number; frame: number } // 판정 진행 중(로그·디버그용)
  | { type: 'howl-cut'; freqHz: number; frame: number } // 이미 무음 처리 완료
  | { type: 'limiter'; maxGrDb: number; frame: number }; // 최근 100 ms 최대 감소량(양수 dB)

/** 메인 → 워클릿 */
export type GuardMode = 'device' | 'file' | 'off';
export type GuardCmd =
  /** device: 하울링 판정을 켠다. file: 마이크가 없으므로 끈다(리미터는 그대로). off: 사용자가 '하울링 보호'를 껐다. */
  | { type: 'arm'; mode: GuardMode }
  /** 새 세션에서 무음을 풀고 판정 상태를 비운다. */
  | { type: 'reset' };

export type MonitorMsg = LevelMsg | GuardMsg;
