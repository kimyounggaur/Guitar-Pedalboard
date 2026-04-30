export const noiseGateProcessorSource = `
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'threshold',
        defaultValue: -55,
        minValue: -90,
        maxValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'release',
        defaultValue: 0.08,
        minValue: 0.01,
        maxValue: 0.5,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.gateGain = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const frames = output[0].length;
    const attackCoeff = Math.exp(-1 / (sampleRate * 0.004));

    for (let i = 0; i < frames; i += 1) {
      const threshold = parameters.threshold.length > 1 ? parameters.threshold[i] : parameters.threshold[0];
      const release = parameters.release.length > 1 ? parameters.release[i] : parameters.release[0];
      const releaseCoeff = Math.exp(-1 / (sampleRate * Math.max(0.01, release)));
      let peak = 0;

      for (let channel = 0; channel < input.length; channel += 1) {
        peak = Math.max(peak, Math.abs(input[channel][i] || 0));
      }

      const db = 20 * Math.log10(peak + 0.000001);
      const target = db >= threshold ? 1 : 0;
      const coeff = target > this.gateGain ? attackCoeff : releaseCoeff;
      this.gateGain = target + (this.gateGain - target) * coeff;

      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        output[channel][i] = (source[i] || 0) * this.gateGain;
      }
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
`;
