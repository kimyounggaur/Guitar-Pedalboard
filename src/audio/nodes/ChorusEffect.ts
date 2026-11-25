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
/** 보이스 수를 바꿔 LFO 묶음을 갈아 끼울 때, 물러나는 묶음의 깊이가 0 으로 내려간 뒤 끌 때까지 기다리는 시간(초). 깊이의 시상수(12 ms)의 8배다. */
const LFO_RETIRE_SECONDS = 0.1;

export const CHORUS_VOICE_BANK_SIZE = 4;

interface ChorusVoice {
  delay: DelayNode;
  panner: StereoPannerNode;
  gain: GainNode;
}

interface ChorusLfo {
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

function createPhaseShiftedSine(context: BaseAudioContext, phase: number): PeriodicWave {
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
  /** 지금 보이스 수에 맞는 LFO 묶음(보이스마다 하나). 보이스 수를 바꾸면 통째로 갈아 끼운다(S4.2). */
  private lfos: ChorusLfo[] = [];
  /** 갈아 끼워져 물러나는 중인 묶음(깊이를 0 으로 내리고 곧 꺼진다). 정리할 때 함께 끈다. */
  private readonly retiring = new Set<ChorusLfo>();
  private readonly voiceSum: GainNode;
  private readonly tone: BiquadFilterNode;
  private disposed = false;

  constructor(context: BaseAudioContext, pedal: PedalState) {
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

    this.syncLfos(params.voices, params.rate);
    this.lfos.forEach((lfo) => {
      smoothParam(lfo.oscillator.frequency, params.rate, this.context);
      smoothParam(lfo.depth.gain, modulationDepth, this.context);
    });

    smoothParam(this.tone.frequency, getToneFrequency(params.tone), this.context);
  }

  /**
   * LFO 를 지금 보이스 수만큼만 둔다(S4.2). 예전에는 2·3·4 보이스용 아홉 개를 모두 돌렸고, 안 쓰는 묶음은 깊이만 0 이었다.
   * 보이스 수가 같으면 아무것도 하지 않는다. 바뀌면 새 묶음을 만들어 깊이 0 에서 올라오게 하고(이어서 update 가 smoothParam 을 건다)
   * 옛 묶음은 깊이를 0 으로 내린 뒤 끈다 — 두 묶음이 겹치는 동안에도 지연 시간이 튀지 않는다. 노브를 돌릴 때마다가 아니라 보이스 수를
   * 고를 때만 노드가 만들어진다.
   */
  private syncLfos(voices: ChorusParams['voices'], rate: number): void {
    if (this.lfos.length === voices) return;
    // 처음 만들 때는 옛 구현처럼 기본 속도로 시작해 update 가 곧 정한 속도로 부드럽게 옮긴다(소리가 옛 구현과 같다). 그 뒤에는 지금 속도로 시작한다.
    const frequency = this.lfos.length === 0 ? DEFAULT_PARAMS.rate : rate;
    this.retireLfos();
    for (let voiceIndex = 0; voiceIndex < voices; voiceIndex += 1) {
      const oscillator = new OscillatorNode(this.context, { frequency });
      const depth = new GainNode(this.context, { gain: 0 });
      const phase = (Math.PI * 2 * voiceIndex) / voices;

      oscillator.setPeriodicWave(createPhaseShiftedSine(this.context, phase));
      oscillator.connect(depth);
      depth.connect(this.voices[voiceIndex].delay.delayTime);
      oscillator.start();
      this.lfos.push({ voiceIndex, oscillator, depth });
    }
  }

  private retireLfos(): void {
    const stopAt = this.context.currentTime + LFO_RETIRE_SECONDS;
    for (const lfo of this.lfos) {
      smoothParam(lfo.depth.gain, 0, this.context);
      lfo.oscillator.stop(stopAt);
      this.retiring.add(lfo);
      lfo.oscillator.onended = () => {
        lfo.oscillator.disconnect();
        lfo.depth.disconnect();
        this.retiring.delete(lfo);
      };
    }
    this.lfos = [];
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    [...this.lfos, ...this.retiring].forEach((lfo) => {
      lfo.oscillator.onended = null;
      lfo.oscillator.stop();
      lfo.oscillator.disconnect();
      lfo.depth.disconnect();
    });
    this.retiring.clear();
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
