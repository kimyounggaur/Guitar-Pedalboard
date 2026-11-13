import type { FlangerParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';
import { BaseEffect } from './BaseEffect';

const MIN_RATE_HZ = 0.05;
const MAX_RATE_HZ = 5;
const MIN_MANUAL_SECONDS = 0.0005;
const MAX_MANUAL_SECONDS = 0.01;

export const FLANGER_MAX_FEEDBACK = 0.95;

const DEFAULT_PARAMS: FlangerParams = {
  mix: 35,
  level: 100,
  rate: 0.25,
  depth: 55,
  feedback: 60,
  manual: 2,
};

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return clamp(finiteOr(value, fallback), min, max);
}

export function normalizeFlangerParams(params: FlangerParams): FlangerParams {
  return {
    mix: clampFinite(params.mix, 0, 100, DEFAULT_PARAMS.mix),
    level: clampFinite(params.level, 0, 200, DEFAULT_PARAMS.level),
    rate: clampFinite(params.rate, MIN_RATE_HZ, MAX_RATE_HZ, DEFAULT_PARAMS.rate),
    depth: clampFinite(params.depth, 0, 100, DEFAULT_PARAMS.depth),
    feedback: clampFinite(params.feedback, -95, 95, DEFAULT_PARAMS.feedback),
    manual: clampFinite(params.manual, 0.5, 10, DEFAULT_PARAMS.manual),
  };
}

function normalizeFlangerPedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    params: normalizeFlangerParams(pedal.params as FlangerParams),
  };
}

export function getFlangerModulationDepth(manualSeconds: number, depth: number): number {
  const boundedManual = clamp(manualSeconds, MIN_MANUAL_SECONDS, MAX_MANUAL_SECONDS);
  const boundedDepth = clampFinite(depth, 0, 100, DEFAULT_PARAMS.depth);
  const safeSweep = Math.max(
    0,
    Math.min(
      boundedManual - MIN_MANUAL_SECONDS,
      MAX_MANUAL_SECONDS - boundedManual,
    ),
  );
  return safeSweep * (boundedDepth / 100);
}

export class FlangerEffect extends BaseEffect {
  private readonly processor: AudioWorkletNode;
  private disposed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, normalizeFlangerPedal(pedal));
    this.processor = new AudioWorkletNode(context, 'flanger-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.effectInput.connect(this.processor);
    this.processor.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizeFlangerPedal(pedal);
    const params = safePedal.params as FlangerParams;
    const manualSeconds = clamp(params.manual / 1000, MIN_MANUAL_SECONDS, MAX_MANUAL_SECONDS);
    super.update(safePedal);
    this.setProcessorParam('manual', manualSeconds);
    this.setProcessorParam('depth', getFlangerModulationDepth(manualSeconds, params.depth));
    this.setProcessorParam('rate', params.rate);
    this.setProcessorParam('feedback', params.feedback / 100);
  }

  private setProcessorParam(name: string, value: number): void {
    const param = this.processor.parameters.get(name);
    if (param) smoothParam(param, value, this.context);
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.processor.port.postMessage({ type: 'dispose' });
    this.processor.disconnect();
    super.dispose();
  }
}
