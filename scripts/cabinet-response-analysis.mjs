// Deterministic steady-state reference analysis of the production IR generator.
// Measures generated IRs with normalize=false; prints the spec's legacy normalization
// for comparison. Excludes browser rendering and CabEffect high/low/presence filters. Run: node scripts/cabinet-response-analysis.mjs
import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/audio/utils/cabinet.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createCabinetImpulse } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let sampleRate = 48000;
const context = { get sampleRate() { return sampleRate; }, createBuffer(channels, length, rate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate: rate, getChannelData(channel) { return data[channel]; } };
} };
// Web Audio 1.0 ConvolverNode normalization (W3C Recommendation, 17 June 2021).
function normalization(buffer) {
  let sum = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    for (const sample of buffer.getChannelData(channel)) sum += sample * sample;
  }
  const power = Math.max(0.000125, Math.sqrt(sum / (buffer.numberOfChannels * buffer.length)));
  return 0.00125 * 44100 / buffer.sampleRate / power * (buffer.numberOfChannels === 4 ? 0.5 : 1);
}
function magnitude(samples, hz) {
  const omega = -2 * Math.PI * hz / sampleRate;
  const stepRe = Math.cos(omega), stepIm = Math.sin(omega);
  let re = 1, im = 0, sumRe = 0, sumIm = 0;
  for (const value of samples) {
    sumRe += value * re; sumIm += value * im;
    const next = re * stepRe - im * stepIm;
    im = re * stepIm + im * stepRe; re = next;
  }
  return Math.hypot(sumRe, sumIm);
}
const db = (value) => 20 * Math.log10(value);
// Six equal-energy guitar strings, with 1/h harmonic amplitude weighting;
// assumes long independent tones, not a recording of a guitarist or a power chord.
const fundamentals = [82.4069, 110, 146.8324, 195.9977, 246.9417, 329.6276];
const models = ['v30-4x12', 'greenback-4x12', 'blue-1x12', 'jensen-1x12', 'tweed-1x10'];
for (sampleRate of [44100, 48000, 96000]) for (const [mic, distance] of [[55, 30], [0, 0], [0, 100], [100, 0], [100, 100]]) for (const model of models) {
  const buffer = createCabinetImpulse(context, model, mic, distance);
  const samples = buffer.getChannelData(0);
  assert.deepEqual(samples, buffer.getChannelData(1));
  const scale = 1; // Generated cabinets set ConvolverNode.normalize=false.
  const legacyScale = normalization(buffer);
  let inputEnergy = 0, outputEnergy = 0;
  for (const fundamental of fundamentals) for (let harmonic = 1; harmonic <= 16; harmonic++) {
    const weight = 1 / harmonic ** 2;
    inputEnergy += weight;
    outputEnergy += weight * (magnitude(samples, fundamental * harmonic) * scale) ** 2;
  }
  let peak = 0, peakHz = 0;
  for (let hz = 20; hz <= 12000; hz += 5) {
    const gain = magnitude(samples, hz) * scale;
    if (gain > peak) { peak = gain; peakHz = hz; }
  }
  const referenceDb = db(Math.sqrt(outputEnergy / inputEnergy));
  assert.ok(Number.isFinite(referenceDb) && Number.isFinite(peak));
  assert.ok(db(peak) <= 8, `${model} ${sampleRate}/${mic}/${distance}: peak ${db(peak)}`);
  assert.ok(referenceDb > -5 && referenceDb <= 0.02, `${model} ${sampleRate}/${mic}/${distance}: reference ${referenceDb}`);
  console.log(`${sampleRate} Hz mic ${mic} distance ${distance} ${model}: reference ${referenceDb.toFixed(2)} dB, max ${db(peak).toFixed(2)} dB at ${peakHz} Hz (legacy normalization scale ${legacyScale.toFixed(6)})`);
}
