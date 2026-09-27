import type { AutoWahParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';
import { BaseEffect } from './BaseEffect';

export const AUTO_WAH_MIN_FREQUENCY = 300;
export const AUTO_WAH_MAX_FREQUENCY = 2500;
export const AUTO_WAH_MIN_Q = 1;
export const AUTO_WAH_MAX_Q = 12;
export const AUTO_WAH_ATTACK_SECONDS = 0.005;
export const AUTO_WAH_RELEASE_SECONDS = 0.12;
export const AUTO_WAH_MAX_DETUNE_CENTS =
  1200 * Math.log2(AUTO_WAH_MAX_FREQUENCY / AUTO_WAH_MIN_FREQUENCY);
export const AUTO_WAH_MIN_SENSITIVITY_SCALE = 1;
export const AUTO_WAH_MAX_SENSITIVITY_SCALE = 8;
export const AUTO_WAH_DISPOSE_FALLBACK_MS = 50;

const DEFAULT_PARAMS: AutoWahParams = {
  mix: 100,
  level: 100,
  sensitivity: 55,
  range: 60,
  resonance: 45,
  mode: 'auto',
  manual: 50,
};

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return clamp(finiteOr(value, fallback), min, max);
}

export function normalizeAutoWahParams(params: AutoWahParams): AutoWahParams {
  return {
    mix: clampFinite(params.mix, 0, 100, DEFAULT_PARAMS.mix),
    level: clampFinite(params.level, 0, 200, DEFAULT_PARAMS.level),
    sensitivity: clampFinite(params.sensitivity, 0, 100, DEFAULT_PARAMS.sensitivity),
    range: clampFinite(params.range, 0, 100, DEFAULT_PARAMS.range),
    resonance: clampFinite(params.resonance, 0, 100, DEFAULT_PARAMS.resonance),
    mode: params.mode === 'manual' || params.mode === 'auto' ? params.mode : DEFAULT_PARAMS.mode,
    manual: clampFinite(params.manual, 0, 100, DEFAULT_PARAMS.manual),
  };
}

function normalizeAutoWahPedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    params: normalizeAutoWahParams(pedal.params as AutoWahParams),
  };
}

export function getAutoWahManualFrequency(manual: number): number {
  const normalized = clampFinite(manual, 0, 100, DEFAULT_PARAMS.manual) / 100;
  return AUTO_WAH_MIN_FREQUENCY *
    Math.pow(AUTO_WAH_MAX_FREQUENCY / AUTO_WAH_MIN_FREQUENCY, normalized);
}

export function getAutoWahDetuneRange(range: number): number {
  return AUTO_WAH_MAX_DETUNE_CENTS *
    (clampFinite(range, 0, 100, DEFAULT_PARAMS.range) / 100);
}

export function getAutoWahAutoMaximumFrequency(range: number): number {
  return AUTO_WAH_MIN_FREQUENCY * Math.pow(2, getAutoWahDetuneRange(range) / 1200);
}

export function getAutoWahResonanceQ(resonance: number): number {
  const normalized = clampFinite(resonance, 0, 100, DEFAULT_PARAMS.resonance) / 100;
  return AUTO_WAH_MIN_Q + (AUTO_WAH_MAX_Q - AUTO_WAH_MIN_Q) * normalized;
}

export function getAutoWahSensitivityScale(sensitivity: number): number {
  const normalized = clampFinite(sensitivity, 0, 100, DEFAULT_PARAMS.sensitivity) / 100;
  return AUTO_WAH_MIN_SENSITIVITY_SCALE +
    (AUTO_WAH_MAX_SENSITIVITY_SCALE - AUTO_WAH_MIN_SENSITIVITY_SCALE) * normalized;
}

export class AutoWahEffect extends BaseEffect {
  private readonly follower: AudioWorkletNode;
  private readonly filter: BiquadFilterNode;
  private readonly controlDepth: GainNode;
  private readonly sensitivityParam: AudioParam;
  private disposed = false;
  private disposePortTimer: number | null = null;
  private disposePortClosed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    const safePedal = normalizeAutoWahPedal(pedal);
    const params = safePedal.params as AutoWahParams;
    super(context, safePedal);

    this.follower = new AudioWorkletNode(context, 'envelope-follower-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 2,
      outputChannelCount: [2, 1],
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      parameterData: { sensitivity: params.sensitivity },
    });
    this.filter = new BiquadFilterNode(context, {
      type: 'bandpass',
      frequency: AUTO_WAH_MIN_FREQUENCY,
      detune: params.mode === 'auto' ? 0 : getAutoWahDetuneRange(params.manual),
      Q: getAutoWahResonanceQ(params.resonance),
    });
    this.controlDepth = new GainNode(context, {
      gain: params.mode === 'auto' ? getAutoWahDetuneRange(params.range) : 0,
    });

    const sensitivityParam = this.follower.parameters.get('sensitivity');
    if (!sensitivityParam) {
      this.follower.disconnect();
      this.filter.disconnect();
      this.controlDepth.disconnect();
      super.dispose();
      throw new Error('Auto Wah sensitivity AudioParam을 찾을 수 없습니다.');
    }
    this.sensitivityParam = sensitivityParam;

    this.effectInput.connect(this.follower);
    this.follower.connect(this.filter, 0, 0);
    this.follower.connect(this.controlDepth, 1, 0);
    this.controlDepth.connect(this.filter.detune);
    this.filter.connect(this.effectOutput);

    this.update(safePedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizeAutoWahPedal(pedal);
    const params = safePedal.params as AutoWahParams;
    const isAuto = params.mode === 'auto';

    super.update(safePedal);
    smoothParam(this.sensitivityParam, params.sensitivity, this.context);
    smoothParam(this.filter.frequency, AUTO_WAH_MIN_FREQUENCY, this.context);
    smoothParam(
      this.filter.detune,
      isAuto ? 0 : getAutoWahDetuneRange(params.manual),
      this.context,
    );
    smoothParam(this.filter.Q, getAutoWahResonanceQ(params.resonance), this.context);
    smoothParam(
      this.controlDepth.gain,
      isAuto ? getAutoWahDetuneRange(params.range) : 0,
      this.context,
    );
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.follower.port.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === 'disposed') this.closeFollowerPort();
    };
    this.disposePortTimer = globalThis.setTimeout(
      () => this.closeFollowerPort(),
      AUTO_WAH_DISPOSE_FALLBACK_MS,
    );
    this.follower.port.postMessage({ type: 'dispose' });
    this.follower.disconnect();
    this.controlDepth.disconnect();
    this.filter.disconnect();
    super.dispose();
  }

  private closeFollowerPort(): void {
    if (this.disposePortClosed) return;
    this.disposePortClosed = true;

    if (this.disposePortTimer !== null) {
      globalThis.clearTimeout(this.disposePortTimer);
      this.disposePortTimer = null;
    }
    this.follower.port.onmessage = null;
    this.follower.port.close();
  }
}
