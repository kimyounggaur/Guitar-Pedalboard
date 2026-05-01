export const noiseGateProcessorSource = `
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thresholdDb', defaultValue: -55, minValue: -80, maxValue: -20, automationRate: 'k-rate' },
      { name: 'reductionDb', defaultValue: -80, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attackMs', defaultValue: 6, minValue: 1, maxValue: 50, automationRate: 'k-rate' },
      { name: 'holdMs', defaultValue: 70, minValue: 0, maxValue: 300, automationRate: 'k-rate' },
      { name: 'releaseMs', defaultValue: 180, minValue: 20, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'hysteresisDb', defaultValue: 4, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.envelope = 0;
    this.gateGain = 0;
    this.targetOpen = false;
    this.holdSamples = 0;
    this.framesUntilStatePost = 0;
    this.state = 'Closed';
  }

  getParam(parameters, name, index) {
    const values = parameters[name];
    return values.length > 1 ? values[index] : values[0];
  }

  setState(state) {
    if (state !== this.state) {
      this.state = state;
      this.port.postMessage({ type: 'gate-state', state });
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const frames = output[0].length;
    const envelopeCoeff = Math.exp(-1 / (sampleRate * 0.008));

    for (let i = 0; i < frames; i += 1) {
      const thresholdDb = this.getParam(parameters, 'thresholdDb', i);
      const reductionDb = this.getParam(parameters, 'reductionDb', i);
      const attackMs = Math.max(1, this.getParam(parameters, 'attackMs', i));
      const holdMs = Math.max(0, this.getParam(parameters, 'holdMs', i));
      const releaseMs = Math.max(20, this.getParam(parameters, 'releaseMs', i));
      const hysteresisDb = Math.max(0, this.getParam(parameters, 'hysteresisDb', i));
      let peak = 0;

      for (let channel = 0; channel < input.length; channel += 1) {
        peak = Math.max(peak, Math.abs(input[channel][i] || 0));
      }

      this.envelope = Math.max(peak, this.envelope * envelopeCoeff);
      const envelopeDb = 20 * Math.log10(this.envelope + 0.000001);

      if (envelopeDb > thresholdDb) {
        this.targetOpen = true;
        this.holdSamples = Math.floor((holdMs / 1000) * sampleRate);
      } else if (envelopeDb < thresholdDb - hysteresisDb) {
        if (this.holdSamples > 0) {
          this.holdSamples -= 1;
        } else {
          this.targetOpen = false;
        }
      }

      const closedGain = Math.pow(10, reductionDb / 20);
      const targetGain = this.targetOpen ? 1 : closedGain;
      const timeSeconds = this.targetOpen ? attackMs / 1000 : releaseMs / 1000;
      const coeff = Math.exp(-1 / (sampleRate * timeSeconds));
      this.gateGain = targetGain + (this.gateGain - targetGain) * coeff;

      if (this.targetOpen || this.gateGain > 0.85) {
        this.setState('Open');
      } else if (this.gateGain > closedGain + 0.02) {
        this.setState('Closing');
      } else {
        this.setState('Closed');
      }

      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        output[channel][i] = (source[i] || 0) * this.gateGain;
      }
    }

    this.framesUntilStatePost -= frames;
    if (this.framesUntilStatePost <= 0) {
      this.framesUntilStatePost = Math.floor(sampleRate / 20);
      this.port.postMessage({ type: 'gate-state', state: this.state });
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
`;
