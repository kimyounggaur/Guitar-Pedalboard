// S2.2 Fuzz Gate(D15) — 워클릿 수준의 시험.
// Fuzz 의 Gate 는 Noise Gate 와 같은 워클릿(noise-gate-processor)을 퍼즈 앞에 하나 더 끼워 쓴다.
// 이 시험은 워클릿 소스를 Node 의 vm 에서 직접 돌려 다음을 확인한다.
//   1. 옵션 없이 만든 워클릿(= Noise Gate 페달)은 이 Step 이전과 비트 단위로 같게 동작한다(고정한 지문과 같은지).
//   2. 옵션 { startOpen, silent }: 열린 채로 시작하고 포트 메시지를 보내지 않는다.
//   3. Gate 0(reductionDb 0): 입력을 한 샘플도 바꾸지 않는다(모노·스테레오).
//   4. Gate 가 켜져 있을 때: 문턱 아래 잡음은 80 dB 가까이 줄고, 문턱 위 소리는 그대로 지나며, 히스테리시스·홀드가 지켜진다.
//   5. 값 → 문턱·줄이는 크기 대응(fuzzGateThresholdDb, fuzzGateWorkletSettings)과 FuzzEffect 의 배선(소스 확인).
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const harnessBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { noiseGateProcessorSource } from './audio/worklets/noise-gate-processor.ts';",
      "export { FUZZ_GATE_ATTACK_MS, FUZZ_GATE_CLOSED_REDUCTION_DB, FUZZ_GATE_HOLD_MS, FUZZ_GATE_HYSTERESIS_DB, FUZZ_GATE_MAX_THRESHOLD_DB, FUZZ_GATE_MIN_THRESHOLD_DB, FUZZ_GATE_RELEASE_MS, fuzzGateThresholdDb, fuzzGateWorkletSettings } from './audio/params/definitions/fuzz.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'fuzz-gate-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const {
  noiseGateProcessorSource,
  FUZZ_GATE_ATTACK_MS, FUZZ_GATE_CLOSED_REDUCTION_DB, FUZZ_GATE_HOLD_MS, FUZZ_GATE_HYSTERESIS_DB,
  FUZZ_GATE_MAX_THRESHOLD_DB, FUZZ_GATE_MIN_THRESHOLD_DB, FUZZ_GATE_RELEASE_MS, fuzzGateThresholdDb, fuzzGateWorkletSettings,
} = await import(`data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`);

let checks = 0;
const ok = (condition, message) => {
  checks += 1;
  assert.ok(condition, message);
};
const equal = (actual, expected, message) => {
  checks += 1;
  assert.equal(actual, expected, message);
};
const deepEqual = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};

// ---------------------------------------------------------------------------------------------
// 도구: 워클릿 소스를 vm 에서 돌린다
// ---------------------------------------------------------------------------------------------
const QUANTUM = 128;

function createGate(sampleRate, options) {
  const posted = [];
  const scope = {
    sampleRate,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (message) => posted.push(message) };
      }
    },
    registerProcessor(name, ctor) {
      scope.registeredName = name;
      scope.ctor = ctor;
    },
  };
  vm.runInNewContext(noiseGateProcessorSource, scope);
  equal(scope.registeredName, 'noise-gate-processor', '등록 이름');
  const processor = options === undefined ? new scope.ctor() : new scope.ctor(options);
  return { processor, scope, posted, frame: 0 };
}

/**
 * 입력 채널들을 128샘플씩 처리해 출력 채널들을 돌려준다.
 * params 는 블록 번호 → { thresholdDb, reductionDb, … }. 없는 값은 워클릿 기본값을 쓴다.
 */
