import type { ChorusParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';
import { BaseEffect } from './BaseEffect';

const MIN_RATE_HZ = 0.1;
const MAX_RATE_HZ = 8;
const MIN_DELAY_SECONDS = 0.012;
const MAX_DELAY_SECONDS = 0.028;
const MAX_MODULATION_SECONDS = 0.004;
const MIN_TONE_HZ = 800;
const MAX_TONE_HZ = 12_000;
const DEFAULT_PARAMS: ChorusParams = {
  mix: 35,
  level: 100,
  rate: 0.8,
  depth: 45,
  voices: 3,
  spread: 60,
  tone: 60,
};
const SUPPORTED_VOICE_COUNTS = [2, 3, 4] as const;

export const CHORUS_VOICE_BANK_SIZE = 4;
export const CHORUS_LFO_BANK_SIZE = SUPPORTED_VOICE_COUNTS.reduce(
  (total, voices) => total + voices,
  0,
);

interface ChorusVoice {
  delay: DelayNode;
  panner: StereoPannerNode;
  gain: GainNode;
}

interface ChorusLfo {
  voices: ChorusParams['voices'];
  voiceIndex: number;
  oscillator: OscillatorNode;
  depth: GainNode;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return clamp(finiteOr(value, fallback), min, max);
}

function normalizeVoiceCount(value: number): ChorusParams['voices'] {
  const finiteValue = finiteOr(value, DEFAULT_PARAMS.voices);
  if (finiteValue < 2.5) return 2;
  if (finiteValue < 3.5) return 3;
  return 4;
}

export function normalizeChorusParams(params: ChorusParams): ChorusParams {
  return {
    mix: clampFinite(params.mix, 0, 100, DEFAULT_PARAMS.mix),
    level: clampFinite(params.level, 0, 200, DEFAULT_PARAMS.level),
    rate: clampFinite(params.rate, MIN_RATE_HZ, MAX_RATE_HZ, DEFAULT_PARAMS.rate),
    depth: clampFinite(params.depth, 0, 100, DEFAULT_PARAMS.depth),
    voices: normalizeVoiceCount(params.voices),
    spread: clampFinite(params.spread, 0, 100, DEFAULT_PARAMS.spread),
    tone: clampFinite(params.tone, 0, 100, DEFAULT_PARAMS.tone),
  };
}

function normalizeChorusPedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    params: normalizeChorusParams(pedal.params as ChorusParams),
  };
}

function createPhaseShiftedSine(context: AudioContext, phase: number): PeriodicWave {
  const real = new Float32Array(2);
  const imaginary = new Float32Array(2);
  real[1] = Math.sin(phase);
  imaginary[1] = Math.cos(phase);
  return context.createPeriodicWave(real, imaginary, { disableNormalization: true });
}

function getDelayTime(voiceIndex: number, voices: ChorusParams['voices']): number {
  const activeIndex = Math.min(voiceIndex, voices - 1);
  const progress = activeIndex / (voices - 1);
  return MIN_DELAY_SECONDS + progress * (MAX_DELAY_SECONDS - MIN_DELAY_SECONDS);
}

function getPan(voiceIndex: number, voices: ChorusParams['voices'], spread: number): number {
  if (voiceIndex >= voices) return 0;
  const position = (voiceIndex / (voices - 1)) * 2 - 1;
  return position * (spread / 100);
}

function getToneFrequency(tone: number): number {
  const normalized = tone / 100;
  return MIN_TONE_HZ + Math.pow(normalized, 1.6) * (MAX_TONE_HZ - MIN_TONE_HZ);
}

export class ChorusEffect extends BaseEffect {
  private readonly voices: ChorusVoice[] = [];
  private readonly lfos: ChorusLfo[] = [];
  private readonly voiceSum: GainNode;
  private readonly tone: BiquadFilterNode;
  private disposed = false;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, normalizeChorusPedal(pedal));

    this.voiceSum = new GainNode(context, { gain: 1 });
    this.tone = new BiquadFilterNode(context, {
      type: 'lowpass',
      frequency: getToneFrequency(DEFAULT_PARAMS.tone),
      Q: 0.7,
    });

    for (let voiceIndex = 0; voiceIndex < CHORUS_VOICE_BANK_SIZE; voiceIndex += 1) {
      const delay = new DelayNode(context, {
        maxDelayTime: 0.05,
        delayTime: getDelayTime(voiceIndex, DEFAULT_PARAMS.voices),
      });
      const panner = new StereoPannerNode(context, { pan: 0 });
      const gain = new GainNode(context, { gain: 0 });

      this.effectInput.connect(delay);
      delay.connect(panner);
      panner.connect(gain);
      gain.connect(this.voiceSum);
      this.voices.push({ delay, panner, gain });
    }

    SUPPORTED_VOICE_COUNTS.forEach((voices) => {
      for (let voiceIndex = 0; voiceIndex < voices; voiceIndex += 1) {
        const oscillator = new OscillatorNode(context, { frequency: DEFAULT_PARAMS.rate });
        const depth = new GainNode(context, { gain: 0 });
        const phase = (Math.PI * 2 * voiceIndex) / voices;

        oscillator.setPeriodicWave(createPhaseShiftedSine(context, phase));
        oscillator.connect(depth);
        depth.connect(this.voices[voiceIndex].delay.delayTime);
        oscillator.start();
        this.lfos.push({ voices, voiceIndex, oscillator, depth });
      }
    });

    this.voiceSum.connect(this.tone);
    this.tone.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    const safePedal = normalizeChorusPedal(pedal);
    const params = safePedal.params as ChorusParams;
    super.update(safePedal);

    const modulationDepth = (params.depth / 100) * MAX_MODULATION_SECONDS;
    const voiceGain = 1 / params.voices;

    this.voices.forEach((voice, voiceIndex) => {
      const active = voiceIndex < params.voices;
      smoothParam(
        voice.delay.delayTime,
        getDelayTime(voiceIndex, params.voices),
        this.context,
      );
      smoothParam(
        voice.panner.pan,
        getPan(voiceIndex, params.voices, params.spread),
        this.context,
      );
      smoothParam(voice.gain.gain, active ? voiceGain : 0, this.context);
    });

    this.lfos.forEach((lfo) => {
      const active = lfo.voices === params.voices && lfo.voiceIndex < params.voices;
      smoothParam(lfo.oscillator.frequency, params.rate, this.context);
      smoothParam(lfo.depth.gain, active ? modulationDepth : 0, this.context);
    });

    smoothParam(this.tone.frequency, getToneFrequency(params.tone), this.context);
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.lfos.forEach((lfo) => {
      lfo.oscillator.stop();
      lfo.oscillator.disconnect();
      lfo.depth.disconnect();
    });
    this.voices.forEach((voice) => {
      voice.delay.disconnect();
      voice.panner.disconnect();
      voice.gain.disconnect();
    });
    this.voiceSum.disconnect();
    this.tone.disconnect();
    super.dispose();
  }
}
