export const envelopeFollowerProcessorSource = String.raw`
const ATTACK_SECONDS = 0.005;
const RELEASE_SECONDS = 0.12;
const MIN_SENSITIVITY_SCALE = 1;
const MAX_SENSITIVITY_SCALE = 8;

class EnvelopeFollowerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'sensitivity',
        defaultValue: 55,
        minValue: 0,
        maxValue: 100,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.envelope = 0;
    this.disposed = false;
    this.attackCoefficient = Math.exp(-1 / (sampleRate * ATTACK_SECONDS));
    this.releaseCoefficient = Math.exp(-1 / (sampleRate * RELEASE_SECONDS));
    this.port.onmessage = (event) => {
      if (event.data?.type === 'dispose') {
        this.disposed = true;
        this.port.postMessage({ type: 'disposed' });
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (this.disposed) return false;

    const input = inputs[0];
    const audioOutput = outputs[0];
    const controlOutput = outputs[1];
    const sensitivityValues = parameters.sensitivity;
    const frameCount = audioOutput[0]?.length ?? controlOutput[0]?.length ?? 128;

    for (let channelIndex = 0; channelIndex < audioOutput.length; channelIndex += 1) {
      const outputChannel = audioOutput[channelIndex];
      const inputChannel = input[channelIndex] ?? input[0];
      for (let frame = 0; frame < frameCount; frame += 1) {
        const sample = inputChannel?.[frame] ?? 0;
        outputChannel[frame] = Number.isFinite(sample) ? sample : 0;
      }
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      let peak = 0;
      for (let channelIndex = 0; channelIndex < input.length; channelIndex += 1) {
        const sample = input[channelIndex]?.[frame] ?? 0;
        const magnitude = Number.isFinite(sample) ? Math.abs(sample) : 0;
        if (magnitude > peak) peak = magnitude;
      }

      const coefficient = peak > this.envelope
        ? this.attackCoefficient
        : this.releaseCoefficient;
      this.envelope = peak + coefficient * (this.envelope - peak);

      const sensitivity = sensitivityValues.length > 1
        ? sensitivityValues[frame]
        : sensitivityValues[0];
      const safeSensitivity = Number.isFinite(sensitivity)
        ? Math.min(100, Math.max(0, sensitivity))
        : 55;
      const sensitivityScale = MIN_SENSITIVITY_SCALE +
        (MAX_SENSITIVITY_SCALE - MIN_SENSITIVITY_SCALE) * (safeSensitivity / 100);
      const control = Math.min(1, Math.max(0, this.envelope * sensitivityScale));

      for (let channelIndex = 0; channelIndex < controlOutput.length; channelIndex += 1) {
        controlOutput[channelIndex][frame] = control;
      }
    }

    return true;
  }
}

registerProcessor('envelope-follower-processor', EnvelopeFollowerProcessor);
`;
