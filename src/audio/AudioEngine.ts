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
  PedalState,
  PitchReading,
  TuningPresetId,
} from './types';
import type { ChannelDecision } from './engine/channelDecision';
import { WorkletLoadError } from './engine/errors';
import type { GuardMode } from './engine/guardSpec';
import { InputStage, type InputChannelMode } from './engine/InputStage';
import { createLevelMeter, createOutputGuard, GUARD_ANALYSIS_INPUT } from './engine/monitorNodes';
import { OutputStage } from './engine/OutputStage';
import { MonitorService, type MonitorSink } from './monitor/MonitorService';
import { clampTrimDb, PRESET_TRIM_RAMP_SECONDS } from './offline/loudnessSpec';
import { clamp, dbToGain } from './utils/db';
import { MAX_CAB_IR_BYTES, validateCabinetWav, validateDecodedCabinetIr } from './utils/cabinetIr';
import { ImpulseCache } from './utils/impulseCache';
import { rampParam } from './utils/smoothing';
import { noiseGateProcessorSource } from './worklets/noise-gate-processor';
import { envelopeFollowerProcessorSource } from './worklets/envelope-follower-processor';
import { tunerProcessorSource } from './worklets/tuner-processor';
import { flangerProcessorSource } from './worklets/flanger-processor';
import { phaserProcessorSource } from './worklets/phaser-processor';
import { compressorProcessorSource } from './worklets/compressor-processor';
import { levelMeterWorkletUrl, limiterWorkletUrl, outputGuardWorkletUrl } from './worklets/urls';

type EffectNode = EffectNodeWrapper;

interface ChainConnection {
  from: AudioNode;
  to: AudioNode;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
/** 화면 저장소가 연결되기 전(또는 시험)에는 측정값을 버린다. audioStore 가 시작할 때 `setMonitorSink` 로 진짜 저장소를 건다. */
const NOOP_MONITOR_SINK: MonitorSink = {
  setInput: () => undefined,
  setOutput: () => undefined,
  setLimiterGr: () => undefined,
  setGuard: () => undefined,
  reset: () => undefined,
};
const CHAIN_FADE_SECONDS = 0.008;
const CHAIN_RECONNECT_WAIT_MS = 12;
/** 정지할 때 출력 이득을 0 으로 낮추는 시정수(초). 10 ms 면 약 −29 dB, 20 ms 면 약 −58 dB. */
const SILENCE_TIME_CONSTANT_SECONDS = 0.003;
/** 램프가 끝나도록 컨텍스트를 닫기 전에 기다리는 시간(ms). */
const SILENCE_SETTLE_MS = 24;

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
  /** 마스터 게인 → 출력 가드 → 리미터 → level-meter#out. 스피커·파형 분석·녹음은 이 단계의 출력에서 갈라진다. */
  private outputStage: OutputStage | null = null;
  /** 하울링 판정과 안전 무음(S1.5). 입력 0 = 프로그램, 입력 1 = 분석 전용(장치 모드만). */
  private outputGuard: AudioWorkletNode | null = null;
  /** level-meter#in(소스 바로 뒤)·#out(리미터 바로 뒤). 측정은 화면과 무관하게 오디오 스레드가 한다. */
  private inputTap: AudioWorkletNode | null = null;
  private outputTap: AudioWorkletNode | null = null;
  private monitor = new MonitorService(NOOP_MONITOR_SINK);
  private inputStage: InputStage | null = null;
  private inputChannelMode: InputChannelMode = 'auto';
  private rememberedChannelDecision: ChannelDecision | null = null;
  private inputDecisionHandler: ((decision: ChannelDecision) => void) | null = null;
  private howlProtectionEnabled = true;
  private howlHandler: ((freqHz: number) => void) | null = null;
  private recorderDestination: MediaStreamAudioDestinationNode | null = null;
  /** 파형 표시 전용 분석 노드. 레벨·클리핑은 level-meter 워클릿이 잰다. */
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
  /** 지금 프리셋의 음량 보정(dB)을 읽는 함수. 그래프를 새로 만들 때 처음 값으로 쓴다. */
  private getPresetTrimDb: () => number = () => 0;
  private rebuildQueue: Promise<void> = Promise.resolve();
  private graphGeneration = 0;
  private sessionGeneration = 0;
  private inputGainDb = 0;
  private masterVolume = 0.9;
  private workletsLoaded = false;
  private workletUrls: string[] = [];
  private playbackEndedHandler: (() => void) | null = null;
  private closePending: Promise<void> = Promise.resolve();

