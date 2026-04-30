export type EffectType =
  | 'noiseGate'
  | 'compressor'
  | 'drive'
  | 'eq'
  | 'delay'
  | 'reverb';

export interface BasePedalParams {
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

export interface PedalState {
  id: string;
  type: EffectType;
  name: string;
  color: string;
  params: PedalParams;
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
