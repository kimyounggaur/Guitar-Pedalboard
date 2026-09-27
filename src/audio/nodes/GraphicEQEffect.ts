import type { GraphicEQParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';
import { BaseEffect } from './BaseEffect';

export const GRAPHIC_EQ_FREQUENCIES = [100, 200, 400, 800, 1600, 3200, 6400] as const;
export const GRAPHIC_EQ_Q = 1.4;
export const GRAPHIC_EQ_MIN_GAIN_DB = -12;
export const GRAPHIC_EQ_MAX_GAIN_DB = 12;

export const GRAPHIC_EQ_BAND_KEYS = [
  'band100',
  'band200',
  'band400',
  'band800',
  'band1600',
  'band3200',
  'band6400',
] as const satisfies readonly (keyof GraphicEQParams)[];

const DEFAULT_PARAMS: GraphicEQParams = {
  mix: 100,
  level: 100,
  band100: 0,
  band200: 0,
  band400: 0,
  band800: 0,
  band1600: 0,
  band3200: 0,
  band6400: 0,
};

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return clamp(finiteOr(value, fallback), min, max);
}

export function normalizeGraphicEQParams(params: GraphicEQParams): GraphicEQParams {
  return {
    mix: clampFinite(params.mix, 0, 100, DEFAULT_PARAMS.mix),
    level: clampFinite(params.level, 0, 200, DEFAULT_PARAMS.level),
    band100: clampFinite(params.band100, -12, 12, DEFAULT_PARAMS.band100),
    band200: clampFinite(params.band200, -12, 12, DEFAULT_PARAMS.band200),
    band400: clampFinite(params.band400, -12, 12, DEFAULT_PARAMS.band400),
    band800: clampFinite(params.band800, -12, 12, DEFAULT_PARAMS.band800),
    band1600: clampFinite(params.band1600, -12, 12, DEFAULT_PARAMS.band1600),
    band3200: clampFinite(params.band3200, -12, 12, DEFAULT_PARAMS.band3200),
    band6400: clampFinite(params.band6400, -12, 12, DEFAULT_PARAMS.band6400),
  };
}

function normalizeGraphicEQPedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    params: normalizeGraphicEQParams(pedal.params as GraphicEQParams),
  };
}

export class GraphicEQEffect extends BaseEffect {
  private readonly filters: BiquadFilterNode[];
  private disposed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    const safePedal = normalizeGraphicEQPedal(pedal);
    super(context, safePedal);

    this.filters = GRAPHIC_EQ_FREQUENCIES.map(
      (frequency) =>
        new BiquadFilterNode(context, {
          type: 'peaking',
          frequency,
          Q: GRAPHIC_EQ_Q,
          gain: 0,
        }),
    );

    this.effectInput.connect(this.filters[0]);
    for (let index = 0; index < this.filters.length - 1; index += 1) {
      this.filters[index].connect(this.filters[index + 1]);
    }
    this.filters[this.filters.length - 1].connect(this.effectOutput);

    this.update(safePedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizeGraphicEQPedal(pedal);
    const params = safePedal.params as GraphicEQParams;

    super.update(safePedal);
    this.filters.forEach((filter, index) => {
      smoothParam(filter.gain, params[GRAPHIC_EQ_BAND_KEYS[index]], this.context);
    });
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.filters.forEach((filter) => filter.disconnect());
    super.dispose();
  }
}
