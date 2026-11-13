import { CompressorEffect } from './nodes/CompressorEffect';
import { AutoWahEffect } from './nodes/AutoWahEffect';
import { CabEffect } from './nodes/CabEffect';
import { ChorusEffect } from './nodes/ChorusEffect';
import { CrunchEffect } from './nodes/CrunchEffect';
import { DelayEffect } from './nodes/DelayEffect';
import { DriveEffect } from './nodes/DriveEffect';
import { EQEffect } from './nodes/EQEffect';
import { FlangerEffect } from './nodes/FlangerEffect';
import { FuzzEffect } from './nodes/FuzzEffect';
import { GraphicEQEffect } from './nodes/GraphicEQEffect';
import { MeterNode } from './nodes/MeterNode';
import { NoiseGateEffect } from './nodes/NoiseGateEffect';
import { PhaserEffect } from './nodes/PhaserEffect';
import { ReverbEffect } from './nodes/ReverbEffect';
import { TremoloEffect } from './nodes/TremoloEffect';
import { TunerNode } from './nodes/TunerNode';
import type {
  CrunchParams,
  DriveParams,
  EffectNodeWrapper,
  FuzzParams,
  LatencyReading,
  LevelReading,
  PedalState,
  PitchReading,
  TuningPresetId,
} from './types';
import { clamp, dbToGain } from './utils/db';
import { MAX_CAB_IR_BYTES, validateCabinetWav, validateDecodedCabinetIr } from './utils/cabinetIr';
import { ImpulseCache } from './utils/impulseCache';
import { rampParam } from './utils/smoothing';
import { noiseGateProcessorSource } from './worklets/noise-gate-processor';
import { envelopeFollowerProcessorSource } from './worklets/envelope-follower-processor';
import { tunerProcessorSource } from './worklets/tuner-processor';
import { howlGuardProcessorSource } from './worklets/howl-guard-processor';
import { flangerProcessorSource } from './worklets/flanger-processor';
import { phaserProcessorSource } from './worklets/phaser-processor';
import { compressorProcessorSource } from './worklets/compressor-processor';
import { peakLimiterProcessorSource } from './worklets/peak-limiter-processor';

type EffectNode = EffectNodeWrapper;

interface ChainConnection {
  from: AudioNode;
  to: AudioNode;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const CHAIN_FADE_SECONDS = 0.008;
const CHAIN_RECONNECT_WAIT_MS = 12;

export class AudioEngine {
  private static instance: AudioEngine | null = null;

  private context: AudioContext | null = null;
  private outputDeviceId = '';
  private stream: MediaStream | null = null;
  private inputEndedHandler: (() => void) | null = null;
  private inputEndedCleanup: (() => void) | null = null;
  private source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private audioFileUrl: string | null = null;
  private inputGain: GainNode | null = null;
  private chainInput: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private limiter: AudioWorkletNode | null = null;
  private howlGuard: AudioWorkletNode | null = null;
  private inputSplitter: ChannelSplitterNode | null = null;
  private inputChannelMode: '1' | '2' | 'stereo' = '1';
  private howlProtectionEnabled = true;
  private howlHandler: (() => void) | null = null;
  private recorderDestination: MediaStreamAudioDestinationNode | null = null;
  private inputMeter: MeterNode | null = null;
  private outputMeter: MeterNode | null = null;
  private tuner: TunerNode | null = null;
  private tunerActive = false;
  private tunerConnected = false;
  private tuningPreset: TuningPresetId = 'standard';
  private tuningReferenceHz = 440;
  private effects = new Map<string, EffectNode>();
  private cabImpulses = new Map<string, { name: string; buffer: AudioBuffer }>();
  private cabIrRequests = new Map<string, number>();
  private chainConnections = new Map<string, ChainConnection>();
  private reverbImpulseCache: ImpulseCache | null = null;
  private getPedals: () => PedalState[] = () => [];
  private rebuildQueue: Promise<void> = Promise.resolve();
  private graphGeneration = 0;
  private sessionGeneration = 0;
  private inputGainDb = 0;
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

  setHowlHandler(handler: (() => void) | null): void { this.howlHandler = handler; }

  setInputEndedHandler(handler: (() => void) | null): void { this.inputEndedHandler = handler; }

