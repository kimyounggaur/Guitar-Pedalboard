/** Zero-lookahead, stereo-linked compressor. Gain reduction is reported in dB. */
export const compressorProcessorSource = String.raw`
function reductionForLevel(level, threshold, knee, ratio) {
  const slope = 1 - 1 / ratio;
  const over = level - threshold;
  if (knee <= 0.0001) return over > 0 ? -slope * over : 0;
  if (over <= -knee / 2) return 0;
  if (over >= knee / 2) return -slope * over;
  const distance = over + knee / 2;
  return -slope * distance * distance / (2 * knee);
}
function bounded(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
class CompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -30, minValue: -60, maxValue: -10, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 20, minValue: 0, maxValue: 40, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.003, minValue: 0.001, maxValue: 0.1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.2, minValue: 0.05, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.reductionDb = 0;
    this.makeupDb = 0;
    this.framesSinceReport = 0;
    this.disposed = false;
    this.port.onmessage = (event) => { if (event.data?.type === 'dispose') this.disposed = true; };
  }
  process(inputs, outputs, parameters) {
    if (this.disposed) return false;
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 0;
    const threshold = bounded(parameters.threshold[0], -60, -10, -30);
    const ratio = bounded(parameters.ratio[0], 1, 20, 4);
    const knee = bounded(parameters.knee[0], 0, 40, 20);
    const attack = bounded(parameters.attack[0], .001, .1, .003);
    const release = bounded(parameters.release[0], .05, 1, .2);
    const attackCoef = Math.exp(-1 / (attack * sampleRate));
    const releaseCoef = Math.exp(-1 / (release * sampleRate));
    const makeupCoef = Math.exp(-1 / (.02 * sampleRate));
    // Conservative automatic makeup keeps existing preset levels useful.
    const targetMakeupDb = Math.min(12, -reductionForLevel(0, threshold, knee, ratio) * .6);
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let ch = 0; ch < input.length; ch++) {
        const sample = input[ch]?.[i] ?? 0;
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
      }
      const level = 20 * Math.log10(Math.max(peak, 1e-12));
      const target = reductionForLevel(level, threshold, knee, ratio);
      const coef = target < this.reductionDb ? attackCoef : releaseCoef;
      this.reductionDb = target + coef * (this.reductionDb - target);
      this.makeupDb = targetMakeupDb + makeupCoef * (this.makeupDb - targetMakeupDb);
      const gain = Math.pow(10, (this.reductionDb + this.makeupDb) / 20);
      for (let ch = 0; ch < output.length; ch++) {
        const sample = input[ch]?.[i] ?? input[0]?.[i] ?? 0;
        output[ch][i] = Number.isFinite(sample) ? sample * gain : 0;
      }
    }
    this.framesSinceReport += frames;
    if (this.framesSinceReport >= sampleRate / 20) {
      this.framesSinceReport %= Math.max(1, Math.round(sampleRate / 20));
      this.port.postMessage({ type: 'reduction', value: this.reductionDb });
    }
    return true;
  }
}
registerProcessor('compressor-processor', CompressorProcessor);
`;
