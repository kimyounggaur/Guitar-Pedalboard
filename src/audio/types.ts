export type PedalType =
  | 'noiseGate'
  | 'compressor'
  | 'drive'
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

export interface BasePedalParams extends Record<string, number | boolean> {
  bypass: boolean;
  mix: number;
  level: number;
}

export interface NoiseGateParams extends BasePedalParams {
  threshold: number;
  release: number;
}

export interface CompressorParams extends BasePedalParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
}

export interface DriveParams extends BasePedalParams {
  drive: number;
  tone: number;
}

export interface EQParams extends BasePedalParams {
  low: number;
  mid: number;
  high: number;
}

export interface DelayParams extends BasePedalParams {
  time: number;
  feedback: number;
  tone: number;
}

export interface ReverbParams extends BasePedalParams {
  decay: number;
  tone: number;
}

export type PedalParams =
  | NoiseGateParams
  | CompressorParams
  | DriveParams
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
