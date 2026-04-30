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

    for (let i = 0; i < this.buffer.length; i += 1) {
      sum += this.buffer[i] * this.buffer[i];
    }

    const rms = Math.sqrt(sum / this.buffer.length);
    return {
      db: gainToDb(rms),
      linear: Math.min(1, rms * 4),
    };
  }

  disconnect(): void {
    this.input.disconnect();
  }
}
