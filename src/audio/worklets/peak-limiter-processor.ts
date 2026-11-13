/** Linked sample-peak limiter. No look-ahead: instantaneous attack, 50 ms release. */
export const peakLimiterProcessorSource = String.raw`
class PeakLimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gain = 1;
    this.release = Math.exp(-1 / (0.05 * sampleRate));
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 0;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let ch = 0; ch < input.length; ch++) {
        const sample = input[ch]?.[i] ?? 0;
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
      }
      const target = peak > 0.89 ? 0.89 / peak : 1;
      this.gain = target < this.gain ? target : Math.min(target, 1 - (1 - this.gain) * this.release);
      for (let ch = 0; ch < output.length; ch++) {
        const sample = input[ch]?.[i] ?? input[0]?.[i] ?? 0;
        output[ch][i] = Number.isFinite(sample) ? sample * this.gain : 0;
      }
    }
    return true;
  }
}
registerProcessor('peak-limiter-processor', PeakLimiterProcessor);
`;
