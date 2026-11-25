/**
 * 1차 올패스를 고른 단수만큼만 직렬로 계산하고, 피드백을 샘플 단위로 되먹이는 Phaser (S3.4).
 *
 * - 단(stage) 하나는 1차 올패스 H(z) = (a + z⁻¹) / (1 + a·z⁻¹) 이다. 단수가 N 이면 위상이 −Nπ 까지 돌아 노치가 N/2 개 생긴다(4단 = 2개).
 * - 계산하는 단은 고른 단수까지뿐이다(12단 고정으로 돌리던 옛 구조를 대체). 단수를 바꿀 때는 20 ms 동안 탭 가중치를 옮긴다.
 * - 피드백은 직전 샘플의 출력을 이번 샘플 입력에 더한다. Web Audio 그래프의 되먹임은 렌더 퀀텀(128샘플) 늦게 돌아오지만 여기는 1샘플이다.
 * - `active` 가 0 이거나 입력이 끊기고 꼬리가 사라지면 필터를 돌리지 않고 상태를 0 으로 비운다(꺼진 Phaser 의 CPU 기여를 0 으로 만든다).
 */
export const phaserProcessorSource = String.raw`
function readParam(values, index) { return values.length === 1 ? values[0] : values[index]; }
const STAGE_OPTIONS = [4, 6, 8, 12];
const MAX_STAGES = 12;
const FADE_SECONDS = 0.02;
const SILENT_ENERGY = 1e-24;
function nearestOption(stages) {
  let best = 1;
  for (let j = 0; j < STAGE_OPTIONS.length; j++) {
    if (Math.abs(STAGE_OPTIONS[j] - stages) < Math.abs(STAGE_OPTIONS[best] - stages)) best = j;
  }
  return best;
}
class PhaserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.5, minValue: 0.05, maxValue: 8, automationRate: 'a-rate' },
      { name: 'depth', defaultValue: 70, minValue: 0, maxValue: 100, automationRate: 'a-rate' },
      { name: 'feedback', defaultValue: 0.4, minValue: 0, maxValue: 0.9, automationRate: 'a-rate' },
      { name: 'stages', defaultValue: 6, minValue: 4, maxValue: 12, automationRate: 'k-rate' },
      { name: 'active', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(options) {
    super();
    const initial = nearestOption(options?.processorOptions?.stages ?? 6);
    this.target = initial;
    this.weights = new Float64Array(STAGE_OPTIONS.length);
    this.weights[initial] = 1;
    this.tapWeights = new Float64Array(MAX_STAGES);
    this.count = STAGE_OPTIONS[initial];
    this.settled = true;
    this.fadeStep = 1 / Math.max(1, sampleRate * FADE_SECONDS);
    this.states = [new Float64Array(MAX_STAGES), new Float64Array(MAX_STAGES)];
    this.previous = new Float64Array(2);
    this.phase = 0;
    this.disposed = false;
    this.syncTaps();
    this.port.onmessage = (event) => { if (event.data?.type === 'dispose') this.disposed = true; };
  }
  syncTaps() {
    this.tapWeights.fill(0);
    for (let j = 0; j < STAGE_OPTIONS.length; j++) this.tapWeights[STAGE_OPTIONS[j] - 1] = this.weights[j];
  }
  retarget(stages) {
    const next = nearestOption(stages);
    if (next === this.target) return;
    this.target = next;
    // 새 탭까지는 곧바로 계산해야 하므로 계산할 단 수를 먼저 늘리고, 가중치가 다 옮겨지면 줄인다.
    this.count = Math.max(this.count, STAGE_OPTIONS[next]);
    this.settled = false;
  }
  stepWeights() {
    const weights = this.weights;
    const target = this.target;
    const before = weights[target];
    const after = Math.min(1, before + this.fadeStep);
    const scale = before >= 1 ? 0 : (1 - after) / (1 - before);
    for (let j = 0; j < weights.length; j++) if (j !== target) weights[j] *= scale;
    weights[target] = after;
    if (after >= 1) {
      this.settled = true;
      this.count = STAGE_OPTIONS[target];
      for (let ch = 0; ch < this.states.length; ch++) this.states[ch].fill(0, this.count);
    }
    this.syncTaps();
  }
  isSilent(input) {
    for (let ch = 0; ch < input.length; ch++) {
      const samples = input[ch];
      for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) return false;
    }
    return true;
  }
  tailEnergy() {
    let energy = 0;
    for (let ch = 0; ch < this.states.length; ch++) {
      const state = this.states[ch];
      for (let stage = 0; stage < this.count; stage++) energy += state[stage] * state[stage];
      energy += this.previous[ch] * this.previous[ch];
    }
    return energy;
  }
  flush() {
    for (let ch = 0; ch < this.states.length; ch++) this.states[ch].fill(0);
    this.previous.fill(0);
  }
  process(inputs, outputs, parameters) {
    if (this.disposed) return false;
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 0;
    if (frames === 0) return true;
    this.retarget(parameters.stages ? parameters.stages[0] : 6);
    const active = parameters.active ? parameters.active[0] >= 0.5 : true;
    const twoPi = 2 * Math.PI;
    if (!active || (this.isSilent(input) && this.tailEnergy() < SILENT_ENERGY)) {
      // 꺼졌거나 입력도 꼬리도 없다: 필터를 돌리지 않고 상태를 비운다. LFO 위상만 시간에 맞춰 흘려 보낸다.
      this.flush();
      for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
      this.phase = (this.phase + twoPi * readParam(parameters.rate, 0) * frames / sampleRate) % twoPi;
      return true;
    }
    const logSpan = Math.log(Math.sqrt(10));
    const center = Math.sqrt(200 * 2000);
    for (let i = 0; i < frames; i++) {
      if (!this.settled) this.stepWeights();
      const depth = Math.max(0, Math.min(100, readParam(parameters.depth, i))) / 100;
      const rate = Math.max(0.05, Math.min(8, readParam(parameters.rate, i)));
      const feedback = Math.max(0, Math.min(0.9, readParam(parameters.feedback, i)));
      const frequency = center * Math.exp(logSpan * depth * Math.sin(this.phase));
      const tangent = Math.tan(Math.PI * frequency / sampleRate);
      const a = (tangent - 1) / (tangent + 1);
      const count = this.count;
      const taps = this.tapWeights;
      for (let ch = 0; ch < output.length; ch++) {
        const state = this.states[ch];
        const sample = input[ch]?.[i] ?? input[0]?.[i] ?? 0;
        let value = (Number.isFinite(sample) ? sample : 0) + this.previous[ch] * feedback;
        let wet = 0;
        for (let stage = 0; stage < count; stage++) {
          const next = a * value + state[stage];
          state[stage] = value - a * next;
          value = next;
          wet += value * taps[stage];
        }
        this.previous[ch] = wet;
        output[ch][i] = wet;
      }
      this.phase = (this.phase + twoPi * rate / sampleRate) % twoPi;
    }
    return true;
  }
}
registerProcessor('phaser-processor', PhaserProcessor);
`;
