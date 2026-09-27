export const tunerProcessorSource = `
const TUNER_BUFFER_SIZE = 4096;
const TUNER_RMS_THRESHOLD = 0.008;
const TUNER_MIN_FREQUENCY = 70;
const TUNER_MAX_FREQUENCY = 1400;
const TUNER_PEAK_THRESHOLD = 0.85;
const TUNER_MIN_CLARITY = 0.6;
const TUNER_POST_INTERVAL_SECONDS = 0.1;
const TUNER_STABLE_TIMEOUT_SECONDS = 0.4;
const TUNER_ANALYSIS_RATE_CAP = 24000;
const TUNER_ANALYSIS_BUDGET_SECONDS = 0.075;
const RENDER_QUANTUM_FRAMES = 128;

class TunerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.decimationFactor = Math.max(1, Math.ceil(sampleRate / TUNER_ANALYSIS_RATE_CAP));
    this.analysisSampleRate = sampleRate / this.decimationFactor;
    const lowPassFrequency = Math.min(5000, this.analysisSampleRate * 0.4);
    this.lowPassAlpha = 1 - Math.exp((-2 * Math.PI * lowPassFrequency) / sampleRate);
    this.ring = new Float32Array(TUNER_BUFFER_SIZE);
    this.snapshot = new Float32Array(TUNER_BUFFER_SIZE);
    this.prefixEnergy = new Float64Array(TUNER_BUFFER_SIZE + 1);
    this.minimumLag = Math.max(2, Math.floor(this.analysisSampleRate / TUNER_MAX_FREQUENCY));
    this.maximumLag = Math.min(
      TUNER_BUFFER_SIZE - 3,
      Math.ceil(this.analysisSampleRate / TUNER_MIN_FREQUENCY),
    );
    this.analysisLimit = this.maximumLag + 1;
    this.nsdf = new Float32Array(this.analysisLimit + 1);
    this.history = new Float64Array(3);
    this.postIntervalFrames = Math.max(1, Math.round(sampleRate * TUNER_POST_INTERVAL_SECONDS));
    this.stableTimeoutFrames = Math.max(1, Math.round(sampleRate * TUNER_STABLE_TIMEOUT_SECONDS));
    const analysisQuantumBudget = Math.max(
      1,
      Math.floor((sampleRate * TUNER_ANALYSIS_BUDGET_SECONDS) / RENDER_QUANTUM_FRAMES),
    );
    this.lagsPerQuantum = Math.max(
      1,
      Math.ceil(this.analysisLimit / analysisQuantumBudget),
    );
    this.awake = false;
    this.disposed = false;
    this.sessionId = 0;
    this.processedFrames = 0;
    this.resetAnalysisState();

    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'dispose') {
        this.sessionId = Number.isFinite(message.sessionId) ? message.sessionId : this.sessionId;
        this.awake = false;
        this.disposed = true;
        this.port.postMessage({ type: 'disposed', sessionId: this.sessionId });
        return;
      }

      if (this.disposed || (message.type !== 'wake' && message.type !== 'sleep')) return;

      this.sessionId = Number.isFinite(message.sessionId) ? message.sessionId : 0;
      this.awake = message.type === 'wake';
      this.resetAnalysisState();

      if (!this.awake) {
        this.postFrequency(null);
      }
    };
  }

  resetAnalysisState() {
    this.ring.fill(0);
    this.snapshot.fill(0);
    this.prefixEnergy.fill(0);
    this.nsdf.fill(0);
    this.history.fill(0);
    this.writeIndex = 0;
    this.filledSamples = 0;
    this.ringSum = 0;
    this.ringEnergy = 0;
    this.lowPassStageOne = 0;
    this.lowPassStageTwo = 0;
    this.decimationSum = 0;
    this.decimationCount = 0;
    this.framesSinceAnalysis = 0;
    this.analysisRunning = false;
    this.analysisLag = 1;
    this.historyCount = 0;
    this.historyIndex = 0;
    this.stableFrequency = null;
    this.lastStableFrame = this.processedFrames;
  }

  process(inputs) {
    if (this.disposed) return false;
    if (!this.awake) return true;

    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const frameCount = input[0].length;
    const strongestChannel = this.getStrongestChannel(input, frameCount);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const sample = strongestChannel[frame] || 0;
      this.lowPassStageOne += this.lowPassAlpha * (sample - this.lowPassStageOne);
      this.lowPassStageTwo +=
        this.lowPassAlpha * (this.lowPassStageOne - this.lowPassStageTwo);
      this.decimationSum += this.lowPassStageTwo;
      this.decimationCount += 1;

      if (this.decimationCount >= this.decimationFactor) {
        this.pushSample(this.decimationSum / this.decimationCount);
        this.decimationSum = 0;
        this.decimationCount = 0;
      }
    }

    this.processedFrames += frameCount;
    this.framesSinceAnalysis += frameCount;

    if (this.analysisRunning) {
      this.advanceAnalysis();
      return true;
    }

    if (
      this.filledSamples === TUNER_BUFFER_SIZE &&
      this.framesSinceAnalysis >= this.postIntervalFrames
    ) {
      this.beginAnalysis();
      if (this.analysisRunning) {
        this.advanceAnalysis();
      }
    }

    return true;
  }

  getStrongestChannel(input, frameCount) {
    let strongestChannel = input[0];
    let strongestEnergy = -1;

    for (let channel = 0; channel < input.length; channel += 1) {
      const samples = input[channel];
      let energy = 0;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const sample = samples[frame] || 0;
        energy += sample * sample;
      }

      if (energy > strongestEnergy) {
        strongestEnergy = energy;
        strongestChannel = samples;
      }
    }

    return strongestChannel;
  }

  pushSample(sample) {
    const replaced = this.ring[this.writeIndex];
    this.ringSum += sample - replaced;
    this.ringEnergy += sample * sample - replaced * replaced;
    this.ring[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % TUNER_BUFFER_SIZE;
    this.filledSamples = Math.min(TUNER_BUFFER_SIZE, this.filledSamples + 1);
  }

  beginAnalysis() {
    this.framesSinceAnalysis = 0;
    const mean = this.ringSum / TUNER_BUFFER_SIZE;
    const variance = Math.max(0, this.ringEnergy / TUNER_BUFFER_SIZE - mean * mean);

    if (Math.sqrt(variance) < TUNER_RMS_THRESHOLD) {
      this.handleMissingPitch();
      return;
    }

    this.prefixEnergy[0] = 0;
    for (let index = 0; index < TUNER_BUFFER_SIZE; index += 1) {
      const value = this.ring[(this.writeIndex + index) % TUNER_BUFFER_SIZE] - mean;
      this.snapshot[index] = value;
      this.prefixEnergy[index + 1] = this.prefixEnergy[index] + value * value;
    }

    this.analysisLag = 1;
    this.analysisRunning = true;
  }

  advanceAnalysis() {
    const endLag = Math.min(
      this.analysisLimit,
      this.analysisLag + this.lagsPerQuantum - 1,
    );

    for (let lag = this.analysisLag; lag <= endLag; lag += 1) {
      const overlap = TUNER_BUFFER_SIZE - lag;
      let correlation = 0;

      for (let index = 0; index < overlap; index += 1) {
        correlation += this.snapshot[index] * this.snapshot[index + lag];
      }

      const firstEnergy = this.prefixEnergy[overlap];
      const secondEnergy =
        this.prefixEnergy[TUNER_BUFFER_SIZE] - this.prefixEnergy[lag];
      const denominator = firstEnergy + secondEnergy;
      this.nsdf[lag] = denominator > 1e-12 ? (2 * correlation) / denominator : 0;
    }

    this.analysisLag = endLag + 1;
    if (this.analysisLag > this.analysisLimit) {
      this.analysisRunning = false;
      this.finishAnalysis();
    }
  }

  finishAnalysis() {
    const globalMaximum = this.findGlobalKeyMaximum();

    if (globalMaximum < TUNER_MIN_CLARITY) {
      this.handleMissingPitch();
      return;
    }

    const selectedLag = this.findFirstKeyMaximum(globalMaximum * TUNER_PEAK_THRESHOLD);
    if (selectedLag < 0) {
      this.handleMissingPitch();
      return;
    }

    const previous = this.nsdf[selectedLag - 1];
    const center = this.nsdf[selectedLag];
    const next = this.nsdf[selectedLag + 1];
    const denominator = previous - 2 * center + next;
    let adjustment = 0;

    if (Math.abs(denominator) > 1e-12) {
      adjustment = 0.5 * (previous - next) / denominator;
      adjustment = Math.max(-1, Math.min(1, adjustment));
    }

    const refinedLag = selectedLag + adjustment;
    const frequency = this.analysisSampleRate / refinedLag;

    if (
      !Number.isFinite(frequency) ||
      frequency < TUNER_MIN_FREQUENCY ||
      frequency > TUNER_MAX_FREQUENCY
    ) {
      this.handleMissingPitch();
      return;
    }

    this.handleDetectedPitch(frequency);
  }

  findGlobalKeyMaximum() {
    let lag = 1;
    let globalMaximum = 0;

    while (lag <= this.maximumLag && this.nsdf[lag] > 0) lag += 1;

    while (lag <= this.maximumLag) {
      while (lag <= this.maximumLag && this.nsdf[lag] <= 0) lag += 1;
      let peakLag = -1;
      let peakValue = Number.NEGATIVE_INFINITY;

      while (lag <= this.maximumLag && this.nsdf[lag] > 0) {
        if (this.nsdf[lag] > peakValue) {
          peakValue = this.nsdf[lag];
          peakLag = lag;
        }
        lag += 1;
      }

      if (peakLag >= this.minimumLag) {
        globalMaximum = Math.max(globalMaximum, peakValue);
      }
    }

    return globalMaximum;
  }

  findFirstKeyMaximum(cutoff) {
    let lag = 1;

    while (lag <= this.maximumLag && this.nsdf[lag] > 0) lag += 1;

    while (lag <= this.maximumLag) {
      while (lag <= this.maximumLag && this.nsdf[lag] <= 0) lag += 1;
      let peakLag = -1;
      let peakValue = Number.NEGATIVE_INFINITY;

      while (lag <= this.maximumLag && this.nsdf[lag] > 0) {
        if (this.nsdf[lag] > peakValue) {
          peakValue = this.nsdf[lag];
          peakLag = lag;
        }
        lag += 1;
      }

      if (peakLag >= this.minimumLag && peakValue >= cutoff) return peakLag;
    }

    return -1;
  }

  handleDetectedPitch(frequency) {
    this.history[this.historyIndex] = frequency;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    this.historyCount = Math.min(this.history.length, this.historyCount + 1);

    if (this.historyCount < this.history.length) {
      this.postFrequency(null);
      return;
    }

    const first = this.history[0];
    const second = this.history[1];
    const third = this.history[2];
    const candidate =
      first + second + third - Math.min(first, second, third) - Math.max(first, second, third);

    if (
      this.stableFrequency !== null &&
      this.processedFrames - this.lastStableFrame >= this.stableTimeoutFrames
    ) {
      this.stableFrequency = null;
    }

    if (this.stableFrequency !== null) {
      const ratio = candidate / this.stableFrequency;
      const octaveUp = ratio >= 1.9 && ratio <= 2.1;
      const octaveDown = ratio >= 0.48 && ratio <= 0.52;

      if (octaveUp || octaveDown) {
        this.postFrequency(this.stableFrequency);
        return;
      }
    }

    this.stableFrequency = candidate;
    this.lastStableFrame = this.processedFrames;
    this.postFrequency(candidate);
  }

  handleMissingPitch() {
    this.historyCount = 0;
    this.historyIndex = 0;

    if (
      this.stableFrequency !== null &&
      this.processedFrames - this.lastStableFrame >= this.stableTimeoutFrames
    ) {
      this.stableFrequency = null;
    }

    this.postFrequency(null);
  }

  postFrequency(frequency) {
    this.port.postMessage({
      type: 'pitch',
      sessionId: this.sessionId,
      frequency,
    });
  }
}

registerProcessor('tuner-processor', TunerProcessor);
`;
