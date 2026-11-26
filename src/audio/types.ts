export type PedalType =
  | 'noiseGate'
  | 'compressor'
  | 'autoWah'
  | 'drive'
  | 'crunch'
  | 'fuzz'
  | 'graphicEQ'
  | 'eq'
  | 'cab'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo'
  | 'delay'
  | 'reverb';

export type EffectType = PedalType;

export type PedalParamValue = number | string | boolean;

export type Pedal = {
  id: string;
  type: PedalType;
  name: string;
  /** 소리에 걸리는가. 화면의 발스위치·LED 가 이 값 하나다(S2.4: 옛 `enabled` 와 `bypassed` 를 하나로 합쳤다). */
  active: boolean;
  params: Record<string, PedalParamValue>;
};

export interface BasePedalParams extends Record<string, PedalParamValue> {
  mix: number;
  level: number;
}

export interface NoiseGateParams extends BasePedalParams {
  thresholdDb: number;
  reductionDb: number;
  attackMs: number;
  holdMs: number;
  releaseMs: number;
  hysteresisDb: number;
}

export interface CompressorParams extends BasePedalParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  sustain: number;
}

export interface AutoWahParams extends BasePedalParams {
  sensitivity: number;
  range: number;
  resonance: number;
  mode: 'auto' | 'manual';
  manual: number;
}

export interface DriveParams extends BasePedalParams {
  mode: 'overdrive' | 'crunch' | 'distortion' | 'fuzz';
  drive: number;
  tone: number;
  bias: number;
}

export interface CrunchParams extends BasePedalParams {
  mode: 'crunch';
  volume: number;
  gain: number;
  tone: number;
  presence: number;
  lowCut: number;
}

export interface FuzzParams extends BasePedalParams {
  mode: 'classic' | 'gated' | 'velcro';
  fuzz: number;
  tone: number;
  bias: number;
  gate: number;
  lowCut: number;
}

export interface GraphicEQParams extends BasePedalParams {
  band100: number;
  band200: number;
  band400: number;
  band800: number;
  band1600: number;
  band3200: number;
  band6400: number;
}

export interface EQParams extends BasePedalParams {
  lowCut: number;
  bassGain: number;
  midFreq: number;
  midGain: number;
  midQ: number;
  trebleGain: number;
  presenceGain: number;
}

export interface CabParams extends BasePedalParams {
  model:
    | 'v30-4x12'
    | 'greenback-4x12'
    | 'blue-1x12'
    | 'jensen-1x12'
    | 'tweed-1x10'
    /** 사용자가 불러온 IR(S5.4). 저장된 IR 이 없으면 기본 캐비닛으로 재생한다. */
    | 'my-ir'
    | 'off';
  micPosition: number;
  distance: number;
  lowCut: number;
  highCut: number;
  presence: number;
}

export interface ChorusParams extends BasePedalParams {
  rate: number;
  depth: number;
  voices: 2 | 3 | 4;
  spread: number;
  tone: number;
}

export interface FlangerParams extends BasePedalParams {
  rate: number;
  depth: number;
  feedback: number;
  manual: number;
}

export interface PhaserParams extends BasePedalParams {
  rate: number;
  depth: number;
  stages: 4 | 6 | 8 | 12;
  feedback: number;
}

export interface TremoloParams extends BasePedalParams {
  rate: number;
  depth: number;
  shape: 'sine' | 'triangle' | 'square';
  sync: boolean;
  bpm: number;
  division: '1/4' | '1/8' | 'dotted1/8' | '1/16';
}

export interface DelayParams extends BasePedalParams {
  mode: 'digital' | 'analog' | 'tape' | 'slapback' | 'pingpong';
  timeMs: number;
  feedback: number;
  mix: number;
  tone: number;
  sync: boolean;
  bpm: number;
  division: '1/4' | '1/8' | 'dotted1/8' | '1/16';
  trails: boolean;
}

export interface ReverbParams extends BasePedalParams {
  mode: 'room' | 'hall' | 'plate' | 'spring' | 'ambient';
  decay: number;
  preDelay: number;
  lowCut: number;
  highCut: number;
  trails: boolean;
}

