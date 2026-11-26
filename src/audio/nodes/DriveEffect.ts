import { fixedLatencySeconds } from '../engine/latency';
import { BaseEffect } from './BaseEffect';
import type { DriveParams, PedalState } from '../types';
import { createDriveCurve } from '../utils/curves';
import { createDcBlocker } from '../utils/dcBlocker';
import { oversampleModeFor } from '../utils/oversample';
import { smoothParam } from '../utils/smoothing';

/** 바이어스 슬라이더의 한 칸(0.01)의 절반. 이보다 작게 달라지면 곡선을 다시 만들지 않는다. */
const BIAS_UPDATE_STEP = 0.005;

export class DriveEffect extends BaseEffect {
  private readonly shaper: WaveShaperNode;
  /** 이 이펙트의 WaveShaper 오버샘플링(기능 플래그 oversample2x*, S3.7). 만들 때 한 번 정한다. */
  private readonly oversampleMode = oversampleModeFor('drive');
  private readonly dcBlocker: BiquadFilterNode;
  private readonly tone: BiquadFilterNode;
  private lastMode: DriveParams['mode'] | null = null;
  private lastDrive = -1;
  private lastBias = 99;

  constructor(context: BaseAudioContext, pedal: PedalState) {
    super(context, pedal);
    this.shaper = context.createWaveShaper();
    this.shaper.oversample = this.oversampleMode;
    this.dcBlocker = createDcBlocker(context);
    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.7;

    this.effectInput.connect(this.shaper);
    this.shaper.connect(this.dcBlocker);
    this.dcBlocker.connect(this.tone);
    this.tone.connect(this.effectOutput);
    this.update(pedal);
  }

  /** WaveShaper 오버샘플링 필터가 더하는 지연. P-16(2배)·P-29(4배)가 잰 값이다(params/latency.json). */
  protected override processingLatencySeconds(): number {
    return fixedLatencySeconds(this.oversampleMode === '2x' ? 'oversample2x' : 'oversample4x', this.context.sampleRate);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as DriveParams;

    if (
      params.mode !== this.lastMode ||
      Math.abs(params.drive - this.lastDrive) > 0.5 ||
      Math.abs(params.bias - this.lastBias) > BIAS_UPDATE_STEP
    ) {
      this.lastMode = params.mode;
      this.lastDrive = params.drive;
      this.lastBias = params.bias;
      this.shaper.curve = createDriveCurve(params.mode, params.drive, params.bias);
    }

    const toneFrequency = 700 + (params.tone / 100) * 9800;
    this.setMakeup(1 / (1 + (params.drive / 100) * 1.6));
    smoothParam(this.tone.frequency, toneFrequency, this.context);
  }

  override dispose(): void {
    this.shaper.disconnect();
    this.dcBlocker.disconnect();
    this.tone.disconnect();
    super.dispose();
  }
}
