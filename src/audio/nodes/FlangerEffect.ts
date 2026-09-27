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
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly wetMakeup: GainNode;
  private readonly oscillator: OscillatorNode;
  private readonly modulationDepth: GainNode;
  private disposed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, normalizeFlangerPedal(pedal));

    this.delay = new DelayNode(context, {
      maxDelayTime: MAX_MANUAL_SECONDS,
      delayTime: DEFAULT_PARAMS.manual / 1000,
    });
    this.feedback = new GainNode(context, { gain: 0 });
    this.wetMakeup = new GainNode(context, { gain: 1 });
    this.oscillator = new OscillatorNode(context, {
      type: 'sine',
      frequency: DEFAULT_PARAMS.rate,
    });
    this.modulationDepth = new GainNode(context, { gain: 0 });

    this.effectInput.connect(this.delay);
    this.delay.connect(this.wetMakeup);
    this.wetMakeup.connect(this.effectOutput);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.oscillator.connect(this.modulationDepth);
    this.modulationDepth.connect(this.delay.delayTime);

    this.oscillator.start();
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizeFlangerPedal(pedal);
    const params = safePedal.params as FlangerParams;
    const manualSeconds = clamp(params.manual / 1000, MIN_MANUAL_SECONDS, MAX_MANUAL_SECONDS);
    const feedback = clamp(params.feedback / 100, -FLANGER_MAX_FEEDBACK, FLANGER_MAX_FEEDBACK);
    const wetMakeup = Math.max(0.05, 1 - Math.abs(feedback));

    super.update(safePedal);
    smoothParam(this.delay.delayTime, manualSeconds, this.context);
    smoothParam(this.oscillator.frequency, params.rate, this.context);
    smoothParam(
      this.modulationDepth.gain,
      getFlangerModulationDepth(manualSeconds, params.depth),
      this.context,
    );
    smoothParam(this.feedback.gain, feedback, this.context);
    smoothParam(this.wetMakeup.gain, wetMakeup, this.context);
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.oscillator.stop();
    this.oscillator.disconnect();
    this.modulationDepth.disconnect();
    this.feedback.disconnect();
    this.wetMakeup.disconnect();
    this.delay.disconnect();
    super.dispose();
  }
}