export type ReverbMode = ReverbParams['mode'];

export type PedalParams =
  | NoiseGateParams
  | CompressorParams
  | AutoWahParams
  | DriveParams
  | CrunchParams
  | FuzzParams
  | GraphicEQParams
  | EQParams
  | CabParams
  | ChorusParams
  | FlangerParams
  | PhaserParams
  | TremoloParams
  | DelayParams
  | ReverbParams;

export interface PedalState extends Omit<Pedal, 'params'> {
  id: string;
  type: PedalType;
  name: string;
  active: boolean;
  color: string;
  params: PedalParams;
}

export interface EffectNodeWrapper {
  readonly id: string;
  readonly type: PedalType;
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** 켜져 있을 때 신호에 더하는 고정 지연(초). 꺼져 있으면 0(설계서 4.6) */
  readonly latencySeconds: number;
  connect(destination: AudioNode): void;
  disconnect(): void;
  update(pedal: PedalState): void;
  dispose(): void;
}

export interface LevelReading {
  db: number;
  linear: number;
  peakDb: number;
  peakLinear: number;
  isClipping: boolean;
  clipHoldUntil: number;
}

/** 입력 지연을 어디서 읽었는가. 트랙 통계(Chromium 125+)가 먼저고, 없으면 트랙 설정이다. */
export type InputLatencySource = 'track-stats' | 'track-settings';

/**
 * 화면에 보이는 지연의 재료(설계서 4.6). 모두 ms 다. 합계·'미포함' 판정은 engine/latency.ts 의 summarizeLatency 가 한다.
 * sampleRate 가 0 이면 아직 오디오 컨텍스트가 없어 아무것도 읽지 못한 상태다.
 */
export interface LatencyReading {
  sampleRate: number;
  /** 입력 방식. 'device' 면 입력 지연을 읽고, 'file'(음원 파일)이면 입력 지연이 없다. */
  inputKind: 'device' | 'file';
  /** 입력 지연(ms). 장치 모드에서 브라우저가 알려 주지 않으면 null('입력 지연 미포함'). */
  input: number | null;
  inputSource: InputLatencySource | null;
  /** 켜진 페달들이 신호에 더하는 고정 지연(ms) */
  pedals: number;
  /** 마스터 리미터 룩어헤드(ms) */
  limiter: number;
  /** AudioContext.baseLatency(ms). 브라우저가 알려 주지 않으면 null. */
  outputBase: number | null;
  /** AudioContext.outputLatency(ms). 브라우저가 알려 주지 않으면 null. */
  outputDevice: number | null;
}

export interface PitchReading {
  frequency: number | null;
  /** 들린 음의 이름과 옥타브('D2'). 가장 가까운 반음 기준이라 줄과는 상관없다 */
  note: string | null;
  /** 목표(가장 가까운 줄, 옥타브 위 음이면 그 음)와의 차이. 크로매틱은 가장 가까운 반음과의 차이 */
  cents: number;
  /** 기타 모드에서 가장 가까운 줄의 음('E2'). 어느 줄인지 알 수 없으면 없다 */
  targetNote?: string;
  stringNumber?: number;
  /** 그 줄의 음이 아니라 몇 옥타브 위의 같은 음(양수). 이때 cents 는 그 옥타브 위 음과의 차이다 */
  octavesAbove?: number;
  /** 가장 가까운 줄과도 너무 멀어서(600센트 초과) 어느 줄인지 알 수 없다 */
  checkString?: boolean;
}

export type TuningPresetId = 'standard' | 'drop-d' | 'half-step-down' | 'open-g' | 'chromatic';

export interface Preset {
  id: string;
  name: string;
  pedals: PedalState[];
  /**
   * 프리셋 음량 보정(dB, S1.4c). REF-PC 기준 출력 음량을 −20 dBFS 로 맞추는 고정 이득이다.
   * 없으면 0(보정 없음)으로 읽는다(M6). 이전 버전이 저장·내보낸 프리셋에는 이 필드가 없다.
   */
  trimDb?: number;
  updatedAt: number;
  libraryId?: string;
  libraryName?: string;
  description?: string;
  tags?: string[];
}
