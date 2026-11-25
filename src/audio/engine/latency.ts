// 화면에 보이는 지연의 계산(설계서 4.6, R2-10). 브라우저·Web Audio 에 직접 의존하지 않는 순수 함수만 둔다.
// 그래서 호출 기록·모의 객체만으로 단위(초/밀리초)와 '미포함' 판정을 시험할 수 있다.
//
//   표시 지연 = 입력 + 처리 + 출력
//     입력 = track.stats.latency(ms, Chromium 125+) → 없으면 track.getSettings().latency(초) → 둘 다 없으면 '입력 지연 미포함'
//     처리 = Σ(켜진 페달의 latencySeconds) + 리미터 룩어헤드
//     출력 = context.baseLatency(초) + context.outputLatency(초) (없는 값은 '미포함')
//
// 단위는 API마다 다르다(MDN·W3C 표준으로 확인): MediaStreamTrack.stats.latency 는 밀리초(DOMHighResTimeStamp),
// MediaTrackSettings.latency 와 AudioContext.baseLatency·outputLatency 는 초, AudioPlaybackStats.underrunEvents 는 개수다.
// 여기서 모든 값을 ms 로 통일한다.
import type { InputLatencySource, LatencyReading } from '../types';
import latencyTable from '../params/latency.json';
import { limiterLookaheadFrames } from './limiterSpec';

/** 아직 컨텍스트가 없을 때의 읽음 */
export const EMPTY_LATENCY: LatencyReading = {
  sampleRate: 0,
  inputKind: 'device',
  input: null,
  inputSource: null,
  pedals: 0,
  limiter: 0,
  outputBase: null,
  outputDevice: null,
};

/** 초 → ms. 숫자가 아니거나 유한하지 않거나 음수면 null(브라우저가 알려 주지 않은 것으로 본다). */
export function secondsToMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value * 1000 : null;
}

function validMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface InputLatencyReading {
  ms: number;
  source: InputLatencySource;
}

interface TrackLike {
  stats?: { latency?: unknown } | null;
  getSettings?: () => { latency?: unknown } | undefined;
}

/**
 * 입력 트랙의 지연. 트랙 통계(ms)의 지금 값이 0보다 크면 그것을 쓴다(0 은 '아직 잰 값이 없음'일 수 있어 건너뛴다).
 * 아니면 트랙 설정의 목표 지연(초)을 쓴다. 둘 다 없거나 읽다가 예외가 나면(장치가 빠짐) null.
 */
export function readInputLatency(track: unknown): InputLatencyReading | null {
  if (!track || typeof track !== 'object') return null;
  const candidate = track as TrackLike;
  try {
    const measured = validMs(candidate.stats?.latency);
    if (measured !== null && measured > 0) return { ms: measured, source: 'track-stats' };
  } catch {
    /* 이 브라우저에는 track.stats 가 없거나 읽을 수 없다 */
  }
  try {
    const configured = secondsToMs(candidate.getSettings?.()?.latency);
    if (configured !== null) return { ms: configured, source: 'track-settings' };
  } catch {
    /* 장치가 지연 설정을 주지 않는다 */
  }
  return null;
}

interface ContextLike {
  baseLatency?: unknown;
  outputLatency?: unknown;
}

/** 출력 지연의 두 조각(ms). 없는 조각은 null. */
export function readOutputLatency(context: ContextLike): { base: number | null; device: number | null } {
  let base: number | null = null;
  let device: number | null = null;
  try {
    base = secondsToMs(context.baseLatency);
  } catch {
    /* 읽을 수 없음 */
  }
  try {
    device = secondsToMs(context.outputLatency);
  } catch {
    /* 읽을 수 없음 */
  }
  return { base, device };
}

export type FixedLatencyKind = 'oversample2x' | 'convolver';

function tableFor(kind: FixedLatencyKind): Record<string, number> {
  return kind === 'oversample2x' ? latencyTable.oversample['2x'] : latencyTable.convolver;
}

/**
 * 페달 한 개가 켜져 있을 때 신호에 더하는 고정 지연(초). 값은 P-16 이 잰 표(latency.json)다.
 * 표에 없는 샘플레이트는 가장 가까운 측정값의 '프레임 수'를 유지한 채 환산한다(오버샘플링 필터는 프레임 수로 정해진다).
 */
