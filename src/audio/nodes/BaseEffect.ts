import type { BasePedalParams, EffectType, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

const ROUTING_FADE_SECONDS = 0.012;
const WET_CUT_FADE_SECONDS = 0.003;

export class BaseEffect {
  readonly id: string;
  readonly type: EffectType;
  readonly input: GainNode;
  readonly output: GainNode;

  protected readonly context: BaseAudioContext;
  protected readonly effectInput: GainNode;
  protected readonly effectOutput: GainNode;
  protected readonly effectGate: GainNode;
  protected readonly bypassAll: GainNode;
  protected readonly dryGain: GainNode;
  protected readonly wetGain: GainNode;
  protected readonly makeupGain: GainNode;
  protected readonly levelGain: GainNode;
  protected wetTarget = 0;
  protected commonParams: BasePedalParams = {
    mix: 100,
    level: 100,
  };
  /** 소리에 걸리는가(S2.4: 옛 enabled·bypassed 두 값의 곱을 하나로 합쳤다). 켜고 끄는 크로스페이드가 이 값 하나로 움직인다. */
  private active = true;
  private trails = false;

  constructor(context: BaseAudioContext, pedal: PedalState) {
    this.context = context;
    this.id = pedal.id;
    this.type = pedal.type;

    this.input = context.createGain();
    this.output = context.createGain();
    this.effectInput = context.createGain();
    this.effectOutput = context.createGain();
    this.effectGate = context.createGain();
    this.bypassAll = context.createGain();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();
    this.makeupGain = context.createGain();
    this.levelGain = context.createGain();

    this.bypassAll.gain.value = 0;
    this.effectGate.gain.value = 1;
    this.dryGain.gain.value = 0;
    this.wetGain.gain.value = 0;

    this.input.connect(this.bypassAll);
    this.bypassAll.connect(this.output);
    this.input.connect(this.effectGate);
    this.effectGate.connect(this.dryGain);
    this.effectGate.connect(this.effectInput);
    this.dryGain.connect(this.levelGain);
    this.effectOutput.connect(this.wetGain);
    this.wetGain.connect(this.makeupGain);
    this.makeupGain.connect(this.levelGain);
    this.levelGain.connect(this.output);

    this.updateCommon(pedal.params, pedal.active, this.hasTrails(pedal), true);
  }

  /**
   * 이 페달이 켜져 있을 때 신호에 더하는 고정 지연(초, 설계서 4.6). 꺼져 있으면 0 이다. 화면의 '처리 지연'은 켜진 페달들의 이 값을 더한다.
   * 지연이 있는 페달은 processingLatencySeconds 를 덮어쓴다(기본 0). 모양을 만드는 지연(딜레이·코러스의 지연선 등)은 소리의 일부라 넣지 않는다.
   */
  get latencySeconds(): number {
    return this.active ? this.processingLatencySeconds() : 0;
  }

  protected processingLatencySeconds(): number {
    return 0;
  }

  connect(destination: AudioNode): void {
    this.output.connect(destination);
  }

  disconnect(): void {
    this.output.disconnect();
  }

  update(pedal: PedalState): void {
    this.updateCommon(
      pedal.params,
      pedal.active,
      this.hasTrails(pedal),
    );
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.effectInput.disconnect();
    this.effectOutput.disconnect();
    this.effectGate.disconnect();
    this.bypassAll.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.makeupGain.disconnect();
    this.levelGain.disconnect();
  }

  protected getWetTarget(): number {
    return this.wetTarget;
  }

  protected updateCommon(
    params: BasePedalParams,
    active: boolean,
    trails: boolean,
    immediate = false,
  ): void {
    this.commonParams = {
      mix: params.mix,
      level: params.level,
    };

    this.active = active;
    this.trails = trails;

    const level = clamp(params.level / 100, 0, 2);
    this.setRoutingParam(this.levelGain.gain, level, ROUTING_FADE_SECONDS, immediate);
    this.applyRouting(immediate);
  }

  private applyRouting(immediate = false): void {
    const mix = clamp(this.commonParams.mix / 100, 0, 1);
    const active = this.active;
    const preserveTrails = !active && this.trails;
    // Time-based effects add repeats/ambience without attenuating the direct guitar.
    const dry = active ? (this.type === 'delay' || this.type === 'reverb' ? 1 : 1 - mix) : 0;
    this.wetTarget = active || preserveTrails ? mix : 0;

    this.setRoutingParam(
      this.bypassAll.gain,
      active ? 0 : 1,
      ROUTING_FADE_SECONDS,
      immediate,
    );
    this.setRoutingParam(
      this.effectGate.gain,
      active ? 1 : 0,
      ROUTING_FADE_SECONDS,
      immediate,
    );
    this.setRoutingParam(this.dryGain.gain, dry, ROUTING_FADE_SECONDS, immediate);
    this.setRoutingParam(
      this.wetGain.gain,
      this.wetTarget,
      this.wetTarget === 0 ? WET_CUT_FADE_SECONDS : ROUTING_FADE_SECONDS,
      immediate,
    );
  }

  private setRoutingParam(
    param: AudioParam,
    value: number,
    duration: number,
    immediate: boolean,
  ): void {
    if (immediate) {
      const now = this.context.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
      return;
    }

    const now = this.context.currentTime;
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      const currentValue = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(currentValue, now);
    }
    param.linearRampToValueAtTime(value, now + duration);
  }

  private hasTrails(pedal: PedalState): boolean {
    return (
      (pedal.type === 'delay' || pedal.type === 'reverb') &&
      pedal.params.trails === true
    );
  }

  protected connectPassthrough(): void {
    this.effectInput.connect(this.effectOutput);
  }

  protected setMakeup(value: number): void {
    smoothParam(this.makeupGain.gain, clamp(value, 0, 1), this.context);
  }
}
