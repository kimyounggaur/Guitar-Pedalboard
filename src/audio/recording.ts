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

/** Encode two-channel PCM as a standard little-endian 16-bit WAV file. */
export function encodePcmWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (samples % 2 !== 0 || !Number.isFinite(sampleRate) || sampleRate < 1) throw new Error('잘못된 WAV 오디오 데이터입니다.');
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true);
  view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
    offset += 2;
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

  constructor(stream: MediaStream, onLimit: () => void) {
    this.context = new AudioContext();
    this.maxFrames = Math.min(this.context.sampleRate * 120, 6_000_000);
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

  async stop(): Promise<Blob> {
    this.stopped = true;
    this.processor.onaudioprocess = null;
    this.source.disconnect(); this.processor.disconnect(); this.silence.disconnect();
    const blob = encodePcmWav(this.chunks, this.context.sampleRate);
    this.chunks = [];
    await this.context.close();
    return blob;
  }
}
