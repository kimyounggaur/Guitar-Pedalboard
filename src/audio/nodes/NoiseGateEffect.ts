import { BaseEffect } from './BaseEffect';
import type { NoiseGateParams, PedalState } from '../types';
import { smoothParam } from '../utils/smoothing';

export class NoiseGateEffect extends BaseEffect {
  private readonly gate: AudioWorkletNode;

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

    this.gate.port.onmessage = (event: MessageEvent<{ type: string; state: string }>) => {
      if (event.data.type !== 'gate-state') return;
      window.dispatchEvent(
        new CustomEvent('noise-gate-state', {
          detail: {
            id: this.id,
            state: event.data.state,
          },
        }),
      );
    };

    this.effectInput.connect(this.gate);
    this.gate.connect(this.effectOutput);
    this.update(pedal);
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
