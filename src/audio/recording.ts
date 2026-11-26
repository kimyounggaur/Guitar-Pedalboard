const WEBM_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;

export function selectRecorderMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): string | undefined {
  if (!isTypeSupported) return undefined;
  return WEBM_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType));
}

export type RecordingFileFormat = 'webm' | 'wav' | 'm4a' | 'mp4' | 'ogg' | 'unknown';

export function recordingFormatFromMime(mime: string): RecordingFileFormat {
  const type = mime.split(';', 1)[0].trim().toLowerCase();
  if (type === 'audio/webm' || type === 'video/webm') return 'webm';
  if (type === 'audio/mp4' || type === 'audio/x-m4a' || type === 'audio/m4a') return 'm4a';
  if (type === 'video/mp4' || type === 'application/mp4') return 'mp4';
  if (type === 'audio/ogg' || type === 'application/ogg' || type === 'video/ogg') return 'ogg';
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') return 'wav';
  return 'unknown';
}

export function createRecordingFilename(date = new Date(), format: RecordingFileFormat = 'webm'): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `pedalboard-${datePart}-${timePart}${format === 'unknown' ? '' : `.${format}`}`;
}

/** WAV 녹음의 비트 깊이. 16비트가 기본이고 24비트는 편집용 선택지다(S5.1). */
export type WavBitDepth = 16 | 24;
export const WAV_BIT_DEPTHS: readonly WavBitDepth[] = [16, 24];
export const DEFAULT_WAV_BIT_DEPTH: WavBitDepth = 16;

/** WAV 녹음의 최대 길이(초) 선택지. 기본은 5분이다(S5.1). 길수록 메모리를 쓴다(샘플 하나가 Float32 4바이트, 스테레오). */
export const WAV_MAX_SECONDS_OPTIONS: readonly number[] = [60, 120, 300];
export const DEFAULT_WAV_MAX_SECONDS = 300;
/** 샘플레이트가 높아도 메모리가 이 이상 늘지 않게 하는 프레임 수의 상한(스테레오 Float32 약 120 MB). */
export const MAX_WAV_FRAMES = 15_000_000;

/** 기록된 최대 길이(초)를 선택지 중 하나로 맞춘다. 알 수 없는 값은 기본값. */
export function normalizeWavMaxSeconds(value: unknown): number {
  return typeof value === 'number' && WAV_MAX_SECONDS_OPTIONS.includes(value) ? value : DEFAULT_WAV_MAX_SECONDS;
}

export function normalizeWavBitDepth(value: unknown): WavBitDepth {
  return value === 24 ? 24 : DEFAULT_WAV_BIT_DEPTH;
}

/** 샘플레이트와 고른 최대 길이에서 실제로 담을 수 있는 프레임 수(메모리 상한 포함). */
export function wavFrameLimit(sampleRate: number, maxSeconds: number): number {
  return Math.max(1, Math.min(Math.round(sampleRate * maxSeconds), MAX_WAV_FRAMES));
}

/** Encode two-channel PCM as a standard little-endian 16- or 24-bit WAV file. */
export function encodePcmWav(chunks: readonly Float32Array[], sampleRate: number, bitDepth: WavBitDepth = DEFAULT_WAV_BIT_DEPTH): Blob {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (samples % 2 !== 0 || !Number.isFinite(sampleRate) || sampleRate < 1) throw new Error('잘못된 WAV 오디오 데이터입니다.');
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const dataBytes = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const tag = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2 * bytesPerSample, true); view.setUint16(32, 2 * bytesPerSample, true);
  view.setUint16(34, bitDepth, true); tag(36, 'data'); view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    if (bitDepth === 24) {
      const int = Math.round(sample < 0 ? sample * 8388608 : sample * 8388607);
      view.setUint8(offset, int & 0xff);
      view.setUint8(offset + 1, (int >> 8) & 0xff);
      view.setUint8(offset + 2, (int >> 16) & 0xff);
      offset += 3;
    } else {
      view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export class WavRecorder {
  private readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly processor: ScriptProcessorNode;
  private readonly silence: GainNode;
  private chunks: Float32Array[] = [];
  private frames = 0;
  private stopped = false;
  private readonly maxFrames: number;
  private readonly bitDepth: WavBitDepth;

  constructor(stream: MediaStream, onLimit: () => void, options: { maxSeconds?: number; bitDepth?: WavBitDepth } = {}) {
    this.context = new AudioContext();
    this.maxFrames = wavFrameLimit(this.context.sampleRate, normalizeWavMaxSeconds(options.maxSeconds));
    this.bitDepth = normalizeWavBitDepth(options.bitDepth);
    this.source = this.context.createMediaStreamSource(stream);
    this.processor = this.context.createScriptProcessor(4096, 2, 2);
    this.silence = this.context.createGain();
    this.silence.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      if (this.stopped) return;
      const input = event.inputBuffer;
      const left = input.getChannelData(0);
      const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
      const count = Math.min(left.length, this.maxFrames - this.frames);
      const chunk = new Float32Array(count * 2);
      for (let i = 0; i < count; i += 1) { chunk[i * 2] = left[i]; chunk[i * 2 + 1] = right[i]; }
      this.chunks.push(chunk);
      this.frames += count;
      if (this.frames >= this.maxFrames) { this.stopped = true; onLimit(); }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silence);
    this.silence.connect(this.context.destination);
    void this.context.resume().catch(() => onLimit());
  }

  /** 실제로 담을 수 있는 최대 길이(초). 고른 길이보다 샘플레이트에 따른 메모리 상한이 작으면 그쪽이다. */
  get limitSeconds(): number {
    return this.maxFrames / this.context.sampleRate;
  }

  async stop(): Promise<Blob> {
    this.stopped = true;
    this.processor.onaudioprocess = null;
    this.source.disconnect(); this.processor.disconnect(); this.silence.disconnect();
    const blob = encodePcmWav(this.chunks, this.context.sampleRate, this.bitDepth);
    this.chunks = [];
    await this.context.close();
    return blob;
  }
}
