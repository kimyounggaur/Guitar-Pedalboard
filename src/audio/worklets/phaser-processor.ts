/** Cascaded all-pass filters with sample-level feedback and smooth stage changes. */
export const phaserProcessorSource = String.raw`
function readParam(values, index) { return values.length === 1 ? values[0] : values[index]; }
class PhaserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.5, minValue: 0.05, maxValue: 8, automationRate: 'a-rate' },
      { name: 'depth', defaultValue: 70, minValue: 0, maxValue: 100, automationRate: 'a-rate' },
      { name: 'feedback', defaultValue: 0.4, minValue: 0, maxValue: 0.9, automationRate: 'a-rate' },
      { name: 'stages', defaultValue: 6, minValue: 4, maxValue: 12, automationRate: 'k-rate' },
    ];
  }
  constructor(options) {
    super();
    this.options = [4, 6, 8, 12];
    const initial = options.processorOptions?.stages ?? 6;
    this.weights = this.options.map((value) => value === initial ? 1 : 0);
    this.states = [new Float64Array(48), new Float64Array(48)];
    this.previous = new Float64Array(2);
    this.phase = 0;
    this.disposed = false;
    this.port.onmessage = (event) => { if (event.data?.type === 'dispose') this.disposed = true; };
  }
  process(inputs, outputs, parameters) {
    if (this.disposed) return false;
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 0;
    const target = this.options.reduce((best, value) => Math.abs(value - parameters.stages[0]) < Math.abs(best - parameters.stages[0]) ? value : best, 6);
    // A 12 ms ramp avoids clicks without computing four parallel filter banks.
    const step = 1 / Math.max(1, sampleRate * 0.012);
    for (let i = 0; i < frames; i++) {
      for (let j = 0; j < 4; j++) {
        const desired = this.options[j] === target ? 1 : 0;
        this.weights[j] += Math.max(-step, Math.min(step, desired - this.weights[j]));
      }
      const depth = Math.max(0, Math.min(100, readParam(parameters.depth, i))) / 100;
      const rate = Math.max(0.05, Math.min(8, readParam(parameters.rate, i)));
      const feedback = Math.max(0, Math.min(0.9, readParam(parameters.feedback, i)));
      const frequency = Math.sqrt(200 * 2000) * Math.exp(Math.log(Math.sqrt(10)) * depth * Math.sin(this.phase));
      const omega = 2 * Math.PI * frequency / sampleRate;
      const alpha = Math.sin(omega) / (2 * 0.8);
      const a0 = 1 + alpha;
      const b0 = (1 - alpha) / a0;
      const b1 = -2 * Math.cos(omega) / a0;
      const b2 = 1;
      for (let ch = 0; ch < output.length; ch++) {
        const state = this.states[ch];
        const sample = input[ch]?.[i] ?? input[0]?.[i] ?? 0;
        let value = (Number.isFinite(sample) ? sample : 0) + this.previous[ch] * feedback;
        let wet = 0;
        for (let stage = 0; stage < 12; stage++) {
          const pos = stage * 4;
          const next = b0 * value + b1 * state[pos] + b2 * state[pos + 1] - b1 * state[pos + 2] - b0 * state[pos + 3];
          state[pos + 1] = state[pos]; state[pos] = value;
          state[pos + 3] = state[pos + 2]; state[pos + 2] = next;
          value = next;
          if (stage === 3) wet += value * this.weights[0];
          else if (stage === 5) wet += value * this.weights[1];
          else if (stage === 7) wet += value * this.weights[2];
          else if (stage === 11) wet += value * this.weights[3];
        }
        this.previous[ch] = wet;
        output[ch][i] = wet;
      }
      this.phase = (this.phase + 2 * Math.PI * rate / sampleRate) % (2 * Math.PI);
    }
    return true;
  }
}
registerProcessor('phaser-processor', PhaserProcessor);
`;
