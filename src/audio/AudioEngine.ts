import { CompressorEffect } from './nodes/CompressorEffect';
import { DelayEffect } from './nodes/DelayEffect';
import { DriveEffect } from './nodes/DriveEffect';
import { EQEffect } from './nodes/EQEffect';
import { MeterNode } from './nodes/MeterNode';
import { NoiseGateEffect } from './nodes/NoiseGateEffect';
import { ReverbEffect } from './nodes/ReverbEffect';
import { TunerNode } from './nodes/TunerNode';
import type {
  EffectNodeWrapper,
  LevelReading,
  PedalParams,
  PedalState,
  PedalType,
  PitchReading,
} from './types';
import { rampParam } from './utils/smoothing';
import { driveProcessorSource } from './worklets/drive-processor';
import { noiseGateProcessorSource } from './worklets/noise-gate-processor';

type EffectNode = EffectNodeWrapper;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const defaultParamsByType: Record<PedalType, PedalParams> = {
  noiseGate: {
    bypass: false,
    mix: 1,
    level: 1,
    threshold: -54,
    release: 0.09,
  },
  compressor: {
    bypass: false,
    mix: 0.75,
    level: 1,
    threshold: -24,
    ratio: 4,
    attack: 0.006,
    release: 0.18,
  },
  drive: {
    bypass: false,
    mix: 0.88,
    level: 0.95,
    drive: 0.42,
    tone: 0.55,
  },
  eq: {
    bypass: false,
    mix: 1,
    level: 1,
    low: 1.5,
    mid: -0.5,
    high: 1.8,
  },
  delay: {
    bypass: true,
    mix: 0.3,
    level: 1,
    time: 0.28,
    feedback: 0.34,
    tone: 0.6,
  },
  reverb: {
    bypass: true,
    mix: 0.25,
    level: 1,
    decay: 1.8,
    tone: 0.68,
  },
};

export class AudioEngine {
  private static instance: AudioEngine | null = null;

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private inputGain: GainNode | null = null;
  private chainInput: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private inputMeter: MeterNode | null = null;
  private outputMeter: MeterNode | null = null;
  private tuner: TunerNode | null = null;
  private effects = new Map<string, EffectNode>();
  private pedalStates = new Map<string, PedalState>();
  private currentPedals: PedalState[] = [];
  private rebuildQueue: Promise<void> = Promise.resolve();
  private masterVolume = 0.9;
  private workletsLoaded = false;
  private workletUrls: string[] = [];

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  get isRunning(): boolean {
    return !!this.context && this.context.state !== 'closed' && !!this.stream;
  }

