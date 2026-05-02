export type PedalType =
  | 'noiseGate'
  | 'compressor'
  | 'drive'
  | 'crunch'
  | 'eq'
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
  bypassed: boolean;
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

export interface EQParams extends BasePedalParams {
  lowCut: number;
  bassGain: number;
  midFreq: number;
  midGain: number;
  midQ: number;
  trebleGain: number;
  presenceGain: number;
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
}

export interface ReverbParams extends BasePedalParams {
  mode: 'room' | 'hall' | 'plate' | 'spring' | 'ambient';
  decay: number;
  preDelay: number;
  lowCut: number;
  highCut: number;
}

export type PedalParams =
  | NoiseGateParams
  | CompressorParams
  | DriveParams
  | CrunchParams
  | EQParams
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
  setParam(name: string, value: PedalParamValue): void;
  setBypass(bypassed: boolean): void;
  update(pedal: PedalState): void;
  dispose(): void;
}

export interface LevelReading {
  db: number;
  linear: number;
  peakDb: number;
  peakLinear: number;
  isClipping: boolean;
}

export interface PitchReading {
  frequency: number | null;
  note: string | null;
  cents: number;
}

export interface Preset {
  id: string;
  name: string;
  pedals: PedalState[];
  updatedAt: number;
}
