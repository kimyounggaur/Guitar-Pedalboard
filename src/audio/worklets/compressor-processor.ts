/**
 * Zero-lookahead, stereo-linked compressor. Gain reduction is reported in dB.
 *
 * 두 경로가 한 클래스에 있다(processorOptions.version, 설계서 S3.6 의 기능 플래그 newCompressor).
 *  - 1(옛 경로, 기본): 순간 피크 검출기 + 자동 메이크업(최대 +12 dB), 감소량을 20 Hz 로 보고한다. 청취 승인 전까지 소리가 그대로다.
 *  - 2(새 경로): 5 ms RMS 검출기(기본, 'peak' 도 고를 수 있다) + 자동 메이크업 없음 + 감소량을 30 Hz 로 보고한다.
 *    정현파에서 RMS 검출기가 피크 검출기와 같은 레벨을 읽도록 √2 를 곱해 맞춘다(문턱 값의 뜻이 같다).
 * 옛 경로는 다음 릴리스에서 지운다(REFACTOR_LOG L-248).
 */
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
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.version = settings.version === 2 ? 2 : 1;
    this.detector = settings.detector === 'peak' ? 'peak' : 'rms';
    this.reductionDb = 0;
    this.makeupDb = 0;
    this.meanSquare = 0;
    this.framesSinceReport = 0;
    this.disposed = false;
    this.port.onmessage = (event) => { if (event.data?.type === 'dispose') this.disposed = true; };
  }
  process(inputs, outputs, parameters) {
    if (this.disposed) return false;
    if (!inputs[0] || inputs[0].length === 0) return this.rest();
    this.rested = false;
    return this.version === 2 ? this.processV2(inputs, outputs, parameters) : this.processV1(inputs, outputs, parameters);
  }
  // Input disconnected (pedal off, S4.2): clear the state once, then do nothing until an input is reconnected.
  // Never return false here: in Chromium a processor that returned false is never called again, even after the input is reconnected.
  rest() {
    if (this.rested) return true;
    this.rested = true;
    const wasReducing = this.reductionDb !== 0;
    this.meanSquare = 0;
    this.makeupDb = 0;
    this.reductionDb = 0;
    this.framesSinceReport = 0;
    if (wasReducing) this.port.postMessage({ type: 'reduction', value: 0 });
    return true;
  }
  processV2(inputs, outputs, parameters) {
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
    const rmsCoef = Math.exp(-1 / (.005 * sampleRate));
    const usePeak = this.detector === 'peak';
    for (let i = 0; i < frames; i++) {
      // Linked detector: use the loudest channel; non-finite samples count as silence.
      let peak = 0;
      for (let ch = 0; ch < input.length; ch++) {
        const sample = input[ch]?.[i] ?? 0;
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
      }
      let level;
      if (usePeak) {
        level = 20 * Math.log10(Math.max(peak, 1e-12));
      } else {
        this.meanSquare = peak * peak + rmsCoef * (this.meanSquare - peak * peak);
        level = 10 * Math.log10(Math.max(2 * this.meanSquare, 1e-24));
      }
      const target = reductionForLevel(level, threshold, knee, ratio);
      const coef = target < this.reductionDb ? attackCoef : releaseCoef;
      this.reductionDb = target + coef * (this.reductionDb - target);
      const gain = Math.pow(10, this.reductionDb / 20);
      for (let ch = 0; ch < output.length; ch++) {
        const sample = input[ch]?.[i] ?? input[0]?.[i] ?? 0;
        output[ch][i] = Number.isFinite(sample) ? sample * gain : 0;
      }
    }
    this.framesSinceReport += frames;
    if (this.framesSinceReport >= sampleRate / 30) {
      this.framesSinceReport %= Math.max(1, Math.round(sampleRate / 30));
      this.port.postMessage({ type: 'reduction', value: this.reductionDb });
    }
    return true;
  }
  processV1(inputs, outputs, parameters) {
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