function run(gate, channels, params, { quantum = QUANTUM } = {}) {
  const defaults = { thresholdDb: -55, reductionDb: -80, attackMs: 6, holdMs: 70, releaseMs: 180, hysteresisDb: 4 };
  const length = channels[0].length;
  const out = channels.map(() => new Float32Array(length));
  for (let start = 0; start < length; start += quantum) {
    const frames = Math.min(quantum, length - start);
    const blockParams = { ...defaults, ...(typeof params === 'function' ? params(start / quantum) : params) };
    const parameters = Object.fromEntries(Object.entries(blockParams).map(([name, value]) => [name, new Float32Array([value])]));
    const inputs = [channels.map((channel) => channel.slice(start, start + frames))];
    const outputs = [channels.map(() => new Float32Array(frames))];
    gate.scope.currentFrame = gate.frame + start;
    const keepAlive = gate.processor.process(inputs, outputs, parameters);
    ok(keepAlive === true, 'process 는 true 를 돌려준다');
    outputs[0].forEach((block, channel) => out[channel].set(block, start));
  }
  gate.frame += length;
  return out;
}

/** 시험용 결정적 의사난수(−1~1). */
function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

const dbToLinear = (db) => 10 ** (db / 20);

/** 가우시안 백색잡음(Box–Muller). rmsDb 에 맞춘다. */
function gaussianNoise(sampleRate, seconds, rmsDbfs, seed) {
  const random = createRng(seed);
  const unit = () => (random() + 1) / 2;
  const out = new Float32Array(Math.round(sampleRate * seconds));
  const raw = new Float64Array(out.length);
  let sumSquares = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(Math.max(unit(), 1e-12)));
    const angle = 2 * Math.PI * unit();
    raw[i] = radius * Math.cos(angle);
    if (i + 1 < raw.length) raw[i + 1] = radius * Math.sin(angle);
  }
  for (let i = 0; i < raw.length; i += 1) sumSquares += raw[i] * raw[i];
  const scale = dbToLinear(rmsDbfs) / Math.sqrt(sumSquares / raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] * scale;
  return out;
}

const peakDbOf = (samples) => 20 * Math.log10(samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) + 1e-12);
const mismatches = (a, b) => {
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) count += 1;
  return count;
};
/** 한 구간(초)의 길이를 128 샘플 블록의 배수로 맞춘다. */
const blocksOf = (sampleRate, seconds) => Math.round((seconds * sampleRate) / QUANTUM) * QUANTUM;
const burst = (sampleRate, seconds, peakDbfs, seed) => segments(sampleRate, [{ seconds: blocksOf(sampleRate, seconds) / sampleRate, peakDb: peakDbfs }], seed);
const silence = (sampleRate, seconds) => new Float32Array(blocksOf(sampleRate, seconds));
const steady = (sampleRate, seconds, peakDbfs) => {
  const out = new Float32Array(blocksOf(sampleRate, seconds));
  const amplitude = dbToLinear(peakDbfs);
  for (let i = 0; i < out.length; i += 1) out[i] = i % 2 === 0 ? amplitude : -amplitude;
  return out;
};
const rmsDb = (samples, start = 0, end = samples.length) => {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / Math.max(1, end - start) + 1e-30);
};

/** [{seconds, peakDb}] 구간들을 이어 붙인 잡음 신호. peakDb 는 구간 안의 최대 크기(dBFS). */
function segments(sampleRate, parts, seed) {
  const random = createRng(seed);
  const total = parts.reduce((sum, part) => sum + Math.round(part.seconds * sampleRate), 0);
  const out = new Float32Array(total);
  let cursor = 0;
  for (const part of parts) {
    const count = Math.round(part.seconds * sampleRate);
    const amplitude = part.peakDb === null ? 0 : dbToLinear(part.peakDb);
    for (let i = 0; i < count; i += 1) out[cursor + i] = amplitude * random();
    cursor += count;
  }
  return out;
}

