// Runs in the audio rendering thread so protection remains active in hidden tabs.
export const howlGuardProcessorSource = `
class HowlGuardProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.stableFrames = 0;
    this.previousRms = 0;
    this.previousCrossings = 0;
    this.previousSample = 0;
    this.power = 0;
    this.crossings = 0;
    this.frames = 0;
    this.tripped = false;
    this.port.onmessage = ({data}) => { this.enabled = Boolean(data.enabled); this.stableFrames = 0; };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    // Monitor whichever input channel has the strongest signal, including right-only sources.
    let samples = input[0];
    let strongest = -1;
    for (const channel of input) {
      let energy = 0;
      for (const value of channel) energy += value * value;
      if (energy > strongest) { strongest = energy; samples = channel; }
    }
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      this.power += sample * sample;
      if ((sample >= 0) !== (this.previousSample >= 0)) this.crossings++;
      this.previousSample = sample;
    }
    this.frames += samples.length;
    // Compare windows of about 100 ms to avoid phase-dependent block measurements.
    if (this.frames >= sampleRate * 0.1) {
      const rms = Math.sqrt(this.power / this.frames);
      const stable = rms > 0.08 && Math.abs(rms - this.previousRms) < Math.max(0.007, rms * 0.08)
        && Math.abs(this.crossings - this.previousCrossings) <= 2 && this.crossings >= 8;
      this.stableFrames = this.enabled && stable ? this.stableFrames + this.frames : 0;
      this.previousRms = rms; this.previousCrossings = this.crossings;
      this.power = 0; this.crossings = 0; this.frames = 0;
      if (!this.tripped && this.stableFrames > sampleRate * 1.5) {
        this.tripped = true;
        this.port.postMessage({type: 'howl'});
      }
    }
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] || input[0];
      if (this.tripped || !source) output[channel].fill(0);
      else output[channel].set(source);
    }
    return true;
  }
}
registerProcessor('howl-guard', HowlGuardProcessor);
`;
