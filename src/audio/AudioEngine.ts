import { CompressorEffect } from './nodes/CompressorEffect';
import { CrunchEffect } from './nodes/CrunchEffect';
import { DelayEffect } from './nodes/DelayEffect';
import { DriveEffect } from './nodes/DriveEffect';
import { EQEffect } from './nodes/EQEffect';
import { FuzzEffect } from './nodes/FuzzEffect';
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
    bypassed: false,
    mix: 100,
    level: 100,
    thresholdDb: -54,
    reductionDb: -80,
    attackMs: 6,
    holdMs: 70,
    releaseMs: 180,
    hysteresisDb: 4,
  },
  compressor: {
    bypassed: false,
    mix: 75,
    level: 100,
    threshold: -24,
    ratio: 4,
    attack: 0.006,
    release: 0.18,
    knee: 18,
    sustain: 35,
  },
  drive: {
    bypassed: false,
    mix: 88,
    level: 95,
    mode: 'overdrive',
    drive: 42,
    tone: 55,
    bias: 0.08,
  },
  crunch: {
    bypassed: false,
    mix: 85,
    level: 90,
    volume: 80,
    gain: 55,
    tone: 55,
    presence: 45,
    lowCut: 80,
    mode: 'crunch',
  },
  fuzz: {
    bypassed: false,
    mix: 90,
    level: 90,
    fuzz: 60,
    tone: 55,
    mode: 'classic',
    bias: 50,
    gate: 15,
    lowCut: 70,
  },
  eq: {
    bypassed: false,
    mix: 100,
    level: 100,
    lowCut: 70,
    bassGain: 1.5,
    midFreq: 800,
    midGain: -0.5,
    midQ: 0.9,
    trebleGain: 1.8,
    presenceGain: 1,
  },
  delay: {
    bypassed: true,
    mix: 30,
    level: 100,
    mode: 'digital',
    timeMs: 280,
    feedback: 0.34,
    tone: 60,
    sync: false,
    bpm: 120,
    division: '1/4',
  },
  reverb: {
    bypassed: true,
    mix: 25,
    level: 100,
    mode: 'hall',
    decay: 1.8,
    preDelay: 24,
    lowCut: 120,
    highCut: 7200,
  },
};

export class AudioEngine {
  private static instance: AudioEngine | null = null;

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private audioFileUrl: string | null = null;
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
  private playbackEndedHandler: (() => void) | null = null;

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  get isRunning(): boolean {
    return !!this.context && this.context.state !== 'closed' && (!!this.stream || !!this.audioElement);
  }

  setPlaybackEndedHandler(handler: (() => void) | null): void {
    this.playbackEndedHandler = handler;
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
    this.createProcessingGraph(this.source);

    await this.context.resume();
  }

  async startFile(file: File, pedals: PedalState[]): Promise<void> {
    if (file.type && !file.type.startsWith('audio/')) {
      throw new Error('오디오 파일만 업로드할 수 있습니다.');
    }

    this.currentPedals = this.clonePedals(pedals);
    this.dispose();

    this.context = new AudioContext({ latencyHint: 'interactive' });
    await this.loadWorklets();

    this.audioFileUrl = URL.createObjectURL(file);
    this.audioElement = new Audio(this.audioFileUrl);
    this.audioElement.preload = 'auto';
    this.audioElement.addEventListener('ended', () => {
      this.playbackEndedHandler?.();
    });

    this.source = this.context.createMediaElementSource(this.audioElement);
    this.createProcessingGraph(this.source);

    await this.context.resume();
    this.rebuildChain(pedals);
    await this.audioElement.play();
  }

  async playUploadedFile(): Promise<void> {
    if (!this.audioElement) {
      throw new Error('재생할 업로드 음원이 없습니다.');
    }

    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }

    await this.audioElement.play();
  }

  pauseUploadedFile(): void {
    this.audioElement?.pause();
  }

  seekUploadedFile(deltaSeconds: number): void {
    if (!this.audioElement) return;

    const duration = Number.isFinite(this.audioElement.duration) ? this.audioElement.duration : Infinity;
    const nextTime = Math.min(Math.max(this.audioElement.currentTime + deltaSeconds, 0), duration);
    this.audioElement.currentTime = nextTime;
  }

  readFilePlayback(): { currentTime: number; duration: number; isPaused: boolean } {
    return {
      currentTime: this.audioElement?.currentTime ?? 0,
      duration:
        this.audioElement && Number.isFinite(this.audioElement.duration) ? this.audioElement.duration : 0,
      isPaused: this.audioElement?.paused ?? true,
    };
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
      case 'crunch':
        return new CrunchEffect(this.context, pedal);
      case 'fuzz':
        return new FuzzEffect(this.context, pedal);
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
      bypassed:
        (paramName === 'bypass' || paramName === 'bypassed') && typeof value === 'boolean'
          ? value
          : pedal.bypassed,
      params: {
        ...pedal.params,
        [paramName]: value,
        ...(((paramName === 'bypass' || paramName === 'bypassed') && typeof value === 'boolean'
          ? { bypassed: value }
          : {}) as Partial<PedalParams>),
      } as PedalParams,
    };

    this.pedalStates.set(pedalId, nextPedal);
    this.replaceCurrentPedal(nextPedal);
    this.effects.get(pedalId)?.update(nextPedal);
  }

  setPedalBypass(pedalId: string, bypassed: boolean): void {
    this.setPedalParam(pedalId, 'bypassed', bypassed);
  }

  setMasterVolume(value: number): void {
    this.masterVolume = value;
    if (this.masterGain && this.context) {
      rampParam(this.masterGain.gain, value, this.context, 0.02);
    }
  }

  panic(): void {
    if (this.masterGain && this.context && this.context.state !== 'closed') {
      this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
      this.masterGain.gain.setValueAtTime(0, this.context.currentTime);
    }

    this.panicDisconnect();
  }

  dispose(): void {
    this.panicDisconnect();

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    this.audioElement?.pause();
    this.audioElement = null;

    if (this.audioFileUrl) {
      URL.revokeObjectURL(this.audioFileUrl);
      this.audioFileUrl = null;
    }

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
    return this.inputMeter?.read() ?? {
      db: -120,
      linear: 0,
      peakDb: -120,
      peakLinear: 0,
      isClipping: false,
    };
  }

  readOutputLevel(): LevelReading {
    return this.outputMeter?.read() ?? {
      db: -120,
      linear: 0,
      peakDb: -120,
      peakLinear: 0,
      isClipping: false,
    };
  }

  readInputWaveform(): number[] {
    return this.inputMeter?.readWaveform() ?? [];
  }

  readOutputWaveform(): number[] {
    return this.outputMeter?.readWaveform() ?? [];
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

  private createProcessingGraph(source: AudioNode): void {
    if (!this.context) return;

    this.inputGain = this.context.createGain();
    this.chainInput = this.context.createGain();
    this.masterGain = this.context.createGain();
    this.inputMeter = new MeterNode(this.context);
    this.outputMeter = new MeterNode(this.context);
    this.tuner = new TunerNode(this.context);

    this.masterGain.gain.value = 0;

    source.connect(this.inputGain);
    this.inputGain.connect(this.inputMeter.input);
    this.inputGain.connect(this.tuner.input);
    this.inputGain.connect(this.chainInput);
    this.masterGain.connect(this.outputMeter.input);
    this.masterGain.connect(this.context.destination);
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

      pedals.filter((pedal) => pedal.enabled).forEach((pedal) => {
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
      bypassed: defaultParamsByType[type].bypassed,
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
      bypassed: Boolean(pedal.params.bypassed ?? pedal.bypassed),
      params: { ...pedal.params } as PedalParams,
    };
  }

  private replaceCurrentPedal(pedal: PedalState): void {
    this.currentPedals = this.currentPedals.map((current) =>
      current.id === pedal.id ? this.clonePedal(pedal) : current,
    );
  }
}