/** FNV-1a 64 비트 대신 32 비트 둘을 이어 지문을 만든다(Float32 비트 패턴 기준). */
function fingerprint(float32Arrays, messages) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const view = new DataView(new ArrayBuffer(4));
  for (const array of float32Arrays) {
    for (let i = 0; i < array.length; i += 1) {
      view.setFloat32(0, array[i]);
      const bits = view.getUint32(0);
      h1 = Math.imul(h1 ^ bits, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (bits >>> 16) ^ (bits << 16), 0x85ebca6b) >>> 0;
    }
  }
  const text = JSON.stringify(messages);
  for (let i = 0; i < text.length; i += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// 1. 옵션 없이 만든 워클릿 = Noise Gate 페달: 이 Step 이전과 비트 단위로 같다
//    아래 지문은 워클릿을 고치기 전에 같은 입력·같은 값으로 찍은 것이다. 이 값이 바뀌면 Noise Gate 의 소리가 바뀐 것이다.
// ---------------------------------------------------------------------------------------------
const LEGACY_GOLDEN = {
  mono48000: 'cf2b7eeae6495842',
  stereo44100: '30ca4f9c75ae372c',
  lateParamChange48000: '68ca96e77ec54391',
};

function legacyScenario(sampleRate, channelCount, seed, paramPlan) {
  const base = segments(
    sampleRate,
    [
      { seconds: 0.25, peakDb: null },
      { seconds: 0.4, peakDb: -20 },
      { seconds: 0.5, peakDb: -78 },
      { seconds: 0.3, peakDb: -40 },
      { seconds: 0.6, peakDb: -62 },
      { seconds: 0.2, peakDb: -12 },
      { seconds: 0.7, peakDb: -90 },
    ],
    seed,
  );
  const channels = Array.from({ length: channelCount }, (_, channel) => {
    const copy = new Float32Array(base);
    if (channel > 0) for (let i = 0; i < copy.length; i += 1) copy[i] *= 0.7 + 0.1 * Math.sin(i / 997);
    return copy;
  });
  const gate = createGate(sampleRate);
  const output = run(gate, channels, paramPlan);
  return fingerprint(output, gate.posted);
}

const legacyPrint = {
  mono48000: legacyScenario(48000, 1, 11, {}),
  stereo44100: legacyScenario(44100, 2, 22, { thresholdDb: -58, reductionDb: -60, holdMs: 40, releaseMs: 120, hysteresisDb: 6, attackMs: 3 }),
  lateParamChange48000: legacyScenario(48000, 2, 33, (block) =>
    block < 150 ? {} : { thresholdDb: -45, reductionDb: -30, attackMs: 12, holdMs: 0, releaseMs: 60, hysteresisDb: 0 }),
};

if (process.env.PRINT_GOLDEN) {
  console.log(JSON.stringify(legacyPrint, null, 2));
  process.exit(0);
}

for (const [name, expected] of Object.entries(LEGACY_GOLDEN)) {
  equal(legacyPrint[name], expected, `옵션 없는 워클릿의 출력 지문(${name}) — 바뀌면 Noise Gate 의 소리가 바뀐 것이다`);
}

// ---------------------------------------------------------------------------------------------
// 2. 옵션 { startOpen, silent }
// ---------------------------------------------------------------------------------------------
const FUZZ_OPTIONS = { processorOptions: { startOpen: true, silent: true } };
{
  const sampleRate = 48000;
  const loud = burst(sampleRate, 1, -10, 5);
  const fuzzGate = createGate(sampleRate, FUZZ_OPTIONS);
  const fuzzOut = run(fuzzGate, [loud], { reductionDb: -80 });
  deepEqual(fuzzGate.posted, [], '옵션 silent: 1초(블록 375개)를 돌려도 포트 메시지가 없다');
  equal(mismatches(fuzzOut[0].subarray(0, QUANTUM), loud.subarray(0, QUANTUM)), 0, '옵션 startOpen: 첫 블록부터 입력 그대로(열린 채로 시작)');
  equal(fuzzGate.processor.state, 'Open', 'startOpen 이면 상태는 Open');

  const noisePedal = createGate(sampleRate);
  const noiseOut = run(noisePedal, [loud], { reductionDb: -80 });
  ok(noisePedal.posted.length > 0, '대조: 옵션이 없으면 상태·글리치 메시지를 보낸다');
  ok(noisePedal.posted.some((message) => message.type === 'gate-state'), '대조: gate-state 메시지');
  ok(noisePedal.posted.some((message) => message.type === 'glitch-report'), '대조: glitch-report 메시지');
  ok(mismatches(noiseOut[0].subarray(0, QUANTUM), loud.subarray(0, QUANTUM)) > 0, '대조: 옵션이 없으면 닫힌 채로 시작해 첫 블록이 줄어 있다');
  equal(noisePedal.processor.silent, false, '옵션이 없으면 silent 는 거짓');

  const partial = createGate(sampleRate, { processorOptions: { startOpen: true } });
  run(partial, [loud], { reductionDb: -80 });
  ok(partial.posted.length > 0, 'startOpen 만 주면 메시지는 그대로 보낸다(두 옵션은 따로 쓴다)');
  const partial2 = createGate(sampleRate, { processorOptions: { silent: true } });
  const partial2Out = run(partial2, [loud], { reductionDb: -80 });
  deepEqual(partial2.posted, [], 'silent 만 주면 메시지가 없다');
  ok(mismatches(partial2Out[0].subarray(0, QUANTUM), loud.subarray(0, QUANTUM)) > 0, 'silent 만 주면 닫힌 채로 시작한다');
  const strange = createGate(sampleRate, { processorOptions: { startOpen: 'yes', silent: 1 } });
  equal(strange.processor.silent, false, '엄격한 true 만 켠다(silent)');
  equal(strange.processor.gateGain, 0, '엄격한 true 만 켠다(startOpen)');
  const noOptions = createGate(sampleRate, {});
  equal(noOptions.processor.gateGain, 0, 'processorOptions 가 없어도 오류 없이 예전 동작');
}

// ---------------------------------------------------------------------------------------------
// 3. Gate 0(줄이는 크기 0 dB): 입력이 한 샘플도 바뀌지 않는다
// ---------------------------------------------------------------------------------------------
for (const [sampleRate, channelCount, seed] of [[44100, 1, 71], [48000, 2, 72], [96000, 1, 73]]) {
  const parts = [
    { seconds: 0.1, peakDb: null }, { seconds: 0.3, peakDb: -20 }, { seconds: 0.4, peakDb: -90 },
    { seconds: 0.3, peakDb: -45 }, { seconds: 0.3, peakDb: -12 }, { seconds: 0.5, peakDb: -100 },
  ];
  const base = segments(sampleRate, parts, seed);
  const padded = new Float32Array(Math.ceil(base.length / QUANTUM) * QUANTUM);
  padded.set(base);
  const channels = Array.from({ length: channelCount }, (_, channel) => {
    const copy = new Float32Array(padded);
    if (channel > 0) for (let i = 0; i < copy.length; i += 1) copy[i] *= 0.6 + 0.2 * Math.cos(i / 311);
    return copy;
  });
  const gate = createGate(sampleRate, FUZZ_OPTIONS);
  // 문턱을 가장 높게, 닫힘을 가장 느리게 해도(= 게이트가 가장 쉽게 닫히는 값) 줄이는 크기가 0 dB 이면 그대로다.
  const out = run(gate, channels, { thresholdDb: -20, reductionDb: 0, attackMs: 50, holdMs: 0, releaseMs: 1000, hysteresisDb: 10 });
  out.forEach((channel, index) => {
    equal(mismatches(channel, channels[index]), 0, `Gate 0: ${sampleRate} Hz ${channelCount}채널 중 ${index + 1}번 채널이 입력과 한 샘플도 다르지 않다`);
  });
  equal(gate.processor.gateGain, 1, `Gate 0: 게이트 이득이 정확히 1 (${sampleRate} Hz)`);
  deepEqual(gate.posted, [], 'Gate 0: 메시지 없음');
}

// ---------------------------------------------------------------------------------------------
// 4. Gate 가 켜져 있을 때(Gate 50: 문턱 약 −55.25 dBFS, 히스테리시스 6 dB, 속도는 FUZZ_GATE_* )
// ---------------------------------------------------------------------------------------------
const descriptors = new Map(createGate(48000).scope.ctor.parameterDescriptors.map((descriptor) => [descriptor.name, descriptor]));
const gateParamsFor = (gate) => ({
  ...fuzzGateWorkletSettings(gate),
  attackMs: FUZZ_GATE_ATTACK_MS,
  holdMs: FUZZ_GATE_HOLD_MS,
  releaseMs: FUZZ_GATE_RELEASE_MS,
  hysteresisDb: FUZZ_GATE_HYSTERESIS_DB,
});
const within = (name, value) => {
  const descriptor = descriptors.get(name);
  ok(descriptor && value >= descriptor.minValue && value <= descriptor.maxValue, `${name}=${value} 가 워클릿이 받는 범위 ${descriptor?.minValue}~${descriptor?.maxValue} 안`);
};
for (let gate = 1; gate <= 100; gate += 1) within('thresholdDb', fuzzGateThresholdDb(gate));
within('reductionDb', FUZZ_GATE_CLOSED_REDUCTION_DB);
within('reductionDb', 0);
within('attackMs', FUZZ_GATE_ATTACK_MS);
within('holdMs', FUZZ_GATE_HOLD_MS);
within('releaseMs', FUZZ_GATE_RELEASE_MS);
within('hysteresisDb', FUZZ_GATE_HYSTERESIS_DB);
equal(FUZZ_GATE_HYSTERESIS_DB, 6, '설계서: 히스테리시스 6 dB 고정');
equal(FUZZ_GATE_MIN_THRESHOLD_DB, -80, '설계서: 문턱 최소 −80 dBFS');
equal(FUZZ_GATE_MAX_THRESHOLD_DB, -30, '설계서: 문턱 최대 −30 dBFS');

// 값 → 워클릿 설정: 0 은 끔(줄이는 크기 0 dB), 1~100 은 문턱 −80 ~ −30 dBFS 에 80 dB 줄임.
deepEqual(fuzzGateWorkletSettings(0), { thresholdDb: FUZZ_GATE_MIN_THRESHOLD_DB, reductionDb: 0 }, 'Gate 0: 줄이는 크기 0 dB');
deepEqual(fuzzGateWorkletSettings(0.4), { thresholdDb: FUZZ_GATE_MIN_THRESHOLD_DB, reductionDb: 0 }, 'Gate 0.4 도 끔(0 으로 반올림되는 값)');
deepEqual(fuzzGateWorkletSettings(Number.NaN), { thresholdDb: FUZZ_GATE_MIN_THRESHOLD_DB, reductionDb: 0 }, 'Gate NaN 은 끔');
for (let gate = 1; gate <= 100; gate += 1) {
  deepEqual(
    fuzzGateWorkletSettings(gate),
    { thresholdDb: fuzzGateThresholdDb(gate), reductionDb: FUZZ_GATE_CLOSED_REDUCTION_DB },
    `Gate ${gate}: 문턱 ${fuzzGateThresholdDb(gate).toFixed(2)} dBFS, 닫히면 ${FUZZ_GATE_CLOSED_REDUCTION_DB} dB`,
  );
}
equal(fuzzGateWorkletSettings(1).thresholdDb, -80, 'Gate 1 = −80 dBFS');
equal(fuzzGateWorkletSettings(100).thresholdDb, -30, 'Gate 100 = −30 dBFS');

{
  // 4a. 무연주 잡음(−70 dBFS RMS 가우시안): 문턱(−55.25) 아래라 닫히고, 닫힌 뒤에는 80 dB 가까이 줄어든다.
  const sampleRate = 48000;
  const noise = gaussianNoise(sampleRate, 3, -70, 99);
  ok(peakDbOf(noise) < fuzzGateThresholdDb(50) - 0.5, `시험 잡음의 봉우리(${peakDbOf(noise).toFixed(1)} dBFS)가 Gate 50 문턱 아래`);
  const gate = createGate(sampleRate, FUZZ_OPTIONS);
  const out = run(gate, [noise], gateParamsFor(50));
  const from = sampleRate * 2;
  const reduction = rmsDb(out[0], from) - rmsDb(noise, from);
  ok(reduction <= -79, `Gate 50: 닫힌 뒤 잡음이 ${reduction.toFixed(1)} dB (−79 dB 이하)`);
  const whole = rmsDb(out[0], sampleRate * 0.5) - rmsDb(noise, sampleRate * 0.5);
  ok(whole <= -40, `Gate 50: 0.5초 뒤부터 전체 구간도 ${whole.toFixed(1)} dB (−40 dB 이하)`);
  ok(gate.processor.gateGain <= 1.01e-4, '닫힌 이득은 −80 dB(1e-4)에 닿는다');
}
{
  // 4b. 문턱 위의 소리는 그대로 지나간다.
  const sampleRate = 48000;
  // 위상 π/4 에서 시작한다: 첫 샘플부터 문턱 위라 게이트가 닫히려 하지 않는다(0 에서 시작하면 첫 몇 샘플이 순간 무음으로 보여 이득이 1 에서 살짝 내려간다).
  const tone = Float32Array.from({ length: blocksOf(sampleRate, 1) }, (_, i) => dbToLinear(-20) * Math.sin(Math.PI / 4 + (2 * Math.PI * 220 * i) / sampleRate));
  const gate = createGate(sampleRate, FUZZ_OPTIONS);
  const out = run(gate, [tone], gateParamsFor(50));
  equal(mismatches(out[0], tone), 0, '−20 dBFS 지속음: 문턱 위라 한 샘플도 바뀌지 않는다');
  equal(gate.processor.gateGain, 1, '열려 있는 동안 이득은 정확히 1');
}
{
  // 4c. 닫히는 때: 소리가 끊긴 뒤 히스테리시스 아래로 내려가고(≈38 ms) 홀드 30 ms 가 지나서야 닫히기 시작한다.
  const sampleRate = 48000;
  const gate = createGate(sampleRate, FUZZ_OPTIONS);
  const params = gateParamsFor(50);
  run(gate, [burst(sampleRate, 0.2, -20, 3)], params);
  equal(gate.processor.gateGain, 1, '소리가 있는 동안은 열려 있다');
  const gains = [];
  const checkpoints = [0.03, 0.05, 0.1, 0.2, 0.5, 1.5];
  let elapsed = 0;
  for (const checkpoint of checkpoints) {
    run(gate, [silence(sampleRate, checkpoint - elapsed)], params);
    elapsed = checkpoint;
    gains.push(gate.processor.gateGain);
  }
  equal(gains[0], 1, '끊긴 뒤 30 ms: 아직 열려 있다');
  equal(gains[1], 1, '끊긴 뒤 50 ms: 홀드 중이라 아직 열려 있다');
  ok(gains[2] < 1 && gains[2] > 0.3, `끊긴 뒤 100 ms: 닫히는 중(${gains[2].toFixed(3)})`);
  ok(gains[3] < gains[2], '끊긴 뒤 200 ms: 더 닫혔다');
  ok(gains[4] < 0.01, `끊긴 뒤 500 ms: ${(20 * Math.log10(gains[4])).toFixed(1)} dB (−40 dB 이하)`);
  ok(Math.abs(gains[5] - dbToLinear(FUZZ_GATE_CLOSED_REDUCTION_DB)) < 2e-6, '끊긴 뒤 1.5 초: −80 dB 에 닿았다');

  // 4d. 여는 때: 문턱을 넘는 첫 샘플에서 열기 시작해 1 ms 시정수로 오른다.
  run(gate, [burst(sampleRate, 0.0027, -30, 4)], params);
  run(gate, [burst(sampleRate, 0.0054, -30, 5)], params);
  ok(gate.processor.gateGain >= 0.99, `−30 dBFS 소리가 들어오고 8 ms 뒤 이득 ${gate.processor.gateGain.toFixed(4)} (0.99 이상)`);
}
{
  // 4e. 히스테리시스: 한 번 열리면 문턱과 (문턱 − 6 dB) 사이의 소리에서는 열린 채로 있고, 그 아래에서는 닫힌다.
  const sampleRate = 48000;
  const threshold = fuzzGateThresholdDb(50);
  const params = gateParamsFor(50);
  const between = createGate(sampleRate, FUZZ_OPTIONS);
  run(between, [burst(sampleRate, 0.2, -20, 6)], params);
  const held = run(between, [steady(sampleRate, 1, threshold - 3)], params);
  equal(between.processor.gateGain, 1, '문턱 −3 dB 의 일정한 소리: 열린 채로 있다(히스테리시스)');
  equal(mismatches(held[0], steady(sampleRate, 1, threshold - 3)), 0, '그동안 입력이 그대로 지나갔다');
  const below = createGate(sampleRate, FUZZ_OPTIONS);
  run(below, [burst(sampleRate, 0.2, -20, 6)], params);
  run(below, [steady(sampleRate, 1.5, threshold - 9)], params);
  ok(below.processor.gateGain < 1e-3, '문턱 −9 dB 의 일정한 소리: 닫힌다');
}
{
  // 4f. 스테레오: 두 채널의 큰 쪽을 보고 함께 열고 닫는다.
  const sampleRate = 48000;
  const params = gateParamsFor(50);
  const gate = createGate(sampleRate, FUZZ_OPTIONS);
  const loudLeft = burst(sampleRate, 0.3, -20, 8);
  const quietRight = burst(sampleRate, 0.3, -75, 9);
  const out = run(gate, [loudLeft, quietRight], params);
  equal(mismatches(out[1], quietRight), 0, '왼쪽이 크면 조용한 오른쪽도 함께 열려 있다');
  const bothQuiet = createGate(sampleRate, FUZZ_OPTIONS);
  const quietLeft = gaussianNoise(sampleRate, 2, -72, 10);
  const outQuiet = run(bothQuiet, [quietLeft, quietRight.length === quietLeft.length ? quietRight : gaussianNoise(sampleRate, 2, -74, 11)], params);
  ok(rmsDb(outQuiet[1], sampleRate * 1.5) < -140, '둘 다 문턱 아래면 둘 다 닫힌다');
}

// ---------------------------------------------------------------------------------------------
// 5. 배선(소스 확인): 정규식 대신 문자열 포함으로 본다
// ---------------------------------------------------------------------------------------------
const fuzzEffectSource = await readFile(new URL('../src/audio/nodes/FuzzEffect.ts', import.meta.url), 'utf8');
const fuzzPedalSource = await readFile(new URL('../src/components/effects/FuzzPedal.tsx', import.meta.url), 'utf8');
const audioEngineSource = await readFile(new URL('../src/audio/AudioEngine.ts', import.meta.url), 'utf8');
for (const piece of [
  "new AudioWorkletNode(context, 'noise-gate-processor'",
  'processorOptions: { startOpen: true, silent: true }',
  'this.effectInput.connect(this.gate);',
  'this.gate.connect(this.preGain);',
  'this.tone.connect(this.effectOutput);',
  'fuzzGateWorkletSettings((pedal.params as FuzzParams).gate)',
  'const gate = fuzzGateWorkletSettings(params.gate);',
  "this.setGateParam('thresholdDb', gate.thresholdDb, true);",
  "this.setGateParam('reductionDb', gate.reductionDb, false);",
  'param.setValueAtTime(value, now)',
  'this.gate.disconnect();',
]) ok(fuzzEffectSource.includes(piece), `FuzzEffect: ${piece}`);
ok(!fuzzEffectSource.includes('gateTrim'), 'FuzzEffect: 예전의 출력 감쇠(gateTrim)가 남아 있지 않다');
ok(!fuzzEffectSource.includes('outputChannelCount:'), 'FuzzEffect: 출력 채널 수는 입력을 따른다(고정하지 않는다)');
ok(fuzzPedalSource.includes("getParamDef('fuzz', 'gate')"), 'FuzzPedal: Gate 는 스키마에서 이름·범위·표시를 읽는다');
ok(!fuzzPedalSource.includes('출력 감쇠'), "FuzzPedal: 옛 이름 '출력 감쇠' 가 없다");
ok(audioEngineSource.includes('noiseGateProcessorSource'), 'AudioEngine 이 noise-gate 워클릿을 등록한다(Fuzz 도 이것을 쓴다)');

console.log(`통과 ${checks}건 — S2.2 Fuzz Gate 워클릿 회귀 시험`);