export function fixedLatencySeconds(kind: FixedLatencyKind, sampleRate: number): number {
  if (!(Number.isFinite(sampleRate) && sampleRate > 0)) return 0;
  const table = tableFor(kind);
  const exact = table[String(Math.round(sampleRate))];
  if (typeof exact === 'number') return exact / 1000;
  let nearestRate = 0;
  for (const key of Object.keys(table)) {
    const rate = Number(key);
    if (nearestRate === 0 || Math.abs(rate - sampleRate) < Math.abs(nearestRate - sampleRate)) nearestRate = rate;
  }
  if (nearestRate === 0) return 0;
  const frames = (table[String(nearestRate)] / 1000) * nearestRate;
  return frames / sampleRate;
}

/** 리미터 룩어헤드(ms). 출력 단계가 소리를 이만큼 늦춘다. */
export function limiterLatencyMs(sampleRate: number): number {
  return sampleRate > 0 ? (limiterLookaheadFrames(sampleRate) / sampleRate) * 1000 : 0;
}

/** 켜진 페달들의 고정 지연 합(ms). 꺼진 페달은 latencySeconds 가 0 이다(BaseEffect). */
export function pedalsLatencyMs(effects: Iterable<{ readonly latencySeconds: number }>): number {
  let seconds = 0;
  for (const effect of effects) {
    const value = effect.latencySeconds;
    if (Number.isFinite(value) && value > 0) seconds += value;
  }
  return seconds * 1000;
}

export type MissingLatencyPart = 'input' | 'output' | 'outputBase' | 'outputDevice';

export interface LatencySummary {
  /** 컨텍스트가 없으면 null */
  totalMs: number | null;
  /** 입력 지연. 음원 파일이면 0(입력이 없다), 장치인데 못 읽었으면 null */
  inputMs: number | null;
  /** 페달 + 리미터 */
  processingMs: number;
  /** 읽은 출력 조각의 합. 둘 다 없으면 null */
  outputMs: number | null;
  /** 합계에 들어가지 못한('미포함') 조각 */
  missing: MissingLatencyPart[];
}

/** 합계에는 읽은 조각만 더한다. 읽지 못한 조각은 0 으로 두고 missing 에 적어 화면이 '미포함'이라고 말하게 한다. */
export function summarizeLatency(reading: LatencyReading): LatencySummary {
  const missing: MissingLatencyPart[] = [];
  const processingMs = reading.pedals + reading.limiter;
  if (reading.sampleRate <= 0) {
    return { totalMs: null, inputMs: null, processingMs, outputMs: null, missing };
  }
  const inputMs = reading.inputKind === 'file' ? 0 : reading.input;
  if (inputMs === null) missing.push('input');
  let outputMs: number | null = null;
  if (reading.outputBase === null && reading.outputDevice === null) {
    missing.push('output');
  } else {
    outputMs = (reading.outputBase ?? 0) + (reading.outputDevice ?? 0);
    if (reading.outputBase === null) missing.push('outputBase');
    if (reading.outputDevice === null) missing.push('outputDevice');
  }
  return {
    totalMs: (inputMs ?? 0) + processingMs + (outputMs ?? 0),
    inputMs,
    processingMs,
    outputMs,
    missing,
  };
}

interface PlaybackStatsContext {
  state?: string;
  playbackStats?: { underrunEvents?: unknown } | null;
}

/**
 * AudioContext.playbackStats.underrunEvents(컨텍스트가 만들어진 뒤 누적 개수). 이 브라우저가 주지 않거나
 * 값이 정수가 아니면 null — '측정 불가'다. 0 은 '끊김 없음'이다.
 */
