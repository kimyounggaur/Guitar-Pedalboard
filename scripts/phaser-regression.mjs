import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import vm from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const effectBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/PhaserEffect.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const effectCode = effectBundle.outputFiles[0].text;
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectCode).toString('base64')}`;
const effectBase = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/BaseEffect.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const { ROUTING_FADE_SECONDS } = await import(`data:text/javascript;base64,${Buffer.from(effectBase.outputFiles[0].text).toString('base64')}`);
const {
  getPhaserSweep,
  getPhaserWetMakeup,
  normalizePhaserParams,
  PhaserEffect,
  PHASER_CENTER_FREQUENCY,
  PHASER_MAX_FEEDBACK,
  PHASER_MAX_FREQUENCY,
  PHASER_MIN_FREQUENCY,
  PHASER_STAGE_OPTIONS,
} = await import(effectUrl);

assert.deepEqual(PHASER_STAGE_OPTIONS, [4, 6, 8, 12]);
assert.deepEqual(
  normalizePhaserParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    stages: Number.NaN,
    feedback: Number.NaN,
  }),
  { mix: 45, level: 100, rate: 0.5, depth: 70, stages: 6, feedback: 40 },
);
assert.deepEqual(
  normalizePhaserParams({
    mix: -1,
    level: 300,
    rate: 20,
    depth: 200,
    stages: 99,
    feedback: 1000,
  }),
  { mix: 0, level: 200, rate: 8, depth: 100, stages: 12, feedback: 90 },
);

const zeroSweep = getPhaserSweep(0);
const halfSweep = getPhaserSweep(50);
const fullSweep = getPhaserSweep(100);
assert.ok(Math.abs(zeroSweep.minimumFrequency - PHASER_CENTER_FREQUENCY) < 1e-9);
assert.ok(Math.abs(zeroSweep.maximumFrequency - PHASER_CENTER_FREQUENCY) < 1e-9);
assert.ok(Math.abs(fullSweep.minimumFrequency - PHASER_MIN_FREQUENCY) < 1e-9);
assert.ok(Math.abs(fullSweep.maximumFrequency - PHASER_MAX_FREQUENCY) < 1e-9);
assert.ok(halfSweep.minimumFrequency < PHASER_CENTER_FREQUENCY);
assert.ok(halfSweep.maximumFrequency > PHASER_CENTER_FREQUENCY);
assert.ok(
  Math.abs(
    fullSweep.minimumFrequency * fullSweep.maximumFrequency -
      PHASER_CENTER_FREQUENCY * PHASER_CENTER_FREQUENCY,
  ) < 1e-6,
  '지수 sweep의 기하 평균 중심이 유지되지 않습니다.',
);

assert.equal(PHASER_MAX_FEEDBACK, 0.9);
assert.equal(getPhaserWetMakeup(0), 1);
assert.equal(getPhaserWetMakeup(-10), 1);
assert.equal(getPhaserWetMakeup(10), getPhaserWetMakeup(PHASER_MAX_FEEDBACK));
assert.ok(getPhaserWetMakeup(PHASER_MAX_FEEDBACK) >= 0.3);
assert.ok(getPhaserWetMakeup(PHASER_MAX_FEEDBACK) < 0.5);

class Param {
  value = 0;
  events = [];
  cancelScheduledValues(time) { this.events = this.events.filter((event) => event.time < time); }
  setValueAtTime(value, time = 0) { this.value = value; this.events.push({ value, time }); }
  setTargetAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
}
class Node {
  gain = new Param();
  connections = new Set();
  connect(node) { this.connections.add(node); }
  disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
}
const graph = [];
globalThis.AudioWorkletNode = class extends Node {
  parameters = new Map(['rate', 'depth', 'feedback', 'stages', 'active'].map((key) => [key, new Param()]));
  port = { messages: [], postMessage(message) { this.messages.push(message); } };
  constructor(context, name, options) {
    super(); assert.equal(name, 'phaser-processor');
    assert.deepEqual(options.outputChannelCount, [2]);
    this.options = options; graph.push(this);
  }
};
const context = { currentTime: 0, createGain() { const node = new Node(); graph.push(node); return node; } };
const pedal = { id: 'phaser', type: 'phaser', active: true,
  params: { mix: 45, level: 100, rate: .5, depth: 70, stages: 6, feedback: 40 } };
const effect = new PhaserEffect(context, pedal);
const processorNode = graph.at(-1);
effect.update({ ...pedal, params: { ...pedal.params, stages: 12, feedback: 90 } });
assert.equal(processorNode.parameters.get('stages').value, 12);
assert.equal(processorNode.parameters.get('feedback').value, .9);
assert.deepEqual(processorNode.options.parameterData, { stages: 6, active: 1 }, 'a pedal built switched on starts the processor running');
const bypass = [...effect.input.connections].find((node) => node.connections.has(effect.output));
const activeParam = processorNode.parameters.get('active');
effect.update({ ...pedal, active: false });
assert.equal(bypass.gain.value, 1);
// 끄면 게이트가 닫힐 때까지(ROUTING_FADE_SECONDS) 기다렸다가 워클릿을 멈춘다. 그 전에 멈추면 꼬리가 뚝 끊겨 딸깍 소리가 난다.
assert.deepEqual(activeParam.events, [{ value: 0, time: ROUTING_FADE_SECONDS + 0.02 }], 'switching off stops the processor after the gate has closed');
effect.update({ ...pedal, active: false, params: { ...pedal.params, rate: 2 } });
assert.equal(activeParam.events.length, 1, 'repeating the same on/off state schedules nothing new');
context.currentTime = 0.005;
effect.update({ ...pedal, active: true });
assert.deepEqual(activeParam.events, [{ value: 1, time: 0.005 }], 'switching back on cancels the pending stop and restarts the processor at once');
const offPedal = new PhaserEffect(context, { ...pedal, active: false });
assert.deepEqual(graph.at(-1).options.parameterData, { stages: 6, active: 0 }, 'a pedal built switched off never starts the processor');
offPedal.dispose();
context.currentTime = 0;
effect.dispose(); effect.dispose();
assert.deepEqual(processorNode.port.messages, [{ type: 'dispose' }]);
assert.equal(processorNode.connections.size, 0);
delete globalThis.AudioWorkletNode;

const workletBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/worklets/phaser-processor.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const workletUrl = `data:text/javascript;base64,${Buffer.from(workletBundle.outputFiles[0].text).toString('base64')}`;
const { phaserProcessorSource } = await import(workletUrl);
let Processor;
class MockProcessor { constructor() { this.port = { onmessage: null }; } }
vm.runInNewContext(phaserProcessorSource, {
  sampleRate: 48000, AudioWorkletProcessor: MockProcessor,
  registerProcessor(name, klass) { assert.equal(name, 'phaser-processor'); Processor = klass; },
});
function render({ feedback = 0, stages = 6, mono = false, sine = false } = {}) {
  const processor = new Processor({ processorOptions: { stages } });
  const left = [], right = [];
  const params = { rate: [.5], depth: [0], feedback: [feedback], stages: [stages], active: [1] };
  for (let block = 0; block < 100; block++) {
    const l = new Float32Array(128), r = new Float32Array(128);
    if (sine) for (let i = 0; i < l.length; i++) l[i] = Math.sin(2 * Math.PI * 440 * (block * 128 + i) / 48000);
    else if (!block) l[0] = 1;
    const out = [new Float32Array(128), new Float32Array(128)];
    assert.equal(processor.process([mono ? [l] : [l, r]], [out], params), true);
    left.push(...out[0]); right.push(...out[1]);
  }
  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.process([], [], params), false);
  return { left, right };
}
for (const stages of [4, 6, 8, 12]) {
  const response = render({ stages, sine: true });
  const steady = response.left.slice(4800);
  const rms = Math.sqrt(steady.reduce((sum, value) => sum + value * value, 0) / steady.length);
  assert.ok(Math.abs(rms - Math.SQRT1_2) < .01, `${stages}-stage all-pass must preserve steady-state amplitude`);
  assert.ok(response.right.every((value) => value === 0), 'stereo channels must remain independent');
  assert.ok(render({ stages, feedback: .9 }).left.every(Number.isFinite), 'high feedback must remain stable');
}
const dry = render({ feedback: 0 }).left;
const feedback = render({ feedback: .5 }).left;
assert.ok(Math.abs(dry[1] - feedback[1]) > 1e-6, 'feedback enters on the next sample, not 128 samples later');
const mono = render({ mono: true });
assert.deepEqual(mono.left, mono.right, 'mono input must reach both channels');

const changing = new Processor({ processorOptions: { stages: 4 } });
const changingParams = { rate: [8], depth: [100], feedback: [.9], stages: [4] };
for (let block = 0; block < 400; block++) {
  changingParams.stages[0] = [4, 6, 8, 12][Math.floor(block / 25) % 4];
  const input = [new Float32Array(128), new Float32Array(128)];
  for (let i = 0; i < 128; i++) input[0][i] = .2 * Math.sin(2 * Math.PI * 440 * (block * 128 + i) / 48000);
  const output = [new Float32Array(128), new Float32Array(128)];
  changing.process([input], [output], changingParams);
  assert.ok(output[0].every((value) => Number.isFinite(value) && Math.abs(value) < 10), 'sweep and stage changes remain bounded');
}

// ---- S3.4: 설계한 전달함수 그대로인가(닫힌 식과 비교) -------------------------------------------------
// 단 하나는 1차 올패스 (a + z⁻¹)/(1 + a·z⁻¹), a = (tan(π·fc/sr) − 1)/(tan(π·fc/sr) + 1). N 단을 곱하고,
// 직전 샘플의 출력을 fb 만큼 입력에 되먹이면 W = A / (1 − fb·z⁻¹·A) 이다. 깊이 0 이면 fc 는 중심 주파수로 고정이다.
function runProcessor(sampleRate, { stages, feedback, blocks, depth = 0, rate = .5, input = () => 0, active = 1, activeAt = null, stagesAt = null }) {
  let ProcessorClass;
  vm.runInNewContext(phaserProcessorSource, {
    sampleRate, AudioWorkletProcessor: MockProcessor,
    registerProcessor(name, klass) { ProcessorClass = klass; },
  });
  const processor = new ProcessorClass({ processorOptions: { stages } });
  const output = [];
  const params = { rate: [rate], depth: [depth], feedback: [feedback], stages: [stages], active: [active] };
  for (let block = 0; block < blocks; block++) {
    if (stagesAt) params.stages[0] = stagesAt(block);
    if (activeAt) params.active[0] = activeAt(block);
    const l = new Float32Array(128);
    for (let i = 0; i < 128; i++) l[i] = input(block * 128 + i);
    const out = [new Float32Array(128), new Float32Array(128)];
    processor.process([[l]], [out], params);
    output.push(out[0]);
  }
  return { processor, samples: Float64Array.from(output.flatMap((chunk) => [...chunk])) };
}
function closedForm(frequency, sampleRate, stages, feedback) {
  const tangent = Math.tan(Math.PI * PHASER_CENTER_FREQUENCY / sampleRate);
  const a = (tangent - 1) / (tangent + 1);
  const w = 2 * Math.PI * frequency / sampleRate;
  const z1 = [Math.cos(w), -Math.sin(w)];
  const mul = (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
  const div = (x, y) => { const d = y[0] * y[0] + y[1] * y[1]; return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d]; };
  const stage = div([a + z1[0], z1[1]], [1 + a * z1[0], a * z1[1]]);
  let all = [1, 0];
  for (let i = 0; i < stages; i++) all = mul(all, stage);
  const loop = mul(z1, all);
  return div(all, [1 - feedback * loop[0], -feedback * loop[1]]);
}
for (const sampleRate of [44100, 48000]) {
  for (const stages of PHASER_STAGE_OPTIONS) {
    for (const feedback of [0, .5, .9]) {
      const { samples } = runProcessor(sampleRate, { stages, feedback, blocks: 400, input: (n) => (n === 0 ? 1 : 0) });
      let worst = 0;
      for (const frequency of [60, 130, 250, 400, 632, 900, 1400, 2400, 4000, 7000, 11000]) {
        const w = 2 * Math.PI * frequency / sampleRate;
        let re = 0, im = 0;
        for (let n = 0; n < samples.length; n++) { re += samples[n] * Math.cos(w * n); im -= samples[n] * Math.sin(w * n); }
        const expected = closedForm(frequency, sampleRate, stages, feedback);
        const errorDb = Math.abs(20 * Math.log10(Math.hypot(re, im) / Math.hypot(expected[0], expected[1])));
        worst = Math.max(worst, errorDb);
      }
      assert.ok(worst < 0.01, `${stages} stages, feedback ${feedback}, ${sampleRate} Hz: transfer function off the closed form by ${worst} dB (a comb outside the design)`);
    }
  }
}
// 노치 개수: 1차 올패스 N 단은 위상이 −Nπ 까지 돌므로 Mix 50% 에서 노치가 N/2 개다(4단 2개, 6단 3개, 8단 4개, 12단 6개).
for (const stages of PHASER_STAGE_OPTIONS) {
  let notches = 0;
  let previous = 0;
  for (let f = 40; f < 20000; f *= 1.01) {
    const expected = closedForm(f, 48000, stages, 0);
    const level = 20 * Math.log10(Math.max(1e-9, Math.hypot(1 + expected[0], expected[1]) / 2));
    if (level < -20 && previous >= -20) notches += 1;
    previous = level;
  }
  assert.equal(notches, stages / 2, `${stages}-stage all-pass must make ${stages / 2} notches`);
}

// ---- 고른 단수만 계산한다(R4-2) ----------------------------------------------------------------------
for (const stages of PHASER_STAGE_OPTIONS) {
  const { processor } = runProcessor(48000, { stages, feedback: .5, blocks: 4, input: (n) => (n === 0 ? 1 : 0) });
  const state = processor.states[0];
  for (let stage = 0; stage < 12; stage++) {
    if (stage < stages) assert.notEqual(state[stage], 0, `${stages}-stage: stage ${stage + 1} must run`);
    else assert.equal(state[stage], 0, `${stages}-stage: stage ${stage + 1} must not run`);
  }
}

// ---- 꺼짐·무음: 필터를 돌리지 않고 상태를 비운다 -------------------------------------------------------
{
  const loud = (n) => .5 * Math.sin(2 * Math.PI * 440 * n / 48000);
  const off = runProcessor(48000, { stages: 12, feedback: .9, blocks: 40, input: loud, active: 0 });
  assert.ok(off.samples.every((value) => value === 0), 'a switched-off phaser outputs silence');
  assert.ok(off.processor.states.every((state) => state.every((value) => value === 0)), 'a switched-off phaser keeps no filter state');
  // 켜 둔 채 소리가 끊기면 꼬리(피드백)가 다 사라진 뒤에 상태가 정확히 0 이 되고 출력도 0 이다.
  const gap = runProcessor(48000, { stages: 6, feedback: .9, blocks: 700, input: (n) => (n < 1280 ? loud(n) : 0) });
  const tail = gap.samples.slice(-128 * 20);
  assert.ok(tail.every((value) => value === 0), 'after the tail has died out the phaser outputs exact silence');
  assert.ok(gap.processor.states.every((state) => state.every((value) => value === 0)), 'and its filter state is flushed to exactly zero (no denormals)');
  assert.ok(gap.samples.slice(1280, 1280 + 128).some((value) => value !== 0), 'the feedback tail rings on after the input stops');
  // 꺼졌다 다시 켜면 비워진 상태에서 시작한다(옛 신호가 되살아나지 않는다).
  const toggled = runProcessor(48000, { stages: 12, feedback: .9, blocks: 80, input: loud, activeAt: (block) => (block >= 20 && block < 40 ? 0 : 1) });
  assert.ok(toggled.samples.slice(20 * 128, 40 * 128).every((value) => value === 0), 'silent while switched off');
  assert.ok(toggled.samples.slice(40 * 128).every(Number.isFinite), 'running again after being switched off stays finite');
}

// ---- 단수를 바꿀 때: 가중치 합 1 을 지키며 20 ms 에 걸쳐 옮긴다 ---------------------------------------------
{
  const sampleRate = 48000;
  let ProcessorClass;
  vm.runInNewContext(phaserProcessorSource, {
    sampleRate, AudioWorkletProcessor: MockProcessor,
    registerProcessor(name, klass) { ProcessorClass = klass; },
  });
  const processor = new ProcessorClass({ processorOptions: { stages: 4 } });
  const params = { rate: [.5], depth: [0], feedback: [.5], stages: [4], active: [1] };
  const run = (stagesNow, blocks, from) => {
    params.stages[0] = stagesNow;
    const seen = [];
    for (let block = 0; block < blocks; block++) {
      const l = new Float32Array(128);
      for (let i = 0; i < 128; i++) l[i] = .5 * Math.sin(2 * Math.PI * 440 * ((from + block) * 128 + i) / sampleRate);
      const out = [new Float32Array(128), new Float32Array(128)];
      processor.process([[l]], [out], params);
      seen.push({ out: out[0], weights: [...processor.weights], count: processor.count });
    }
    return seen;
  };
  run(4, 20, 0);
  const rise = run(12, 12, 20);
  for (const { weights } of rise) assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'tap weights must always sum to 1');
  assert.ok(rise[0].weights[0] < 1 && rise[0].weights[0] > 0, 'the old tap fades instead of cutting off');
  assert.equal(rise[0].count, 12, 'the new, longer cascade is computed from the first block of the change');
  assert.ok(rise[6].weights[0] > 0, 'the old tap is still fading before 20 ms are over (7 blocks = 18.7 ms)');
  assert.equal(rise[7].weights[0], 0, 'after 20 ms (8 blocks of 128 at 48 kHz) the old tap is gone');
  assert.equal(rise[7].weights[3], 1, 'and the new tap carries the whole signal');
  // 단을 줄일 때는 가중치가 다 옮겨진 뒤에야 계산을 줄이고, 줄어든 단의 상태는 0 으로 비운다.
  const fall = run(4, 12, 32);
  assert.equal(fall[0].count, 12, 'the longer cascade keeps running while its tap fades out');
  assert.equal(fall.at(-1).count, 4, 'the cascade shrinks once the fade is complete');
  assert.ok(processor.states[0].slice(4).every((value) => value === 0), 'stages that stopped running keep no stale state');
  // 연결이 부드러운가: 440 Hz 사인(진폭 .5)의 최대 샘플 간 차이(.029)에 비해 단수를 바꿀 때도 .1 을 넘지 않는다.
  let steps = 0;
  for (const { out } of [...rise, ...fall]) for (let i = 1; i < out.length; i++) steps = Math.max(steps, Math.abs(out[i] - out[i - 1]));
  assert.ok(steps < 0.1, `stage changes must not click (largest step ${steps})`);
  // 한 번 더 바꾸다 중간에 되돌려도(4→12 도중에 다시 4) 합이 1 을 지킨다.
  run(12, 3, 44);
  const midway = run(6, 2, 47);
  for (const { weights } of midway) assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'retargeting mid-fade keeps the sum at 1');
}

const migrationBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [
    fileURLToPath(new URL('../src/store/__migration_check.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const migrationCode = migrationBundle.outputFiles[0].text;
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationCode).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log(
  'Phaser worklet regression passed: stages, sweep, stereo, feedback and lifecycle.',
);
