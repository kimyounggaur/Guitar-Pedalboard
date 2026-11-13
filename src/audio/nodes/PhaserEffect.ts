import type { PedalState, PhaserParams } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';
import { BaseEffect } from './BaseEffect';

const MIN_RATE_HZ = 0.05;
const MAX_RATE_HZ = 8;
export const PHASER_MIN_FREQUENCY = 200;
export const PHASER_MAX_FREQUENCY = 2000;
export const PHASER_CENTER_FREQUENCY = Math.sqrt(
  PHASER_MIN_FREQUENCY * PHASER_MAX_FREQUENCY,
);
export const PHASER_MAX_FEEDBACK = 0.9;
export const PHASER_STAGE_OPTIONS = [4, 6, 8, 12] as const;
const PHASER_MAX_DETUNE_CENTS =
  1200 * Math.log2(PHASER_MAX_FREQUENCY / PHASER_CENTER_FREQUENCY);
const MIN_WET_MAKEUP = 0.3;

const DEFAULT_PARAMS: PhaserParams = {
  mix: 45,
  level: 100,
  rate: 0.5,
  depth: 70,
  stages: 6,
  feedback: 40,
};

export interface PhaserSweep {
  detuneCents: number;
  minimumFrequency: number;
  maximumFrequency: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return clamp(finiteOr(value, fallback), min, max);
}

function normalizeStageCount(value: number): PhaserParams['stages'] {
  const finiteValue = finiteOr(value, DEFAULT_PARAMS.stages);
  return PHASER_STAGE_OPTIONS.reduce((nearest, candidate) =>
    Math.abs(candidate - finiteValue) < Math.abs(nearest - finiteValue) ? candidate : nearest,
  );
}

export function normalizePhaserParams(params: PhaserParams): PhaserParams {
  return {
    mix: clampFinite(params.mix, 0, 100, DEFAULT_PARAMS.mix),
    level: clampFinite(params.level, 0, 200, DEFAULT_PARAMS.level),
    rate: clampFinite(params.rate, MIN_RATE_HZ, MAX_RATE_HZ, DEFAULT_PARAMS.rate),
    depth: clampFinite(params.depth, 0, 100, DEFAULT_PARAMS.depth),
    stages: normalizeStageCount(params.stages),
    feedback: clampFinite(params.feedback, 0, 90, DEFAULT_PARAMS.feedback),
  };
}

function normalizePhaserPedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    params: normalizePhaserParams(pedal.params as PhaserParams),
  };
}

export function getPhaserSweep(depth: number): PhaserSweep {
  const boundedDepth = clampFinite(depth, 0, 100, DEFAULT_PARAMS.depth);
  const detuneCents = PHASER_MAX_DETUNE_CENTS * (boundedDepth / 100);

  return {
    detuneCents,
    minimumFrequency: PHASER_CENTER_FREQUENCY * Math.pow(2, -detuneCents / 1200),
    maximumFrequency: PHASER_CENTER_FREQUENCY * Math.pow(2, detuneCents / 1200),
  };
}

export function getPhaserWetMakeup(feedback: number): number {
  const boundedFeedback = clampFinite(
    feedback,
    0,
    PHASER_MAX_FEEDBACK,
    DEFAULT_PARAMS.feedback / 100,
  );
  return Math.max(MIN_WET_MAKEUP, 1 - boundedFeedback * 0.75);
}

export class PhaserEffect extends BaseEffect {
  private readonly processor: AudioWorkletNode;
  private disposed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    const safePedal = normalizePhaserPedal(pedal);
    super(context, safePedal);
    const params = safePedal.params as PhaserParams;
    this.processor = new AudioWorkletNode(context, 'phaser-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { stages: params.stages },
      parameterData: { stages: params.stages },
    });
    this.effectInput.connect(this.processor);
    this.processor.connect(this.effectOutput);
    this.update(safePedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizePhaserPedal(pedal);
    const params = safePedal.params as PhaserParams;
    const feedback = clamp(params.feedback / 100, 0, PHASER_MAX_FEEDBACK);
    super.update(safePedal);
    this.setProcessorParam('rate', params.rate);
    this.setProcessorParam('depth', params.depth);
    this.setProcessorParam('feedback', feedback);
    // The processor crossfades the selected stage tap internally.
    const stages = this.processor.parameters.get('stages');
    if (stages) {
      stages.cancelScheduledValues(this.context.currentTime);
      stages.setValueAtTime(params.stages, this.context.currentTime);
    }
    this.setMakeup(getPhaserWetMakeup(feedback));
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