  private watchInputEnd(stream: MediaStream, generation: number): void {
    this.inputEndedCleanup?.();
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    let fired = false;
    const onEnded = () => {
      if (fired || this.stream !== stream || this.sessionGeneration !== generation) return;
      fired = true;
      this.inputEndedHandler?.();
    };
    track.addEventListener('ended', onEnded);
    this.inputEndedCleanup = () => track.removeEventListener('ended', onEnded);
  }

  setHowlProtection(enabled: boolean): void {
    this.howlProtectionEnabled = enabled;
    this.howlGuard?.port.postMessage({ enabled: enabled && !!this.stream });
  }

  setInputChannelMode(mode: '1' | '2' | 'stereo'): void {
    this.inputChannelMode = mode;
    if (this.inputSplitter && this.source && this.inputGain) this.connectInput(this.source);
  }

  setPedalsProvider(provider: () => PedalState[]): void {
    this.getPedals = provider;
  }

  get isRunning(): boolean {
    return !!this.context && this.context.state !== 'closed' && (!!this.stream || !!this.audioElement);
  }

  setPlaybackEndedHandler(handler: (() => void) | null): void {
    this.playbackEndedHandler = handler;
  }

  get supportsOutputSelection(): boolean {
    return typeof AudioContext !== 'undefined' && typeof (AudioContext.prototype as AudioContext & { setSinkId?: unknown }).setSinkId === 'function';
  }

  async listOutputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput');
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    if (!this.supportsOutputSelection) throw new Error('이 브라우저는 출력 장치 선택을 지원하지 않습니다.');
    if (this.context) {
      const context = this.context as AudioContext & { setSinkId: (id: string) => Promise<void> };
      await context.setSinkId(deviceId);
    }
    this.outputDeviceId = deviceId;
  }

  private async applyOutputDevice(context: AudioContext): Promise<void> {
    if (!this.outputDeviceId) return;
    const sinkContext = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!sinkContext.setSinkId) throw new Error('이 브라우저는 출력 장치 선택을 지원하지 않습니다.');
    try { await sinkContext.setSinkId(this.outputDeviceId); }
    catch { throw new Error('선택한 출력 장치에 연결할 수 없습니다. 출력 장치를 다시 선택해 주세요.'); }
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
    const generation = ++this.sessionGeneration;
    const context = new AudioContext({ latencyHint: 'interactive' });
    let stream: MediaStream | null = null;
    this.context = context;