  /** 출력 단계의 마스터 게인. 사용자가 움직이는 마스터 볼륨이 여기에 걸린다. */
  private get masterGain(): GainNode | null {
    return this.outputStage?.input ?? null;
  }

  /** 체인 끝이 들어가는 프리셋 음량 보정 노드. 마스터 게인 바로 앞에 있다. */
  private get presetTrimNode(): GainNode | null {
    return this.outputStage?.presetTrim ?? null;
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  /** 출력 가드가 하울링 차단을 마쳤을 때 부른다. 인자는 감지한 주파수(Hz). 정지 절차는 부른 쪽이 시작한다. */
  setHowlHandler(handler: ((freqHz: number) => void) | null): void { this.howlHandler = handler; }

  /** 레벨·가드 상태를 내보낼 곳(화면 저장소). 세션 밖에서 한 번 건다. 다음 그래프부터 적용된다. */
  setMonitorSink(sink: MonitorSink | null): void {
    this.monitor.detach();
    this.monitor = new MonitorService(sink ?? NOOP_MONITOR_SINK);
  }

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
    this.applyGuardMode();
  }

  /** 지금 가드가 가져야 할 모드. 마이크 입력만 판정하고(device), 파일 재생(file)과 사용자가 끈 경우(off)는 판정하지 않는다. */
  private currentGuardMode(): GuardMode {
    return !this.stream ? 'file' : this.howlProtectionEnabled ? 'device' : 'off';
  }

  private applyGuardMode(): void {
    if (this.outputGuard) this.monitor.setGuardMode(this.currentGuardMode());
  }

  /** 입력 채널 모드(자동·1번·2번·스테레오). 연결 중이면 20 ms 램프로 바로 반영하고, 아니면 다음 연결에 쓴다. */
  setInputChannelMode(mode: InputChannelMode): void {
    this.inputChannelMode = mode;
    this.inputStage?.setMode(mode);
  }

  /** 다음 연결에서 자동 모드가 시작할 판정(지난 세션에서 이 장치에 내린 것). 판정은 이번 세션에서도 한 번 더 한다. */
  setRememberedChannelDecision(decision: ChannelDecision | null): void {
    this.rememberedChannelDecision = decision;
  }

  /** 자동 판정이 날 때 부른다(세션마다 한 번). */
  setInputDecisionHandler(handler: ((decision: ChannelDecision) => void) | null): void {
    this.inputDecisionHandler = handler;
  }

  /** 지금 연결된 입력 장치의 식별자·채널 수. 장치별 기억과 채널 메뉴 표시에 쓴다. 입력이 없으면(파일·미연결) null. */
  getInputInfo(): { deviceId: string; channelCount: number; selectable: boolean } | null {
    // 설정을 읽지 못하는 입력이어도 연결 자체는 계속 쓸 수 있어야 하므로, 읽기 실패는 '모름(null)'으로 돌려 준다.
    try {
      const track = this.stream?.getAudioTracks?.()[0];
      const settings = track?.getSettings?.();
      if (!track || !settings) return null;
      return {
        deviceId: settings.deviceId ?? '',
        channelCount: settings.channelCount ?? 2,
        selectable: this.inputStage?.selectable ?? false,
      };
    } catch {
      return null;
    }
  }

