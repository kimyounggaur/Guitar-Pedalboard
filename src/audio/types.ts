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
  enabled: boolean;
  bypassed: boolean;
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
  enabled: boolean;
  bypassed: boolean;
  color: string;
  params: PedalParams;
}

export interface EffectNodeWrapper {
  readonly id: string;
  readonly type: PedalType;
  readonly input: AudioNode;
  readonly output: AudioNode;
  connect(destination: AudioNode): void;
  disconnect(): void;
  setEnabled(enabled: boolean): void;
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

export interface LatencyReading {
  base: number;
  output: number;
  sampleRate: number;
}

export interface PitchReading {
  frequency: number | null;
  note: string | null;
  cents: number;
}

export type TuningPresetId = 'standard' | 'drop-d' | 'half-step-down' | 'open-g';

export interface Preset {
  id: string;
  name: string;
  pedals: PedalState[];
  updatedAt: number;
  libraryId?: string;
  libraryName?: string;
  description?: string;
  tags?: string[];
}
