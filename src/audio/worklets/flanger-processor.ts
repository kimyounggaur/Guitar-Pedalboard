/** Per-sample flanger feedback avoids the render-quantum delay of a Web Audio graph cycle. */
export const flangerProcessorSource = String.raw`
function readParam(values, index) { return values.length === 1 ? values[0] : values[index]; }
class FlangerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'manual', defaultValue: 0.002, minValue: 0.0005, maxValue: 0.01, automationRate: 'a-rate' },
      { name: 'depth', defaultValue: 0, minValue: 0, maxValue: 0.00475, automationRate: 'a-rate' },
      { name: 'rate', defaultValue: 0.25, minValue: 0.05, maxValue: 5, automationRate: 'a-rate' },
      { name: 'feedback', defaultValue: 0, minValue: -0.95, maxValue: 0.95, automationRate: 'a-rate' },
    ];
  }
  constructor() {
    super();
    this.size = Math.ceil(sampleRate * 0.011) + 2;
    this.buffers = [new Float32Array(this.size), new Float32Array(this.size)];
    this.position = 0;
    this.phase = 0;
    this.disposed = false;
    this.port.onmessage = (event) => { if (event.data?.type === 'dispose') this.disposed = true; };
  }
  process(inputs, outputs, parameters) {
    if (this.disposed) return false;
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 0;
    for (let i = 0; i < frames; i++) {
      const get = readParam;
      const manual = Math.max(0.0005, Math.min(0.01, get(parameters.manual, i)));
      const depth = Math.max(0, Math.min(manual - 0.0005, 0.01 - manual, get(parameters.depth, i)));
      const feedback = Math.max(-0.95, Math.min(0.95, get(parameters.feedback, i)));
      const rate = Math.max(0.05, Math.min(5, get(parameters.rate, i)));
      const delay = Math.max(1, (manual + Math.sin(this.phase) * depth) * sampleRate);
      let read = this.position - delay;
      while (read < 0) read += this.size;
      const index = Math.floor(read);
      const fraction = read - index;
      for (let ch = 0; ch < output.length; ch++) {
        const buffer = this.buffers[ch];
        const wet = buffer[index] * (1 - fraction) + buffer[(index + 1) % this.size] * fraction;
        const value = input[ch]?.[i] ?? input[0]?.[i] ?? 0;
        buffer[this.position] = (Number.isFinite(value) ? value : 0) + wet * feedback;
        output[ch][i] = wet * Math.max(0.05, 1 - Math.abs(feedback));
      }
      this.position = (this.position + 1) % this.size;
      this.phase = (this.phase + 2 * Math.PI * rate / sampleRate) % (2 * Math.PI);
    }
    return true;
  }
}
registerProcessor('flanger-processor', FlangerProcessor);
`;
