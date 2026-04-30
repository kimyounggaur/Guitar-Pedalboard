import type { PitchReading } from '../types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class TunerNode {
  readonly input: AnalyserNode;
  private readonly buffer: Float32Array;
  private readonly sampleRate: number;

  constructor(context: AudioContext) {
    this.input = context.createAnalyser();
    this.input.fftSize = 2048;
    this.sampleRate = context.sampleRate;
    this.buffer = new Float32Array(this.input.fftSize);
  }

  readPitch(): PitchReading {
    this.input.getFloatTimeDomainData(this.buffer);
    const frequency = this.autoCorrelate();

    if (!frequency) {
      return { frequency: null, note: null, cents: 0 };
    }

    const midi = 69 + 12 * Math.log2(frequency / 440);
    const rounded = Math.round(midi);
    const note = `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
    const targetFrequency = 440 * Math.pow(2, (rounded - 69) / 12);
    const cents = 1200 * Math.log2(frequency / targetFrequency);

    return { frequency, note, cents };
  }

  disconnect(): void {
    this.input.disconnect();
  }

  private autoCorrelate(): number | null {
    let rms = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      rms += this.buffer[i] * this.buffer[i];
    }
    rms = Math.sqrt(rms / this.buffer.length);

    if (rms < 0.01) return null;

    let bestOffset = -1;
    let bestCorrelation = 0;
    const minOffset = Math.floor(this.sampleRate / 1000);
    const maxOffset = Math.floor(this.sampleRate / 65);

    for (let offset = minOffset; offset <= maxOffset; offset += 1) {
      let correlation = 0;
      for (let i = 0; i < this.buffer.length - offset; i += 1) {
        correlation += Math.abs(this.buffer[i] - this.buffer[i + offset]);
      }

      correlation = 1 - correlation / (this.buffer.length - offset);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    if (bestCorrelation < 0.45 || bestOffset <= 0) return null;
    return this.sampleRate / bestOffset;
  }
}
