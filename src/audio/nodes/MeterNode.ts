import type { LevelReading } from '../types';
import { gainToDb } from '../utils/db';

export class MeterNode {
  readonly input: AnalyserNode;
  private readonly buffer: Float32Array;

  constructor(context: AudioContext) {
    this.input = context.createAnalyser();
    this.input.fftSize = 1024;
    this.input.smoothingTimeConstant = 0.72;
    this.buffer = new Float32Array(this.input.fftSize);
  }

  read(): LevelReading {
    this.input.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    let peak = 0;

    for (let i = 0; i < this.buffer.length; i += 1) {
      const value = this.buffer[i];
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }

    const rms = Math.sqrt(sum / this.buffer.length);
    return {
      db: gainToDb(rms),
      linear: Math.min(1, rms * 4),
      peakDb: gainToDb(peak),
      peakLinear: Math.min(1, peak),
      isClipping: peak >= 0.98,
    };
  }

  readWaveform(size = 128): number[] {
    this.input.getFloatTimeDomainData(this.buffer);
    const step = Math.max(1, Math.floor(this.buffer.length / size));
    const waveform: number[] = [];

    for (let i = 0; i < this.buffer.length && waveform.length < size; i += step) {
      waveform.push(Number(this.buffer[i].toFixed(4)));
    }

    return waveform;
  }

  disconnect(): void {
    this.input.disconnect();
  }
}