    try {
      await this.applyOutputDevice(context);
      this.assertCurrentSession(context, generation);
      await this.loadWorklets();
      this.assertCurrentSession(context, generation);

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
        },
        video: false,
      });
      this.assertCurrentSession(context, generation);

      this.stream = stream;
      this.watchInputEnd(stream, generation);
      this.source = context.createMediaStreamSource(stream);
      this.createProcessingGraph(this.source);

      await context.resume();
      this.assertCurrentSession(context, generation);
      if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
        throw new Error('입력 장치 연결이 끊어졌습니다. 장치를 다시 연결해 주세요.');
      }
    } catch (error) {
      if (stream && stream !== this.stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      this.cleanupFailedSession(context, generation);
      throw error;
    }
  }

  async startFile(file: File): Promise<void> {
    if (file.type && !file.type.startsWith('audio/')) {
      throw new Error('오디오 파일만 업로드할 수 있습니다.');
    }

    this.dispose();
    const generation = ++this.sessionGeneration;
    const context = new AudioContext({ latencyHint: 'interactive' });
    let audioFileUrl: string | null = null;
    let audioElement: HTMLAudioElement | null = null;
    this.context = context;

    try {
      await this.applyOutputDevice(context);
      this.assertCurrentSession(context, generation);
      await this.loadWorklets();
      this.assertCurrentSession(context, generation);

      audioFileUrl = URL.createObjectURL(file);
      audioElement = new Audio(audioFileUrl);
      audioElement.preload = 'auto';
      audioElement.loop = true;
      audioElement.addEventListener('ended', () => {
        this.playbackEndedHandler?.();
      });
      this.assertCurrentSession(context, generation);

      this.audioFileUrl = audioFileUrl;
      this.audioElement = audioElement;
      this.source = context.createMediaElementSource(audioElement);
      this.createProcessingGraph(this.source);

      await context.resume();
      this.assertCurrentSession(context, generation);
      this.rebuildChain();
      await audioElement.play();
      this.assertCurrentSession(context, generation);
    } catch (error) {
      if (audioElement && audioElement !== this.audioElement) {
        audioElement.pause();
      }
      if (audioFileUrl && audioFileUrl !== this.audioFileUrl) {
        URL.revokeObjectURL(audioFileUrl);
      }
      this.cleanupFailedSession(context, generation);
      throw error;
    }
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
    this.rebuildChain();
  }

  createEffect(pedal: PedalState): EffectNodeWrapper {
    if (!this.context) {
      throw new Error('AudioContext가 아직 준비되지 않았습니다.');
    }

    switch (pedal.type) {
      case 'noiseGate':
        return new NoiseGateEffect(this.context, pedal);
      case 'compressor':
        return new CompressorEffect(this.context, pedal);
      case 'autoWah':
        return new AutoWahEffect(this.context, pedal);
      case 'drive':
        return new DriveEffect(this.context, pedal);
      case 'crunch':
        return new CrunchEffect(this.context, pedal);
      case 'fuzz':
        return new FuzzEffect(this.context, pedal);
      case 'graphicEQ':
        return new GraphicEQEffect(this.context, pedal);
      case 'eq':
        return new EQEffect(this.context, pedal);
      case 'cab': {
        const effect = new CabEffect(this.context, pedal);
        const custom = this.cabImpulses.get(pedal.id);
        if (custom) effect.setCustomImpulse(custom.buffer);
        return effect;
      }
      case 'chorus':
        return new ChorusEffect(this.context, pedal);
      case 'flanger':
        return new FlangerEffect(this.context, pedal);
      case 'phaser':
        return new PhaserEffect(this.context, pedal);
      case 'tremolo':
        return new TremoloEffect(this.context, pedal);
      case 'delay':
        return new DelayEffect(this.context, pedal);
      case 'reverb':
        return new ReverbEffect(this.context, pedal, this.getReverbImpulseCache());
      default:
        throw new Error(`알 수 없는 이펙터 타입입니다: ${pedal.type satisfies never}`);
    }
  }

  rebuildChain(): void {
    const generation = this.graphGeneration;
    this.rebuildQueue = this.rebuildQueue
      .catch(() => undefined)
      .then(() => this.rebuildNow(this.getPedals(), generation));
  }

  setPedalParam(
    pedalId: string,
    _paramName: string,
    _value: number | string | boolean,
  ): void {
    const pedal = this.getPedals().find((candidate) => candidate.id === pedalId);
    if (!pedal) return;
    if (pedal.type === 'cab' && _paramName === 'model') this.clearCabinetIr(pedalId);
    this.effects.get(pedalId)?.update(pedal);
  }

  getCabinetIrName(pedalId: string): string | null {
    return this.cabImpulses.get(pedalId)?.name ?? null;
  }

  async loadCabinetIr(pedalId: string, file: File): Promise<void> {
    const context = this.context;
    const generation = this.sessionGeneration;
    if (!context || context.state === 'closed') throw new Error('먼저 오디오를 시작해 주세요.');
    if (!/\.wav$/i.test(file.name) || file.size > MAX_CAB_IR_BYTES) {
      throw new Error('IR 파일은 4 MB 이하의 WAV 파일이어야 합니다.');
    }
    const requestId = (this.cabIrRequests.get(pedalId) ?? 0) + 1;
    this.cabIrRequests.set(pedalId, requestId);
    const bytes = await file.arrayBuffer();
    validateCabinetWav(bytes);
    let buffer: AudioBuffer;
    try { buffer = await context.decodeAudioData(bytes); }
    catch { throw new Error('WAV IR 파일을 읽지 못했습니다.'); }
    validateDecodedCabinetIr(buffer);
    this.assertCurrentSession(context, generation);
    if (this.cabIrRequests.get(pedalId) !== requestId) throw new Error('IR 적용이 취소되었습니다.');
    const effect = this.effects.get(pedalId);
    if (!(effect instanceof CabEffect)) throw new Error('캐비닛 페달을 찾을 수 없습니다.');
    effect.setCustomImpulse(buffer);
    this.cabImpulses.set(pedalId, { name: file.name, buffer });
    // A queued chain rebuild may already have captured the old IR.
    this.rebuildChain();
    window.dispatchEvent(new Event('cab-ir-change'));
  }

  clearCabinetIr(pedalId: string): void {
    this.cabIrRequests.set(pedalId, (this.cabIrRequests.get(pedalId) ?? 0) + 1);
    if (!this.cabImpulses.delete(pedalId)) return;
    const effect = this.effects.get(pedalId);
    if (effect instanceof CabEffect) effect.setCustomImpulse(null);
    this.rebuildChain();
    window.dispatchEvent(new Event('cab-ir-change'));
  }

  /** Restore built-in IRs when loading a complete preset or comparison snapshot. */
  clearAllCabinetIrs(): void {
    this.cabIrRequests.forEach((requestId, pedalId) => this.cabIrRequests.set(pedalId, requestId + 1));
    if (this.cabImpulses.size === 0) return;
    this.cabImpulses.forEach((_impulse, pedalId) => {
      const effect = this.effects.get(pedalId);
      if (effect instanceof CabEffect) effect.setCustomImpulse(null);
    });
    this.cabImpulses.clear();
    window.dispatchEvent(new Event('cab-ir-change'));
  }

  setPedalBypass(pedalId: string, _bypassed: boolean): void {
    const pedal = this.getPedals().find((candidate) => candidate.id === pedalId);
    if (!pedal) return;
    this.effects.get(pedalId)?.update(pedal);
  }

  setPedalEnabled(pedalId: string, enabled: boolean): void {
    this.effects.get(pedalId)?.setEnabled(enabled);
  }

  getCompressorReduction(pedalId: string): number | null {
    const effect = this.effects.get(pedalId);
    return effect instanceof CompressorEffect ? effect.getGainReduction() : null;
  }

  setInputGain(db: number): void {
    this.inputGainDb = clamp(db, -24, 24);
    if (this.inputGain && this.context) {
      rampParam(this.inputGain.gain, dbToGain(this.inputGainDb), this.context, 0.02);
    }
  }

  setMasterVolume(value: number): void {
    this.masterVolume = clamp(value, 0, 1);
    if (this.masterGain && this.context) {
      rampParam(this.masterGain.gain, this.masterVolume, this.context, 0.02);
    }
  }

  createRecorderStream(): MediaStream {
    if (!this.context || this.context.state === 'closed' || !this.masterGain) {
      throw new Error('녹음할 마스터 출력이 준비되지 않았습니다.');
    }

    if (!this.recorderDestination) {
      this.recorderDestination = this.context.createMediaStreamDestination();
      this.limiter?.connect(this.recorderDestination);
    }

    return this.recorderDestination.stream;
  }

  disposeRecorderStream(): void {
    const destination = this.recorderDestination;
    if (!destination) return;
    this.recorderDestination = null;

    try {
      this.limiter?.disconnect(destination);
    } catch {
      // The master may already have been disconnected by panic cleanup.
    }
    destination.stream.getTracks().forEach((track) => track.stop());
    destination.disconnect();
  }

  setTunerActive(active: boolean): void {
    this.tunerActive = active;
    this.syncTunerConnection();
  }

  setTuningPreset(preset: TuningPresetId): void {
    this.tuningPreset = preset;
    this.tuner?.setTuningPreset(preset);
  }

  setTuningReferenceHz(referenceHz: number): void {
    if (!Number.isFinite(referenceHz)) return;
    this.tuningReferenceHz = Math.min(480, Math.max(400, referenceHz));
    this.tuner?.setReferenceHz(this.tuningReferenceHz);
  }

  estimateChainGain(): number {
    let linearGain = 1;

    this.getPedals().forEach((pedal) => {
      if (!pedal.enabled || pedal.bypassed) return;

      if (pedal.type === 'drive') {
        const amount = clamp((pedal.params as DriveParams).drive, 0, 100) / 100;
        linearGain *= 1 + amount * 1.6;
      } else if (pedal.type === 'crunch') {
        const amount = clamp((pedal.params as CrunchParams).gain, 0, 100) / 100;
        linearGain *= 1 + amount * 2.1;
      } else if (pedal.type === 'fuzz') {
        const amount = clamp((pedal.params as FuzzParams).fuzz, 0, 100) / 100;
        linearGain *= 1 + amount * 3.4;
      }
    });

    return 20 * Math.log10(Math.max(1, linearGain));
  }

  panic(): void {
    this.graphGeneration += 1;

    if (this.masterGain && this.context && this.context.state !== 'closed') {
      this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
      this.masterGain.gain.setValueAtTime(0, this.context.currentTime);
    }

    // Stop capture immediately, but leave the recorder graph alive until its final data event.
    this.inputEndedCleanup?.();
    this.inputEndedCleanup = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioElement?.pause();
  }

  dispose(): void {
    this.sessionGeneration += 1;
    this.graphGeneration += 1;
    this.panicDisconnect();
    this.reverbImpulseCache?.dispose();
    this.reverbImpulseCache = null;

    this.inputEndedCleanup?.();
    this.inputEndedCleanup = null;
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
    this.limiter = null;
    this.howlGuard = null;
    this.inputSplitter = null;
    this.recorderDestination = null;
    this.inputMeter = null;
    this.outputMeter = null;
    this.tuner = null;
    this.effects.clear();
    this.cabImpulses.clear();
    this.cabIrRequests.clear();
    window.dispatchEvent(new Event('cab-ir-change'));
    this.workletsLoaded = false;
    this.workletUrls.forEach((url) => URL.revokeObjectURL(url));
    this.workletUrls = [];
  }

  async start(deviceId?: string): Promise<void> {
    await this.init(deviceId);
    this.rebuildChain();
  }

  async stop(): Promise<void> {
    if (this.masterGain && this.context && this.context.state !== 'closed') {
      rampParam(this.masterGain.gain, 0, this.context, 0.02);
      await wait(24);
    }

    this.dispose();
  }

  updatePedal(pedal: PedalState): void {
    this.effects.get(pedal.id)?.update(pedal);
  }

  readInputLevel(): LevelReading {
    return this.inputMeter?.read() ?? {
      db: -120,
      linear: 0,
      peakDb: -120,
      peakLinear: 0,
      isClipping: false,
      clipHoldUntil: 0,
    };
  }

  readOutputLevel(): LevelReading {
    return this.outputMeter?.read() ?? {
      db: -120,
      linear: 0,
      peakDb: -120,
      peakLinear: 0,
      isClipping: false,
      clipHoldUntil: 0,
    };
  }

  readAudioGlitchCount(): number | null {
    if (!this.context || this.context.state === 'closed') return null;
    try {
      const stats = (this.context as AudioContext & { playbackStats?: { underrunEvents?: unknown } }).playbackStats;
      const count = stats?.underrunEvents;
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
    } catch { return null; }
  }

  readLatency(): LatencyReading {
    if (!this.context || this.context.state === 'closed') {
      return { base: null, output: null, input: null, sampleRate: 0 };
    }
    const validMs = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value * 1000 : null;
    let input: number | null = null;
    try { input = validMs((this.stream?.getAudioTracks?.()[0]?.getSettings?.() as (MediaTrackSettings & { latency?: number }) | undefined)?.latency); } catch { /* device does not expose latency */ }
    return {
      base: validMs(this.context.baseLatency),
      output: validMs(this.context.outputLatency),
      input,
      sampleRate: this.context.sampleRate,
    };
  }

  readInputWaveform(): number[] {
    return this.inputMeter?.readWaveform() ?? [];
  }

  readOutputWaveform(): number[] {
    return this.outputMeter?.readWaveform() ?? [];
  }

  readPitch(): PitchReading {
    if (!this.tunerActive) {
      return { frequency: null, note: null, cents: 0 };
    }
    return this.tuner?.readPitch() ?? { frequency: null, note: null, cents: 0 };
  }

  private async loadWorklets(): Promise<void> {
    const context = this.context;
    if (!context || this.workletsLoaded) return;

    const moduleUrls = [
      this.createWorkletUrl(noiseGateProcessorSource),
      this.createWorkletUrl(envelopeFollowerProcessorSource),
      this.createWorkletUrl(tunerProcessorSource),
      this.createWorkletUrl(howlGuardProcessorSource),
      this.createWorkletUrl(flangerProcessorSource),
      this.createWorkletUrl(phaserProcessorSource),
      this.createWorkletUrl(compressorProcessorSource),
      this.createWorkletUrl(peakLimiterProcessorSource),
    ];

    await Promise.all(moduleUrls.map((url) => context.audioWorklet.addModule(url)));
    if (context === this.context && context.state !== 'closed') {
      this.workletsLoaded = true;
    }
  }

  private assertCurrentSession(context: AudioContext, generation: number): void {
    if (
      generation !== this.sessionGeneration ||
      context !== this.context ||
      context.state === 'closed'
    ) {
      throw new DOMException('오디오 시작 요청이 취소되었습니다.', 'AbortError');
    }
  }

  private cleanupFailedSession(context: AudioContext, generation: number): void {
    if (generation === this.sessionGeneration && context === this.context) {
      this.dispose();
      return;
    }

    if (context.state !== 'closed') {
      void context.close();
    }
  }

  private createWorkletUrl(source: string): string {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    this.workletUrls.push(url);
    return url;
  }

  private getReverbImpulseCache(): ImpulseCache {
    if (!this.context) {
      throw new Error('AudioContext가 아직 준비되지 않았습니다.');
    }

    if (!this.reverbImpulseCache) {
      this.reverbImpulseCache = new ImpulseCache(this.context);
    }

    return this.reverbImpulseCache;
  }

  private createProcessingGraph(source: AudioNode): void {
    if (!this.context) return;

    this.graphGeneration += 1;
    this.chainConnections.clear();

    this.inputGain = this.context.createGain();
    this.chainInput = this.context.createGain();
    this.masterGain = this.context.createGain();
    this.limiter = new AudioWorkletNode(this.context, 'peak-limiter-processor', { outputChannelCount: [2] });
    this.howlGuard = new AudioWorkletNode(this.context, 'howl-guard', { outputChannelCount: [2] });
    this.howlGuard.port.onmessage = (event) => {
      if (event.data?.type === 'howl') this.howlHandler?.();
    };
    this.howlGuard.port.postMessage({ enabled: this.howlProtectionEnabled && !!this.stream });
    this.inputMeter = new MeterNode(this.context);
    this.outputMeter = new MeterNode(this.context);
    this.tuner = new TunerNode(this.context, this.tuningPreset);
    this.tuner.setReferenceHz(this.tuningReferenceHz);
    this.tunerConnected = false;

    rampParam(this.inputGain.gain, dbToGain(this.inputGainDb), this.context, 0.02);
    this.masterGain.gain.value = 0;

    this.connectInput(source);
    this.inputGain.connect(this.inputMeter.input);
    this.inputGain.connect(this.chainInput);
    this.masterGain.connect(this.howlGuard);
    this.howlGuard.connect(this.limiter);
    this.limiter.connect(this.outputMeter.input);
    this.limiter.connect(this.context.destination);
    this.syncTunerConnection();
  }

  private connectInput(source: AudioNode): void {
    if (!this.context || !this.inputGain) return;
    source.disconnect();
    this.inputSplitter?.disconnect();
    this.inputSplitter = null;
    if (!this.stream || this.inputChannelMode === 'stereo') {
      source.connect(this.inputGain);
      return;
    }
    this.inputSplitter = this.context.createChannelSplitter(2);
    source.connect(this.inputSplitter);
    // An individual output of a splitter is mono; Web Audio duplicates it to stereo downstream.
    this.inputSplitter.connect(this.inputGain, this.inputChannelMode === '1' ? 0 : 1);
  }

  private syncTunerConnection(): void {
    const inputGain = this.inputGain;
    const tuner = this.tuner;

    if (!inputGain || !tuner) {
      this.tunerConnected = false;
      return;
    }

    if (this.tunerActive) {
      if (!this.tunerConnected) {
        inputGain.connect(tuner.input);
        this.tunerConnected = true;
      }
      tuner.setActive(true);
      return;
    }

    tuner.setActive(false);
    if (this.tunerConnected) {
      inputGain.disconnect(tuner.input);
      this.tunerConnected = false;
    }
  }

  private async rebuildNow(pedals: PedalState[], generation: number): Promise<void> {
    const context = this.context;
    const chainInput = this.chainInput;
    const masterGain = this.masterGain;

    if (
      !context ||
      !chainInput ||
      !masterGain ||
      generation !== this.graphGeneration
    ) {
      return;
    }

    const previousEffects = this.effects;
    const nextEffects = new Map<string, EffectNode>();
    const createdEffects: EffectNode[] = [];
    const retiredEffects = new Set<EffectNode>();
    let committed = false;

    try {
      pedals.forEach((pedal) => {
        const existing = previousEffects.get(pedal.id);

        if (existing?.type === pedal.type) {
          existing.update(pedal);
          nextEffects.set(pedal.id, existing);
          return;
        }

        const effect = this.createEffect(pedal);
        createdEffects.push(effect);
        nextEffects.set(pedal.id, effect);
        if (existing) retiredEffects.add(existing);
      });

      previousEffects.forEach((effect, id) => {
        if (!nextEffects.has(id)) retiredEffects.add(effect);
      });

      const desiredConnections = this.buildChainConnections(
        pedals,
        nextEffects,
        chainInput,
        masterGain,
      );
      const removedConnections: ChainConnection[] = [];
      const addedConnections: ChainConnection[] = [];

      this.chainConnections.forEach((connection, key) => {
        const desired = desiredConnections.get(key);
        if (
          !desired ||
          desired.from !== connection.from ||
          desired.to !== connection.to
        ) {
          removedConnections.push(connection);
        }
      });

      desiredConnections.forEach((connection, key) => {
        const current = this.chainConnections.get(key);
        if (
          !current ||
          current.from !== connection.from ||
          current.to !== connection.to
        ) {
          addedConnections.push(connection);
        }
      });

      if (removedConnections.length === 0 && addedConnections.length === 0) {
        this.effects = nextEffects;
        return;
      }

      rampParam(masterGain.gain, 0, context, CHAIN_FADE_SECONDS);
      await wait(CHAIN_RECONNECT_WAIT_MS);

      if (!this.isCurrentGraph(context, chainInput, masterGain, generation)) {
        createdEffects.forEach((effect) => effect.dispose());
        return;
      }

      removedConnections.forEach(({ from, to }) => from.disconnect(to));
      addedConnections.forEach(({ from, to }) => from.connect(to));

      this.chainConnections = desiredConnections;
      this.effects = nextEffects;
      committed = true;
      retiredEffects.forEach((effect) => effect.dispose());

      rampParam(masterGain.gain, this.masterVolume, context, CHAIN_FADE_SECONDS);
    } catch (error) {
      if (!committed) {
        createdEffects.forEach((effect) => effect.dispose());
      }

      if (generation === this.graphGeneration) {
        this.graphGeneration += 1;
        this.panicDisconnect();
      }
      throw error;
    }
  }

  private buildChainConnections(
    pedals: PedalState[],
    effects: Map<string, EffectNode>,
    chainInput: AudioNode,
    masterGain: AudioNode,
  ): Map<string, ChainConnection> {
    const connections = new Map<string, ChainConnection>();
    let previousId = 'chain-input';
    let previousOutput = chainInput;

    pedals.forEach((pedal) => {
      const effect = effects.get(pedal.id);
      if (!effect) return;

      const effectId = `effect:${pedal.id}`;
      connections.set(`${previousId}->${effectId}`, {
        from: previousOutput,
        to: effect.input,
      });
      previousId = effectId;
      previousOutput = effect.output;
    });

    connections.set(`${previousId}->master-output`, {
      from: previousOutput,
      to: masterGain,
    });
    return connections;
  }

  private isCurrentGraph(
    context: AudioContext,
    chainInput: AudioNode,
    masterGain: AudioNode,
    generation: number,
  ): boolean {
    return (
      generation === this.graphGeneration &&
      context === this.context &&
      chainInput === this.chainInput &&
      masterGain === this.masterGain &&
      context.state !== 'closed'
    );
  }

  private panicDisconnect(): void {
    this.tuner?.setActive(false);
    this.tunerConnected = false;
    this.source?.disconnect();
    this.inputSplitter?.disconnect();
    this.howlGuard?.disconnect();
    this.limiter?.disconnect();
    this.inputGain?.disconnect();
    this.chainInput?.disconnect();
    this.masterGain?.disconnect();
    this.disposeRecorderStream();
    this.inputMeter?.disconnect();
    this.outputMeter?.disconnect();
    this.tuner?.dispose();
    this.tuner = null;
    this.effects.forEach((effect) => effect.dispose());
    this.effects.clear();
    this.chainConnections.clear();
  }
}
