import { fixedLatencySeconds } from '../engine/latency';
import { BaseEffect } from './BaseEffect';
import type { FuzzParams, PedalState } from '../types';
import {
  FUZZ_GATE_ATTACK_MS,
  FUZZ_GATE_HOLD_MS,
  FUZZ_GATE_HYSTERESIS_DB,
  FUZZ_GATE_RELEASE_MS,
  fuzzGateWorkletSettings,
} from '../params/definitions/fuzz';
import { createFuzzCurve } from '../utils/curves';
import { createDcBlocker } from '../utils/dcBlocker';
import { oversampleModeFor } from '../utils/oversample';
import { smoothParam } from '../utils/smoothing';

export class FuzzEffect extends BaseEffect {
  /** 퍼즈 앞에서 잡음을 막는 게이트(Noise Gate 페달과 같은 워클릿). 열린 채로 시작하고 메시지를 보내지 않는다. */
  private readonly gate: AudioWorkletNode;
  private readonly preGain: GainNode;
  private readonly lowCut: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  /** 이 이펙트의 WaveShaper 오버샘플링(기능 플래그 oversample2x*, S3.7). 만들 때 한 번 정한다. */
  private readonly oversampleMode = oversampleModeFor('fuzz');
  private readonly dcBlocker: BiquadFilterNode;
  private readonly tone: BiquadFilterNode;
  private lastMode: FuzzParams['mode'] | null = null;
  private lastFuzz = -1;
  private lastBias = -1;

  constructor(context: BaseAudioContext, pedal: PedalState) {
    super(context, pedal);
    const initialGate = fuzzGateWorkletSettings((pedal.params as FuzzParams).gate);

    // outputChannelCount 를 정하지 않아 출력 채널 수가 입력(모노·스테레오)을 따른다. Gate 0 에서는 입력이 한 샘플도 바뀌지 않는다.
    this.gate = new AudioWorkletNode(context, 'noise-gate-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      parameterData: {
        thresholdDb: initialGate.thresholdDb,
        reductionDb: initialGate.reductionDb,
        attackMs: FUZZ_GATE_ATTACK_MS,
        holdMs: FUZZ_GATE_HOLD_MS,
        releaseMs: FUZZ_GATE_RELEASE_MS,
        hysteresisDb: FUZZ_GATE_HYSTERESIS_DB,
      },
      processorOptions: { startOpen: true, silent: true },
    });
    this.preGain = context.createGain();
    this.lowCut = context.createBiquadFilter();
    this.shaper = context.createWaveShaper();
    this.dcBlocker = createDcBlocker(context);
    this.tone = context.createBiquadFilter();

    this.lowCut.type = 'highpass';
    this.lowCut.Q.value = 0.82;
    this.shaper.oversample = this.oversampleMode;
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.9;

    this.effectInput.connect(this.gate);
    this.gate.connect(this.preGain);
    this.preGain.connect(this.lowCut);
    this.lowCut.connect(this.shaper);
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
    const params = pedal.params as FuzzParams;

    if (
      params.mode !== this.lastMode ||
      Math.abs(params.fuzz - this.lastFuzz) > 0.5 ||
      Math.abs(params.bias - this.lastBias) > 0.5
    ) {
      this.lastMode = params.mode;
      this.lastFuzz = params.fuzz;
      this.lastBias = params.bias;
      this.shaper.curve = createFuzzCurve(params.mode, params.fuzz, params.bias);
    }

    const preGain = 1.8 + (params.fuzz / 100) * 32;
    const toneFrequency = 700 + (params.tone / 100) * 8200;
    const gate = fuzzGateWorkletSettings(params.gate);

    this.setMakeup(1 / (1 + (params.fuzz / 100) * 3.4));
    smoothParam(this.preGain.gain, preGain, this.context);
    smoothParam(this.lowCut.frequency, params.lowCut, this.context);
    smoothParam(this.tone.frequency, toneFrequency, this.context);

    // 문턱은 부드럽게 옮기고, 줄이는 크기(켬 −80 dB ↔ 끔 0 dB)는 한 번에 바꾼다: 끄면 setTargetAtTime 처럼 0 dB 에 끝없이 다가가기만 하지 않고
    // 정확히 0 dB 가 되어 입력이 그대로 지나간다. 게이트가 열리고 닫히는 속도가 부드러움을 맡는다.
    this.setGateParam('thresholdDb', gate.thresholdDb, true);
    this.setGateParam('reductionDb', gate.reductionDb, false);
  }

  private setGateParam(name: string, value: number, smooth: boolean): void {
    const param = this.gate.parameters.get(name);
    if (!param) return;
    if (smooth) {
      smoothParam(param, value, this.context);
      return;
    }
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
  }

  override dispose(): void {
    this.gate.disconnect();
    this.preGain.disconnect();
    this.lowCut.disconnect();
    this.shaper.disconnect();
    this.dcBlocker.disconnect();
    this.tone.disconnect();
    super.dispose();
  }
}
