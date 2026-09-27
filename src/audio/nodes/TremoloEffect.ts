import type { PedalState, TremoloParams } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';
import { BaseEffect } from './BaseEffect';

const MIN_RATE_HZ = 0.5;
const MAX_RATE_HZ = 20;
const MIN_BPM = 40;
const MAX_BPM = 240;

export const TREMOLO_SHAPES = ['sine', 'triangle', 'square'] as const;
export const TREMOLO_LFO_BANK_SIZE = TREMOLO_SHAPES.length;
export const TREMOLO_SQUARE_SLEW_SECONDS = 0.001;
export const TREMOLO_SQUARE_SLEW_FREQUENCY =
  1 / (Math.PI * 2 * TREMOLO_SQUARE_SLEW_SECONDS);
export const TREMOLO_DIVISION_BEATS: Record<TremoloParams['division'], number> = {
  '1/4': 1,
  '1/8': 0.5,
  'dotted1/8': 0.75,
  '1/16': 0.25,
};

const DEFAULT_PARAMS: TremoloParams = {
  mix: 100,
  level: 100,
  rate: 5,
  depth: 50,
  shape: 'sine',
  sync: false,
  bpm: 120,
  division: '1/8',
};

interface TremoloLfoBank {
  shape: TremoloParams['shape'];
  oscillator: OscillatorNode;
  modulationGain: GainNode;
  slewFilter: BiquadFilterNode | null;
}

export interface TremoloGainBounds {
  minimum: number;
  maximum: number;
  center: number;
  modulationDepth: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return clamp(finiteOr(value, fallback), min, max);
}

function normalizeShape(value: TremoloParams['shape']): TremoloParams['shape'] {
  return TREMOLO_SHAPES.includes(value) ? value : DEFAULT_PARAMS.shape;
}

function normalizeDivision(value: TremoloParams['division']): TremoloParams['division'] {
  return Object.hasOwn(TREMOLO_DIVISION_BEATS, value) ? value : DEFAULT_PARAMS.division;
}

export function normalizeTremoloParams(params: TremoloParams): TremoloParams {
  return {
    mix: clampFinite(params.mix, 0, 100, DEFAULT_PARAMS.mix),
    level: clampFinite(params.level, 0, 200, DEFAULT_PARAMS.level),
    rate: clampFinite(params.rate, MIN_RATE_HZ, MAX_RATE_HZ, DEFAULT_PARAMS.rate),
    depth: clampFinite(params.depth, 0, 100, DEFAULT_PARAMS.depth),
    shape: normalizeShape(params.shape),
    sync: typeof params.sync === 'boolean' ? params.sync : DEFAULT_PARAMS.sync,
    bpm: clampFinite(params.bpm, MIN_BPM, MAX_BPM, DEFAULT_PARAMS.bpm),
    division: normalizeDivision(params.division),
  };
}

function normalizeTremoloPedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    params: normalizeTremoloParams(pedal.params as TremoloParams),
  };
}

export function getTremoloRate(params: TremoloParams): number {
  const safeParams = normalizeTremoloParams(params);
  if (!safeParams.sync) return safeParams.rate;

  const cycleSeconds = (60 / safeParams.bpm) * TREMOLO_DIVISION_BEATS[safeParams.division];
  return clamp(1 / cycleSeconds, MIN_RATE_HZ, MAX_RATE_HZ);
}

export function getTremoloGainBounds(depth: number): TremoloGainBounds {
  const boundedDepth = clampFinite(depth, 0, 100, DEFAULT_PARAMS.depth) / 100;
  const modulationDepth = boundedDepth / 2;

  return {
    minimum: 1 - boundedDepth,
    maximum: 1,
    center: 1 - modulationDepth,
    modulationDepth,
  };
}

export class TremoloEffect extends BaseEffect {
  private readonly amplitude: GainNode;
  private readonly lfoBanks: TremoloLfoBank[] = [];
  private disposed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, normalizeTremoloPedal(pedal));

    this.amplitude = new GainNode(context, { gain: 1 });
    this.effectInput.connect(this.amplitude);
    this.amplitude.connect(this.effectOutput);

    const lfoStartTime = context.currentTime;
    TREMOLO_SHAPES.forEach((shape) => {
      const oscillator = new OscillatorNode(context, {
        type: shape,
        frequency: DEFAULT_PARAMS.rate,
      });
      const modulationGain = new GainNode(context, { gain: 0 });
      const slewFilter =
        shape === 'square'
          ? new BiquadFilterNode(context, {
              type: 'lowpass',
              frequency: TREMOLO_SQUARE_SLEW_FREQUENCY,
              Q: 0.5,
            })
          : null;

      if (slewFilter) {
        oscillator.connect(slewFilter);
        slewFilter.connect(modulationGain);
      } else {
        oscillator.connect(modulationGain);
      }

      modulationGain.connect(this.amplitude.gain);
      oscillator.start(lfoStartTime);
      this.lfoBanks.push({ shape, oscillator, modulationGain, slewFilter });
    });

    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizeTremoloPedal(pedal);
    const params = safePedal.params as TremoloParams;
    const rate = getTremoloRate(params);
    const gainBounds = getTremoloGainBounds(params.depth);

    super.update(safePedal);
    smoothParam(this.amplitude.gain, gainBounds.center, this.context);
    this.lfoBanks.forEach((bank) => {
      smoothParam(bank.oscillator.frequency, rate, this.context);
      smoothParam(
        bank.modulationGain.gain,
        bank.shape === params.shape ? gainBounds.modulationDepth : 0,
        this.context,
      );
    });
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.lfoBanks.forEach((bank) => {
      bank.oscillator.stop();
      bank.oscillator.disconnect();
      bank.slewFilter?.disconnect();
      bank.modulationGain.disconnect();
    });
    this.amplitude.disconnect();
    super.dispose();
  }
}
