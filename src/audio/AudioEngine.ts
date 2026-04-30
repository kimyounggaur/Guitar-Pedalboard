import { CompressorEffect } from './nodes/CompressorEffect';
import { DelayEffect } from './nodes/DelayEffect';
import { DriveEffect } from './nodes/DriveEffect';
import { EQEffect } from './nodes/EQEffect';
import { MeterNode } from './nodes/MeterNode';
import { NoiseGateEffect } from './nodes/NoiseGateEffect';
import { ReverbEffect } from './nodes/ReverbEffect';
import { TunerNode } from './nodes/TunerNode';
import type { LevelReading, PedalState, PitchReading } from './types';
import { rampParam } from './utils/smoothing';
import { driveProcessorSource } from './worklets/drive-processor';
import { noiseGateProcessorSource } from './worklets/noise-gate-processor';

type EffectNode =
  | NoiseGateEffect
  | CompressorEffect
  | DriveEffect
  | EQEffect
  | DelayEffect
  | ReverbEffect;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
  private rebuildQueue: Promise<void> = Promise.resolve();
  private outputLevel = 0.9;
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

  async start(pedals: PedalState[], deviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 오디오 입력을 지원하지 않습니다.');
    }

    await this.stop();

    this.context = new AudioContext({ latencyHint: 'interactive' });
    await this.loadWorklets();

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
      video: false,
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
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
    await this.rebuildChain(pedals);
  }

  async stop(closeContext = true): Promise<void> {
    if (this.masterGain && this.context && this.context.state !== 'closed') {
      rampParam(this.masterGain.gain, 0, this.context, 0.02);
      await wait(24);
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.inputGain?.disconnect();
    this.chainInput?.disconnect();
    this.masterGain?.disconnect();
    this.inputMeter?.disconnect();
    this.outputMeter?.disconnect();
    this.tuner?.disconnect();
    this.effects.forEach((effect) => effect.dispose());
    this.effects.clear();

    if (closeContext && this.context && this.context.state !== 'closed') {
      await this.context.close();
    }

    this.stream = null;
    this.source = null;
    this.inputGain = null;
    this.chainInput = null;
    this.masterGain = null;
    this.inputMeter = null;
    this.outputMeter = null;
    this.tuner = null;

    if (closeContext) {
      this.context = null;
      this.workletsLoaded = false;
      this.workletUrls.forEach((url) => URL.revokeObjectURL(url));
      this.workletUrls = [];
    }
  }

  rebuildChain(pedals: PedalState[]): Promise<void> {
    this.rebuildQueue = this.rebuildQueue
      .catch(() => undefined)
      .then(() => this.rebuildNow(pedals));
    return this.rebuildQueue;
  }

  updatePedal(pedal: PedalState): void {
    this.effects.get(pedal.id)?.update(pedal);
  }

  setOutputLevel(value: number): void {
    this.outputLevel = value;
    if (this.masterGain && this.context) {
      rampParam(this.masterGain.gain, value, this.context, 0.02);
    }
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

    rampParam(this.masterGain.gain, 0, this.context, 0.02);
    await wait(24);

    this.chainInput.disconnect();
    this.effects.forEach((effect) => effect.dispose());
    this.effects.clear();

    let previous: AudioNode = this.chainInput;

    pedals.forEach((pedal) => {
      const effect = this.createEffect(pedal);
      previous.connect(effect.input);
      previous = effect.output;
      this.effects.set(pedal.id, effect);
    });

    previous.connect(this.masterGain);
    rampParam(this.masterGain.gain, this.outputLevel, this.context, 0.02);
  }

  private createEffect(pedal: PedalState): EffectNode {
    if (!this.context) {
      throw new Error('AudioContext가 아직 준비되지 않았습니다.');
    }

    switch (pedal.type) {
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
        throw new Error(`알 수 없는 이펙터 타입입니다: ${pedal.type satisfies never}`);
    }
  }
}
