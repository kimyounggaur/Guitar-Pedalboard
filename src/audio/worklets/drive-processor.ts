export const driveProcessorSource = `
class DriveProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'drive',
        defaultValue: 0.45,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const frames = output[0].length;

    for (let i = 0; i < frames; i += 1) {
      const drive = parameters.drive.length > 1 ? parameters.drive[i] : parameters.drive[0];
      const amount = 1 + drive * 42;
      const normalizer = Math.tanh(amount);

      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        const sample = source[i] || 0;
        output[channel][i] = Math.tanh(sample * amount) / normalizer;
      }
    }

    return true;
  }
}

registerProcessor('drive-processor', DriveProcessor);
`;