export function readUnderrunEvents(context: PlaybackStatsContext | null): number | null {
  if (!context || context.state === 'closed') return null;
  try {
    const count = context.playbackStats?.underrunEvents;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

/** 세션 시작 때 읽은 값(baseline)과 지금 값의 차이. 지금 값을 못 읽으면 null. 기준선이 없으면 컨텍스트 시작(0)부터 센다. */
export function underrunsSince(current: number | null, baseline: number | null): number | null {
  if (current === null) return null;
  return Math.max(0, current - (baseline ?? 0));
}

// ---------------------------------------------------------------------------------------------
// 화면에 쓰는 문구
// ---------------------------------------------------------------------------------------------

/** 합계가 이 값(ms)을 넘으면 지연을 줄이는 방법을 안내한다. */
export const LATENCY_ADVICE_THRESHOLD_MS = 20;

/** 지연이 클 때의 안내(설계서 4.12). 드라이버 이름(ASIO 등)을 말하지 않는다 — 웹 오디오는 드라이버를 고르지 못한다. */
export const LATENCY_ADVICE =
  '지연을 줄이려면: 유선 헤드폰 사용 · 블루투스 끄기 · 다른 오디오 앱 닫기 · 인터페이스를 48 kHz로 설정 · 노트북 전원 연결';

/** 합계에 들어가지 않는 값(브라우저가 알려 주지 않음)을 적을 때 쓰는 말 */
export const LATENCY_OMITTED = '미포함';

export interface LatencyDisplay {
  /** 합계(ms). 컨텍스트가 없으면 null */
  totalMs: number | null;
  /** 한 줄 요약. 예: '지연 약 18.2 ms @ 48.0 kHz', 컨텍스트가 없으면 '지연시간 측정 대기' */
  headline: string;
  /** 항목별 한 줄. 컨텍스트가 없으면 빈 배열 */
  items: { key: 'input' | 'processing' | 'output'; text: string }[];
  /** 합계가 클 때의 안내. 아니면 null */
  advice: string | null;
}

const ms = (value: number): string => `${value.toFixed(1)} ms`;

/** 항목마다 읽은 값과 '미포함'을 보여 주는 문구를 만든다. 합계에 들어간 조각과 화면에 적힌 조각이 같도록 summarizeLatency 의 결과만 쓴다. */
export function formatLatency(reading: LatencyReading): LatencyDisplay {
  const summary = summarizeLatency(reading);
  if (summary.totalMs === null) {
    return { totalMs: null, headline: '지연시간 측정 대기', items: [], advice: null };
  }
  const inputText =
    reading.inputKind === 'file'
      ? '입력 없음(음원 파일)'
      : summary.inputMs === null
        ? `입력 지연 ${LATENCY_OMITTED}`
        : `입력 ${ms(summary.inputMs)}(${reading.inputSource === 'track-stats' ? '트랙 통계' : '장치 설정값'})`;
  const processingText = `처리 ${ms(summary.processingMs)}(페달 ${ms(reading.pedals)} + 리미터 ${ms(reading.limiter)})`;
  let outputText: string;
  if (summary.outputMs === null) {
    outputText = `출력 지연 ${LATENCY_OMITTED}`;
  } else if (reading.outputBase !== null && reading.outputDevice !== null) {
    outputText = `출력 ${ms(summary.outputMs)}(버퍼 ${ms(reading.outputBase)} + 장치 ${ms(reading.outputDevice)})`;
  } else if (reading.outputDevice === null) {
    outputText = `출력 ${ms(summary.outputMs)}(장치 지연 ${LATENCY_OMITTED})`;
  } else {
    outputText = `출력 ${ms(summary.outputMs)}(버퍼 지연 ${LATENCY_OMITTED})`;
  }
  return {
    totalMs: summary.totalMs,
    headline: `지연 약 ${ms(summary.totalMs)} @ ${(reading.sampleRate / 1000).toFixed(1)} kHz`,
    items: [
      { key: 'input', text: inputText },
      { key: 'processing', text: processingText },
      { key: 'output', text: outputText },
    ],
    advice: summary.totalMs > LATENCY_ADVICE_THRESHOLD_MS ? LATENCY_ADVICE : null,
  };
}

/** 끊김 수를 읽을 수 없을 때(측정 불가) 마우스를 올리면 보이는 이유 */
export const UNDERRUN_UNAVAILABLE_REASON =
  '이 브라우저는 출력 끊김 통계(AudioContext.playbackStats)를 제공하지 않아 측정할 수 없습니다.';