  async listInputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput');
  }

  async init(deviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 오디오 입력을 지원하지 않습니다.');
    }

    this.dispose();

    this.context = new AudioContext({ latencyHint: 'interactive' });
    await this.loadWorklets();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
      video: false,
    });

    this.source = this.context.createMediaStreamSource(this.stream);
    this.inputGain = this.context.createGain();
    this.chainInput = this.context.createGain();
    this.masterGain = this.context.createGain();
    this.inputMeter = new MeterNode(this.context);
    this.outputMeter = new MeterNode(this.context);
    this.tuner = new TunerNode(this.context);

    this.masterGain.gain.value = 0;

    this.source.connect(this.inputGain);
    this.inputGain.connect(this.inputMeter.input);
    this.inputGain.connect(this.tuner.input);
    this.inputGain.connect(this.chainInput);
    this.masterGain.connect(this.outputMeter.input);
    this.masterGain.connect(this.context.destination);

    await this.context.resume();
  }

  async setInputDevice(deviceId: string): Promise<void> {
    await this.init(deviceId);
    this.rebuildChain(this.currentPedals);
  }

  createEffect(type: PedalType, id: string): EffectNodeWrapper {
    if (!this.context) {
      throw new Error('AudioContext가 아직 준비되지 않았습니다.');
    }

    const pedal = this.pedalStates.get(id) ?? this.createDefaultPedal(type, id);

    switch (type) {
      case 'noiseGate':
        return new NoiseGateEffect(this.context, pedal);
      case 'compressor':
        return new CompressorEffect(this.context, pedal);
      case 'drive':
        return new DriveEffect(this.context, pedal);
      case 'eq':
        return new EQEffect(this.context, pedal);
      case 'delay':
        return new DelayEffect(this.context, pedal);
      case 'reverb':
        return new ReverbEffect(this.context, pedal);
      default:
        throw new Error(`알 수 없는 이펙터 타입입니다: ${type satisfies never}`);
    }
  }

  rebuildChain(pedals: PedalState[]): void {
    this.currentPedals = this.clonePedals(pedals);
    this.currentPedals.forEach((pedal) => this.pedalStates.set(pedal.id, this.clonePedal(pedal)));

    this.rebuildQueue = this.rebuildQueue
      .catch(() => undefined)
      .then(() => this.rebuildNow(this.currentPedals));
  }

  setPedalParam(pedalId: string, paramName: string, value: number | string | boolean): void {
    const pedal = this.pedalStates.get(pedalId);
    if (!pedal) return;

    const nextPedal = {
      ...pedal,
      bypassed: paramName === 'bypass' && typeof value === 'boolean' ? value : pedal.bypassed,
      params: {
        ...pedal.params,
        [paramName]: value,
      } as PedalParams,
    };

    this.pedalStates.set(pedalId, nextPedal);
    this.replaceCurrentPedal(nextPedal);
    this.effects.get(pedalId)?.update(nextPedal);
  }

  setPedalBypass(pedalId: string, bypassed: boolean): void {
    this.setPedalParam(pedalId, 'bypass', bypassed);
  }

  setMasterVolume(value: number): void {
    this.masterVolume = value;
    if (this.masterGain && this.context) {
      rampParam(this.masterGain.gain, value, this.context, 0.02);
    }
  }

  dispose(): void {
    this.panicDisconnect();

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.context && this.context.state !== 'closed') {
      void this.context.close();
    }

    this.context = null;
    this.source = null;
    this.inputGain = null;
    this.chainInput = null;
    this.masterGain = null;
    this.inputMeter = null;
    this.outputMeter = null;
    this.tuner = null;
    this.effects.clear();
    this.workletsLoaded = false;
    this.workletUrls.forEach((url) => URL.revokeObjectURL(url));
    this.workletUrls = [];
  }

  async start(pedals: PedalState[], deviceId?: string): Promise<void> {
    this.currentPedals = this.clonePedals(pedals);
    await this.init(deviceId);
    this.rebuildChain(pedals);
  }

  async stop(): Promise<void> {
    if (this.masterGain && this.context && this.context.state !== 'closed') {
      rampParam(this.masterGain.gain, 0, this.context, 0.02);
      await wait(24);
    }

    this.dispose();
  }

  updatePedal(pedal: PedalState): void {
    const nextPedal = this.clonePedal(pedal);
    this.pedalStates.set(pedal.id, nextPedal);
    this.replaceCurrentPedal(nextPedal);
    this.effects.get(pedal.id)?.update(pedal);
  }

  setOutputLevel(value: number): void {
    this.setMasterVolume(value);
  }

  readInputLevel(): LevelReading {
    return this.inputMeter?.read() ?? { db: -120, linear: 0 };
  }

  readOutputLevel(): LevelReading {
    return this.outputMeter?.read() ?? { db: -120, linear: 0 };
  }

  readPitch(): PitchReading {
    return this.tuner?.readPitch() ?? { frequency: null, note: null, cents: 0 };
  }

  private async loadWorklets(): Promise<void> {
    if (!this.context || this.workletsLoaded) return;

    const moduleUrls = [
      this.createWorkletUrl(noiseGateProcessorSource),
      this.createWorkletUrl(driveProcessorSource),
    ];

    await Promise.all(moduleUrls.map((url) => this.context?.audioWorklet.addModule(url)));
    this.workletsLoaded = true;
  }

  private createWorkletUrl(source: string): string {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    this.workletUrls.push(url);
    return url;
  }

  private async rebuildNow(pedals: PedalState[]): Promise<void> {
    if (!this.context || !this.chainInput || !this.masterGain) return;

    try {
      rampParam(this.masterGain.gain, 0, this.context, 0.02);
      await wait(24);

      this.chainInput.disconnect();
      this.effects.forEach((effect) => effect.dispose());
      this.effects.clear();

      let previous: AudioNode = this.chainInput;

      pedals.forEach((pedal) => {
        const effect = this.createEffect(pedal.type, pedal.id);
        previous.connect(effect.input);
        previous = effect.output;
        this.effects.set(pedal.id, effect);
      });

      previous.connect(this.masterGain);
      rampParam(this.masterGain.gain, this.masterVolume, this.context, 0.02);
    } catch (error) {
      this.panicDisconnect();
      throw error;
    }
  }

  private panicDisconnect(): void {
    this.source?.disconnect();
    this.inputGain?.disconnect();
    this.chainInput?.disconnect();
    this.masterGain?.disconnect();
    this.inputMeter?.disconnect();
    this.outputMeter?.disconnect();
    this.tuner?.disconnect();
    this.effects.forEach((effect) => effect.dispose());
    this.effects.clear();
  }

  private createDefaultPedal(type: PedalType, id: string): PedalState {
    return {
      id,
      type,
      name: type,
      enabled: true,
      bypassed: defaultParamsByType[type].bypass,
      color: '#6b7280',
      params: { ...defaultParamsByType[type] } as PedalParams,
    };
  }

  private clonePedals(pedals: PedalState[]): PedalState[] {
    return pedals.map((pedal) => this.clonePedal(pedal));
  }

  private clonePedal(pedal: PedalState): PedalState {
    return {
      ...pedal,
      bypassed: pedal.params.bypass,
      params: { ...pedal.params } as PedalParams,
    };
  }

  private replaceCurrentPedal(pedal: PedalState): void {
    this.currentPedals = this.currentPedals.map((current) =>
      current.id === pedal.id ? this.clonePedal(pedal) : current,
    );
  }
}
