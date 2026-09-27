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
const FEEDBACK_DELAY_MAX_SECONDS = 0.005;
const MIN_WET_MAKEUP = 0.3;

const DEFAULT_PARAMS: PhaserParams = {
  mix: 45,
  level: 100,
  rate: 0.5,
  depth: 70,
  stages: 6,
  feedback: 40,
};

interface PhaserBank {
  stages: PhaserParams['stages'];
  filters: BiquadFilterNode[];
  outputGain: GainNode;
  feedbackGain: GainNode;
  feedbackDelay: DelayNode;
}

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
  private readonly oscillator: OscillatorNode;
  private readonly modulationDepth: GainNode;
  private readonly banks: PhaserBank[] = [];
  private disposed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, normalizePhaserPedal(pedal));

    this.oscillator = new OscillatorNode(context, {
      type: 'sine',
      frequency: DEFAULT_PARAMS.rate,
    });
    this.modulationDepth = new GainNode(context, { gain: 0 });

    PHASER_STAGE_OPTIONS.forEach((stages) => {
      const filters = Array.from(
        { length: stages },
        () =>
          new BiquadFilterNode(context, {
            type: 'allpass',
            frequency: PHASER_CENTER_FREQUENCY,
            Q: 0.8,
          }),
      );
      const outputGain = new GainNode(context, {
        gain: stages === DEFAULT_PARAMS.stages ? 1 : 0,
      });
      const feedbackGain = new GainNode(context, { gain: 0 });
      const feedbackDelay = new DelayNode(context, {
        maxDelayTime: FEEDBACK_DELAY_MAX_SECONDS,
        delayTime: Math.max(1 / context.sampleRate, 0.00002),
      });

      this.effectInput.connect(filters[0]);
      for (let index = 1; index < filters.length; index += 1) {
        filters[index - 1].connect(filters[index]);
      }

      const lastFilter = filters[filters.length - 1];
      lastFilter.connect(outputGain);
      outputGain.connect(this.effectOutput);
      lastFilter.connect(feedbackGain);
      feedbackGain.connect(feedbackDelay);
      feedbackDelay.connect(filters[0]);

      filters.forEach((filter) => {
        this.modulationDepth.connect(filter.detune);
      });
      this.banks.push({ stages, filters, outputGain, feedbackGain, feedbackDelay });
    });

    this.oscillator.connect(this.modulationDepth);
    this.oscillator.start();
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizePhaserPedal(pedal);
    const params = safePedal.params as PhaserParams;
    const feedback = clamp(params.feedback / 100, 0, PHASER_MAX_FEEDBACK);
    const sweep = getPhaserSweep(params.depth);

    super.update(safePedal);
    smoothParam(this.oscillator.frequency, params.rate, this.context);
    smoothParam(this.modulationDepth.gain, sweep.detuneCents, this.context);
    this.banks.forEach((bank) => {
      smoothParam(bank.outputGain.gain, bank.stages === params.stages ? 1 : 0, this.context);
      smoothParam(bank.feedbackGain.gain, feedback, this.context);
    });
    this.setMakeup(getPhaserWetMakeup(feedback));
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.oscillator.stop();
    this.oscillator.disconnect();
    this.modulationDepth.disconnect();
    this.banks.forEach((bank) => {
      bank.filters.forEach((filter) => filter.disconnect());
      bank.outputGain.disconnect();
      bank.feedbackGain.disconnect();
      bank.feedbackDelay.disconnect();
    });
    super.dispose();
  }
}