  setPedalsProvider(provider: () => PedalState[]): void {
    this.getPedals = provider;
  }

  /** 지금 프리셋의 음량 보정(dB)을 읽는 함수. 그래프를 만들 때 처음 값으로 쓴다. */
  setPresetTrimProvider(provider: () => number): void {
    this.getPresetTrimDb = provider;
  }

  /**
   * 프리셋 음량 보정을 바꾼다(GS-2). 프리셋을 바꿀 때 소리가 튀지 않도록 30 ms 램프로 옮긴다.
   * 오디오가 꺼져 있으면 할 일이 없다. 다음에 그래프를 만들 때 provider 값을 처음 값으로 쓴다.
   */
  setPresetTrimDb(db: number): void {
    const trim = this.presetTrimNode;
    const context = this.context;
    if (!trim || !context || context.state === 'closed') return;
    rampParam(trim.gain, dbToGain(clampTrimDb(db)), context, PRESET_TRIM_RAMP_SECONDS);
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
      // 보안 출처(https·localhost)가 아니면 브라우저가 mediaDevices 자체를 주지 않는다. 브라우저 탓이 아니라 주소 탓이다(설계서 4.13: SecurityError).
      if (globalThis.isSecureContext === false) {
        throw new DOMException('보안 출처가 아니어서 마이크를 쓸 수 없습니다.', 'SecurityError');
      }
      throw new Error('이 브라우저는 오디오 입력을 지원하지 않습니다.');
    }

    const generation = await this.beginSession();
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

