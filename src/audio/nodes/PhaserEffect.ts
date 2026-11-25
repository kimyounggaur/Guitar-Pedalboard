import type { PedalState, PhaserParams } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';
import { BaseEffect, ROUTING_FADE_SECONDS } from './BaseEffect';

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
/** 페달을 끈 뒤 게이트가 완전히 닫힐 때까지(ROUTING_FADE_SECONDS) 기다린 다음 워클릿을 멈춘다. 그 전에 멈추면 꼬리가 뚝 끊겨 딸깍 소리가 난다. */
const PROCESSOR_STOP_DELAY_SECONDS = ROUTING_FADE_SECONDS + 0.02;

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
  /** 워클릿에 마지막으로 알린 켜짐 상태. null 이면 아직 알린 적이 없다. */
  private processorActive: boolean | null = null;

  constructor(context: BaseAudioContext, pedal: PedalState) {
    const safePedal = normalizePhaserPedal(pedal);
    super(context, safePedal);
    const params = safePedal.params as PhaserParams;
    this.processor = new AudioWorkletNode(context, 'phaser-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { stages: params.stages },
      parameterData: { stages: params.stages, active: safePedal.active ? 1 : 0 },
    });
    this.processorActive = safePedal.active;
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
    this.setProcessorActive(safePedal.active);
  }

  /**
   * 꺼진 Phaser 는 필터를 돌리지 않는다(R4-2). 켤 때는 곧바로 알리고(게이트가 같은 시간에 열린다),
   * 끌 때는 게이트가 닫힌 뒤에 알린다.
   */
  private setProcessorActive(active: boolean): void {
    if (active === this.processorActive) return;
    this.processorActive = active;
    const param = this.processor.parameters.get('active');
    if (!param) return;
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(active ? 1 : 0, active ? now : now + PROCESSOR_STOP_DELAY_SECONDS);
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
