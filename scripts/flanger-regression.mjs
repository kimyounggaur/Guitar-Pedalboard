import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import vm from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const effectBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/FlangerEffect.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const effectCode = effectBundle.outputFiles[0].text;
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectCode).toString('base64')}`;
const { FlangerEffect, FLANGER_MAX_FEEDBACK, getFlangerModulationDepth, normalizeFlangerParams } =
  await import(effectUrl);

assert.equal(FLANGER_MAX_FEEDBACK, 0.95);
assert.deepEqual(
  normalizeFlangerParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    feedback: Number.NaN,
    manual: Number.POSITIVE_INFINITY,
  }),
  { mix: 35, level: 100, rate: 0.25, depth: 55, feedback: 60, manual: 2 },
);
assert.deepEqual(
  normalizeFlangerParams({
    mix: -1,
    level: 300,
    rate: 20,
    depth: 200,
    feedback: -1000,
    manual: 20,
  }),
  { mix: 0, level: 200, rate: 5, depth: 100, feedback: -95, manual: 10 },
);
assert.equal(
  normalizeFlangerParams({
    mix: 35,
    level: 100,
    rate: 0.05,
    depth: 0,
    feedback: 1000,
    manual: 0,
  }).feedback,
  95,
);

const minimumManual = 0.0005;
const maximumManual = 0.01;
const manualExtremes = [minimumManual, maximumManual];
const depthExtremes = [0, 100];

for (const manual of manualExtremes) {
  for (const depth of depthExtremes) {
    const sweep = getFlangerModulationDepth(manual, depth);
    assert.ok(manual - sweep >= minimumManual, `${manual}/${depth}: lower sweep bound`);
    assert.ok(manual + sweep <= maximumManual, `${manual}/${depth}: upper sweep bound`);
  }
}

for (const manual of [0.0006, 0.00525, 0.0099]) {
  const sweep = getFlangerModulationDepth(manual, 100);
  assert.ok(manual - sweep >= minimumManual, `${manual}: lower sweep bound`);
  assert.ok(manual + sweep <= maximumManual, `${manual}: upper sweep bound`);
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

// Exercise the actual BaseEffect bypass route and worklet parameter plumbing.
class Param {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
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
  parameters = new Map(['manual', 'depth', 'rate', 'feedback'].map((key) => [key, new Param()]));
  port = { messages: [], postMessage(message) { this.messages.push(message); } };
  constructor(context, name, options) {
    super();
    assert.equal(name, 'flanger-processor');
    assert.deepEqual(options.outputChannelCount, [2]);
    graph.push(this);
  }
};
const context = { currentTime: 0, createGain() { const node = new Node(); graph.push(node); return node; } };
const pedal = { id: 'flanger', type: 'flanger', active: true,
  params: { mix: 35, level: 100, rate: .25, depth: 55, feedback: 60, manual: 2 } };
const effect = new FlangerEffect(context, pedal);
const workletNode = graph.at(-1);
assert.equal(workletNode.parameters.get('manual').value, .002);
assert.equal(workletNode.parameters.get('feedback').value, .6);
const bypassGain = [...effect.input.connections].find((node) => node.connections.has(effect.output));
assert.equal(bypassGain.gain.value, 0);
effect.update({ ...pedal, active: false });
assert.equal(bypassGain.gain.value, 1, 'bypass routes the original signal directly');
effect.dispose();
assert.deepEqual(workletNode.port.messages, [{ type: 'dispose' }]);
assert.equal(workletNode.connections.size, 0);
delete globalThis.AudioWorkletNode;

const workletBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/worklets/flanger-processor.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const workletUrl = `data:text/javascript;base64,${Buffer.from(workletBundle.outputFiles[0].text).toString('base64')}`;
const { flangerProcessorSource } = await import(workletUrl);
let Processor;
class MockProcessor { constructor() { this.port = { onmessage: null }; } }
vm.runInNewContext(flangerProcessorSource, {
  sampleRate: 48000, AudioWorkletProcessor: MockProcessor,
  registerProcessor(name, klass) { assert.equal(name, 'flanger-processor'); Processor = klass; },
});
function render(feedback, stereo = true) {
  const processor = new Processor();
  const left = [], right = [];
  const params = { manual: [.002], depth: [0], rate: [.25], feedback: [feedback] };
  for (let block = 0; block < 4; block++) {
    const l = new Float32Array(128), r = new Float32Array(128);
    if (!block) l[0] = 1;
    const out = [new Float32Array(128), new Float32Array(128)];
    assert.equal(processor.process([stereo ? [l, r] : [l]], [out], params), true);
    left.push(...out[0]); right.push(...out[1]);
  }
  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.process([], [], params), false);
  return { left, right };
}
const stereo = render(.6);
assert.ok(Math.abs(stereo.left[96] - .4) < 1e-6, '2 ms first tap');
assert.ok(Math.abs(stereo.left[192] - .24) < 1e-6, 'feedback must return after another 2 ms, without a render quantum');
assert.equal(stereo.left[224], 0, 'no extra 128 sample feedback delay');
assert.ok(stereo.right.every((sample) => sample === 0), 'stereo channels must remain independent');
const mono = render(-.6, false);
assert.ok(Math.abs(mono.left[192] + .24) < 1e-6, 'negative feedback inverts later tap');
assert.deepEqual(mono.left, mono.right, 'mono input must reach both channels');

// ---- S3.4: 샘플레이트와 상관없이 같은 지연 시간(L-233) -------------------------------------------------
// Flanger 의 첫 노치는 1/(2τ) 다. 기본 LFO(0.25 Hz)가 위상 90°(1.0 s)에서 τ = manual + depth = 2.825 ms, 270°(3.0 s)에서 1.175 ms 가 되는지를
// 44.1 kHz·48 kHz 에서 임펄스가 나오는 위치(두 샘플의 무게중심)로 재서 177 Hz / 426 Hz 를 확인한다.
for (const sampleRate of [44100, 48000]) {
  let SweepProcessor;
  vm.runInNewContext(flangerProcessorSource, {
    sampleRate, AudioWorkletProcessor: MockProcessor,
    registerProcessor(name, klass) { SweepProcessor = klass; },
  });
  const manual = 0.002;
  const depth = getFlangerModulationDepth(manual, 55);
  assert.ok(Math.abs(depth - 0.000825) < 1e-12, 'default depth 55% of the 1.5 ms safe sweep');
  const processor = new SweepProcessor();
  const params = { manual: [manual], depth: [depth], rate: [0.25], feedback: [0] };
  const impulses = [Math.round(sampleRate * 1.0), Math.round(sampleRate * 3.0)];
  const centroids = [];
  const total = impulses[1] + Math.round(sampleRate * 0.02);
  const output = new Float64Array(total + 128);
  for (let block = 0; block * 128 < total; block++) {
    const l = new Float32Array(128);
    for (const at of impulses) if (at >= block * 128 && at < (block + 1) * 128) l[at - block * 128] = 1;
    const out = [new Float32Array(128), new Float32Array(128)];
    processor.process([[l]], [out], params);
    output.set(out[0], block * 128);
  }
  for (const at of impulses) {
    let weight = 0, moment = 0;
    for (let n = at; n < at + Math.round(sampleRate * 0.006); n++) { weight += output[n]; moment += output[n] * n; }
    centroids.push((moment / weight - at) / sampleRate);
  }
  assert.ok(Math.abs(centroids[0] - 0.002825) < 2e-6, `${sampleRate} Hz: longest delay ${centroids[0] * 1000} ms`);
  assert.ok(Math.abs(centroids[1] - 0.001175) < 2e-6, `${sampleRate} Hz: shortest delay ${centroids[1] * 1000} ms`);
  const lowest = 1 / (2 * centroids[0]);
  const highest = 1 / (2 * centroids[1]);
  assert.ok(Math.abs(lowest - 177) < 1 && Math.abs(highest - 426) < 2, `${sampleRate} Hz: first notch sweeps ${lowest}~${highest} Hz`);
}

console.log('Flanger regression passed: parameter bounds, stereo, sample-level feedback timing and the 44.1/48 kHz delay sweep.');