    const generation = await this.beginSession();
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
      // 녹음도 스피커와 같은 리미터 출력을 받는다(화면의 소리·들리는 소리·파일이 같은 피크 제한을 지난다).
      this.outputStage?.output.connect(this.recorderDestination);
    }

    return this.recorderDestination.stream;
  }

  disposeRecorderStream(): void {
    const destination = this.recorderDestination;
    if (!destination) return;
    this.recorderDestination = null;

    try {
      this.outputStage?.output.disconnect(destination);
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

  /**
   * ① 출력을 약 10 ms 안에 무음으로 만들고 램프가 끝날 때까지 기다린다(AudioSession 정리 절차의 첫 단계).
   * 컨텍스트를 곧바로 닫으면 소리가 중간에서 끊겨 '딱' 소리가 날 수 있어 잠깐 기다린다.
   */
  async silenceOutput(): Promise<void> {
    const context = this.context;
    const master = this.masterGain;
    if (!context || context.state === 'closed' || !master) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(0, now, SILENCE_TIME_CONSTANT_SECONDS);
    await wait(SILENCE_SETTLE_MS);
  }

  /** ② 입력 스트림의 모든 트랙을 멈춘다. 마이크 표시등이 꺼진다. 녹음기는 출력 쪽을 기록하므로 영향이 없다. */
  stopInput(): void {
    this.inputEndedCleanup?.();
    this.inputEndedCleanup = null;
    this.stream?.getTracks().forEach((track) => track.stop());
  }

  /** ④ 파일 모드의 재생을 멈춘다. File 객체는 스토어가 갖고 있어 버려지지 않는다. */
  pausePlayback(): void {
    this.audioElement?.pause();
  }

  /** 아직 끝나지 않은 start/init 요청을 무효로 만든다. 늦게 돌아온 getUserMedia 결과는 버려진다. */
  invalidatePendingStart(): void {
    this.sessionGeneration += 1;
    this.graphGeneration += 1;
  }

  /** ⑦ 세대 번호를 올려 늦게 도착한 비동기 결과를 무시하게 한다. */
  advanceGeneration(): void {
    this.invalidatePendingStart();
  }

  /** ⑤ 워클릿 포트를 닫고 노드를 끊고 입력·파일 자원을 놓는다. AudioContext 는 closeContext() 가 닫는다. */
  releaseGraph(): void {
    this.graphGeneration += 1;
    this.panicDisconnect();
    this.monitor.detach();
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

    this.source = null;
    this.inputGain = null;
    this.chainInput = null;
    this.outputStage = null;
    this.outputGuard = null;
    this.inputTap = null;
    this.outputTap = null;
    this.inputStage = null;
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

  /**
   * ⑥ AudioContext 를 닫고 닫힐 때까지 기다린다. 이미 닫는 중인 것이 있으면 그것도 같이 기다려서,
   * 이 함수가 끝났을 때는 열려 있는 컨텍스트가 없다('컨텍스트는 한 번에 하나').
   */
  closeContext(): Promise<void> {
    const context = this.context;
    this.context = null;
    return context ? this.closeTracked(context) : this.closePending;
  }

  /** 닫는 중인 컨텍스트를 모두 추적한다. 취소된 시작이 만든 컨텍스트도 여기를 지난다. */
  private closeTracked(context: AudioContext): Promise<void> {
    if (context.state !== 'closed') {
      const closing = context.close().catch(() => undefined);
      this.closePending = Promise.all([this.closePending, closing]).then(() => undefined);
    }
    return this.closePending;
  }

  /**
   * 새 세션 요청을 등록한다. 번호를 먼저(동기로) 올리므로 이전 요청은 즉시 무효가 되고,
   * 이전 세션을 비우는 동안 정지가 불려도 이 요청이 취소된 것으로 드러난다.
   */
  private async beginSession(): Promise<number> {
    this.invalidatePendingStart();
    const generation = this.sessionGeneration;
    this.releaseGraph();
    await this.closeContext();
    if (generation !== this.sessionGeneration) {
      throw new DOMException('오디오 시작 요청이 취소되었습니다.', 'AbortError');
    }
    return generation;
  }

  /** 세션을 처음부터 비운다(시작 실패 정리). 정지는 AudioSession.stop 이 같은 단계를 순서대로 부른다. */
  async dispose(): Promise<void> {
    this.invalidatePendingStart();
    this.releaseGraph();
    await this.closeContext();
  }

  async start(deviceId?: string): Promise<void> {
    await this.init(deviceId);
    this.rebuildChain();
  }

  updatePedal(pedal: PedalState): void {
    this.effects.get(pedal.id)?.update(pedal);
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
      this.createWorkletUrl(flangerProcessorSource),
      this.createWorkletUrl(phaserProcessorSource),
      this.createWorkletUrl(compressorProcessorSource),
      // 리미터·레벨 미터·출력 가드는 별도 .worklet.ts 파일이다(설계서 4.1절 규칙 6). 빌드 때 해시 이름의 파일로 나가 서비스 워커가 프리캐시한다.
      limiterWorkletUrl,
      levelMeterWorkletUrl,
      outputGuardWorkletUrl,
    ];

    try {
      await Promise.all(moduleUrls.map((url) => context.audioWorklet.addModule(url)));
    } catch (error) {
      // 브라우저는 모듈을 못 불러온 것도 AbortError 로 알려서 장치 시작 실패와 구별되지 않는다. 안내가 다르므로(설계서 4.13) 이름을 붙여 던진다.
      throw new WorkletLoadError({ cause: error });
    }
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
      void this.dispose();
      return;
    }

    void this.closeTracked(context);
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
    const context = this.context;
    if (!context) return;

    this.graphGeneration += 1;
    this.chainConnections.clear();

    // 설계서 4.3절의 신호 흐름:
    //   소스 → level-meter#in → InputStage → inputGain(입력 트림) ─┬→ 체인 입력
    //                                                              ├→ 튜너(켤 때만)
    //                                                              └→ output-guard 입력 1(분석 전용, 장치 모드만)
    //   체인 → presetTrim → masterGain → output-guard 입력 0 → 리미터 → level-meter#out → [스피커, 녹음, 파형 분석]
    this.inputGain = context.createGain();
    this.chainInput = context.createGain();
    this.inputTap = createLevelMeter(context, 'in');
    this.outputTap = createLevelMeter(context, 'out');
    this.outputGuard = createOutputGuard(context, this.currentGuardMode());
    this.outputStage = new OutputStage(context, { guard: this.outputGuard, levelMeter: this.outputTap });
    // 프리셋 음량 보정의 처음 값은 지금 스토어 값이다. 램프 없이 바로 둔다(아직 소리가 흐르기 전이다).
    this.outputStage.presetTrim.gain.value = dbToGain(clampTrimDb(this.getPresetTrimDb()));
    this.inputMeter = new MeterNode(context);
    this.outputMeter = new MeterNode(context);
    this.tuner = new TunerNode(context, this.tuningPreset);
    this.tuner.setReferenceHz(this.tuningReferenceHz);
    this.tunerConnected = false;

    rampParam(this.inputGain.gain, dbToGain(this.inputGainDb), context, 0.02);
    this.outputStage.input.gain.value = 0;

    source.connect(this.inputTap);
    this.inputStage = this.createInputStage(this.inputTap);
    this.inputStage.output.connect(this.inputGain);
    this.inputGain.connect(this.inputMeter.input);
    this.inputGain.connect(this.chainInput);
    // 하울링 분석은 마이크 입력일 때만 한다. 파일 재생은 입력 1 을 잇지 않는다(가드도 file 모드로 판정을 끈다).
    if (this.stream) this.inputGain.connect(this.outputGuard, 0, GUARD_ANALYSIS_INPUT);
    // 마스터 게인 → 가드 → 리미터 → level-meter#out 은 OutputStage 가 이어 두었다. 스피커·파형 분석·녹음은 그 출력을 받는다.
    this.outputStage.output.connect(this.outputMeter.input);
    this.outputStage.output.connect(context.destination);

    this.monitor.attach(
      { inputTap: this.inputTap, outputTap: this.outputTap, guard: this.outputGuard, limiter: this.outputStage.limiter },
      {
        onInputLevels: (rmsDb, timeSeconds) => this.inputStage?.onChannelLevels(rmsDb, timeSeconds),
        inputSelection: () => this.inputStage?.meteredChannels ?? 'all',
        onHowlCut: (freqHz) => this.howlHandler?.(freqHz),
      },
      context.sampleRate,
    );
    this.applyGuardMode();
    this.syncTunerConnection();
  }

  /** 소스와 입력 트림 사이에 둘 InputStage 를 만든다. 파일 재생(스트림 없음)은 그대로 통과시킨다. */
  private createInputStage(source: AudioNode): InputStage {
    if (!this.context) throw new Error('AudioContext가 아직 준비되지 않았습니다.');

    const track = this.stream?.getAudioTracks()[0];
    const stage = new InputStage(this.context, source, track ? (track.getSettings().channelCount ?? 2) : 1, {
      mode: this.inputChannelMode,
      rememberedDecision: this.rememberedChannelDecision,
      passthrough: !this.stream,
    });
    stage.onDecision((decision) => this.inputDecisionHandler?.(decision));
    return stage;
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
    const presetTrim = this.presetTrimNode;

    if (
      !context ||
      !chainInput ||
      !masterGain ||
      !presetTrim ||
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
        presetTrim,
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
    chainEnd: AudioNode,
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

    // 체인 끝은 프리셋 음량 보정(trim)으로 들어가고, trim 은 OutputStage 안에서 마스터 게인에 이어져 있다.
    connections.set(`${previousId}->preset-trim`, {
      from: previousOutput,
      to: chainEnd,
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
    this.inputStage?.dispose();
    this.inputStage = null;
    this.inputTap?.disconnect();
    this.outputGuard?.disconnect();
    this.outputTap?.disconnect();
    this.inputGain?.disconnect();
    this.chainInput?.disconnect();
    this.outputStage?.dispose();
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
