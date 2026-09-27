import { BaseEffect } from './BaseEffect';
import type { NoiseGateParams, PedalState } from '../types';
import { smoothParam } from '../utils/smoothing';

interface NoiseGateMessage {
  type?: unknown;
  state?: unknown;
  glitchCount?: unknown;
  missedFrames?: unknown;
}

export class NoiseGateEffect extends BaseEffect {
  private readonly gate: AudioWorkletNode;
  private glitchCount = 0;
  private missedFrames = 0;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    const params = pedal.params as NoiseGateParams;

    this.gate = new AudioWorkletNode(context, 'noise-gate-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: {
        thresholdDb: params.thresholdDb,
        reductionDb: params.reductionDb,
        attackMs: params.attackMs,
        holdMs: params.holdMs,
        releaseMs: params.releaseMs,
        hysteresisDb: params.hysteresisDb,
      },
    });

    this.gate.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as NoiseGateMessage;

      if (
        message.type === 'glitch-report' &&
        typeof message.glitchCount === 'number' &&
        Number.isFinite(message.glitchCount)
      ) {
        this.glitchCount = Math.max(0, Math.floor(message.glitchCount));
        if (typeof message.missedFrames === 'number' && Number.isFinite(message.missedFrames)) {
          this.missedFrames = Math.max(0, Math.floor(message.missedFrames));
        }
        return;
      }

      if (
        message.type !== 'gate-state' ||
        (message.state !== 'Open' && message.state !== 'Closing' && message.state !== 'Closed')
      ) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent('noise-gate-state', {
          detail: {
            id: this.id,
            state: message.state,
          },
        }),
      );
    };

    this.effectInput.connect(this.gate);
    this.gate.connect(this.effectOutput);
    this.update(pedal);
  }

  readGlitchCount(): number {
    return this.glitchCount;
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as NoiseGateParams;

    this.setWorkletParam('thresholdDb', params.thresholdDb);
    this.setWorkletParam('reductionDb', params.reductionDb);
    this.setWorkletParam('attackMs', params.attackMs);
    this.setWorkletParam('holdMs', params.holdMs);
    this.setWorkletParam('releaseMs', params.releaseMs);
    this.setWorkletParam('hysteresisDb', params.hysteresisDb);
  }

  private setWorkletParam(name: string, value: number): void {
    const param = this.gate.parameters.get(name);
    if (param) smoothParam(param, value, this.context);
  }

  override dispose(): void {
    this.gate.port.onmessage = null;
    this.gate.disconnect();
    super.dispose();
  }
}
