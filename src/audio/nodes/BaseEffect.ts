import type { BasePedalParams, EffectType, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

export class BaseEffect {
  readonly id: string;
  readonly type: EffectType;
  readonly input: GainNode;
  readonly output: GainNode;

  protected readonly context: AudioContext;
  protected readonly effectInput: GainNode;
  protected readonly effectOutput: GainNode;
  protected readonly dryGain: GainNode;
  protected readonly wetGain: GainNode;
  protected readonly levelGain: GainNode;

  constructor(context: AudioContext, pedal: PedalState) {
    this.context = context;
    this.id = pedal.id;
    this.type = pedal.type;

    this.input = context.createGain();
    this.output = context.createGain();
    this.effectInput = context.createGain();
    this.effectOutput = context.createGain();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();
    this.levelGain = context.createGain();

    this.input.connect(this.dryGain);
    this.input.connect(this.effectInput);
    this.dryGain.connect(this.levelGain);
    this.effectOutput.connect(this.wetGain);
    this.wetGain.connect(this.levelGain);
    this.levelGain.connect(this.output);

    this.updateCommon(pedal.params);
  }

  connect(destination: AudioNode): void {
    this.output.connect(destination);
  }

  update(pedal: PedalState): void {
    this.updateCommon(pedal.params);
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.effectInput.disconnect();
    this.effectOutput.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.levelGain.disconnect();
  }

  protected updateCommon(params: BasePedalParams): void {
    const mix = clamp(params.mix, 0, 1);
    const dry = params.bypass ? 1 : 1 - mix;
    const wet = params.bypass ? 0 : mix;
    const level = clamp(params.level, 0, 2);

    smoothParam(this.dryGain.gain, dry, this.context);
    smoothParam(this.wetGain.gain, wet, this.context);
    smoothParam(this.levelGain.gain, level, this.context);
  }

  protected connectPassthrough(): void {
    this.effectInput.connect(this.effectOutput);
  }
}
