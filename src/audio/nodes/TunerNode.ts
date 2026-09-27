import type { PitchReading, TuningPresetId } from '../types';
import { getPitchReading } from '../utils/tunings';

interface TunerPitchMessage {
  type: 'pitch';
  sessionId: number;
  frequency: number | null;
}

interface TunerDisposedMessage {
  type: 'disposed';
  sessionId: number;
}

type TunerProcessorMessage = TunerPitchMessage | TunerDisposedMessage;

const EMPTY_PITCH: PitchReading = { frequency: null, note: null, cents: 0 };

export class TunerNode {
  readonly input: AudioWorkletNode;
  private frequency: number | null = null;
  private preset: TuningPresetId;
  private sessionId = 0;
  private active = false;
  private disposed = false;

  constructor(context: AudioContext, preset: TuningPresetId) {
    this.preset = preset;
    this.input = new AudioWorkletNode(context, 'tuner-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCountMode: 'max',
      channelInterpretation: 'discrete',
    });

    this.input.port.onmessage = (event: MessageEvent<TunerProcessorMessage>) => {
      const message = event.data;
      if (
        this.disposed ||
        !this.active ||
        message.type !== 'pitch' ||
        message.sessionId !== this.sessionId
      ) {
        return;
      }

      this.frequency =
        message.frequency === null ||
        !Number.isFinite(message.frequency) ||
        message.frequency < 70 ||
        message.frequency > 1400
          ? null
          : message.frequency;
    };
  }

  setActive(active: boolean): void {
    if (this.disposed || active === this.active) return;

    this.active = active;
    this.frequency = null;
    this.sessionId += 1;
    this.input.port.postMessage({
      type: active ? 'wake' : 'sleep',
      sessionId: this.sessionId,
    });
  }

  setTuningPreset(preset: TuningPresetId): void {
    this.preset = preset;
  }

  readPitch(): PitchReading {
    if (!this.active || this.frequency === null) return EMPTY_PITCH;
    return getPitchReading(this.frequency, this.preset);
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.active = false;
    this.frequency = null;
    this.sessionId += 1;

    const disposeSessionId = this.sessionId;
    const port = this.input.port;
    port.onmessage = (event: MessageEvent<TunerProcessorMessage>) => {
      const message = event.data;
      if (message.type !== 'disposed' || message.sessionId !== disposeSessionId) return;

      port.onmessage = null;
      port.close();
    };
    port.postMessage({ type: 'dispose', sessionId: disposeSessionId });
    this.input.disconnect();
  }

  disconnect(): void {
    this.dispose();
  }
}
