// Deterministic steady-state reference analysis of the production IR generator.
// Measures generated IRs with normalize=false; prints the spec's legacy normalization
// for comparison. Excludes browser rendering and CabEffect high/low/presence filters. Run: node scripts/cabinet-response-analysis.mjs
import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/audio/utils/cabinet.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createCabinet, createCabinetImpulse, CAB_LEVEL_TRIM_DB, MAX_CAB_MAKEUP_DB } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
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

// S1.4b: IR 의 피크 상한(+8 dB) 때문에 못 채운 기준 음량은 합성 경로의 보충 이득(makeupDb)으로 채운다.
// 기준 음량(위 referenceDb)에 보충분을 더하면 어떤 마이크 위치·거리에서도 0 dB 가 되어야 하고(모델별 보정표는 뺀다),
// 보충량은 상한(MAX_CAB_MAKEUP_DB) 안에 있어야 한다. 위의 시험(IR 피크 ≤ 8 dB)은 그대로 지켜진다.
function referenceGainDb(samples) {
  let inputEnergy = 0, outputEnergy = 0;
  for (const fundamental of fundamentals) for (let harmonic = 1; harmonic <= 16; harmonic++) {
    if (fundamental * harmonic >= sampleRate / 2) continue;
    const weight = 1 / harmonic ** 2;
    inputEnergy += weight;
    outputEnergy += weight * magnitude(samples, fundamental * harmonic) ** 2;
  }
  return db(Math.sqrt(outputEnergy / inputEnergy));
}
for (const [model, trim] of Object.entries(CAB_LEVEL_TRIM_DB)) {
  assert.ok(models.includes(model), `보정표에 모르는 모델이 있습니다: ${model}`);
  assert.ok(Math.abs(trim) <= 1, `${model}: 모델별 보정은 ±1 dB 안이어야 합니다(${trim})`);
}
assert.deepEqual(Object.keys(CAB_LEVEL_TRIM_DB).sort(), [...models].sort(), '보정표가 모든 모델을 덮어야 합니다');
let largestMakeup = 0, boundCases = 0, scanned = 0;
for (sampleRate of [44100, 48000]) for (const model of models) for (const mic of [0, 25, 55, 75, 100]) for (const distance of [0, 30, 75, 100]) {
  const { impulse, makeupDb } = createCabinet(context, model, mic, distance);
  const shortfallDb = makeupDb - CAB_LEVEL_TRIM_DB[model];
  const effectiveDb = referenceGainDb(impulse.getChannelData(0)) + shortfallDb;
  const label = `${model} ${sampleRate}/${mic}/${distance}`;
  assert.ok(Math.abs(effectiveDb) <= 0.02, `${label}: 보충 뒤 기준 음량 ${effectiveDb.toFixed(3)} dB`);
  assert.ok(shortfallDb >= -1e-9, `${label}: 보충량은 음수일 수 없습니다(${shortfallDb})`);
  assert.ok(makeupDb <= MAX_CAB_MAKEUP_DB + 1e-9, `${label}: 보충 ${makeupDb.toFixed(2)} dB 가 상한 ${MAX_CAB_MAKEUP_DB} dB 를 넘습니다`);
  largestMakeup = Math.max(largestMakeup, makeupDb);
  if (shortfallDb > 0.05) boundCases += 1;
  scanned += 1;
}
assert.equal(createCabinet(context, 'off', 55, 30).makeupDb, 0, '끈 상태는 보충하지 않는다');
assert.ok(boundCases > 0, '피크 상한이 걸리는 조합이 하나도 없으면 이 시험이 보충 경로를 확인하지 못한다');
console.log(`Cabinet make-up gain: ${scanned} combinations, ${boundCases} need a make-up above 0.05 dB (largest ${largestMakeup.toFixed(2)} dB incl. model table), reference level restored to 0 dB in all.`);
