import type { ReverbMode } from '../types';

export interface ImpulseWorkerRequest {
  id: string;
  seconds: number;
  mode: ReverbMode;
  sampleRate: number;
}

export interface ImpulseWorkerSuccess {
  id: string;
  left: Float32Array;
  right: Float32Array;
}

export interface ImpulseWorkerFailure {
  id: string;
  error: string;
}

export type ImpulseWorkerResponse = ImpulseWorkerSuccess | ImpulseWorkerFailure;
