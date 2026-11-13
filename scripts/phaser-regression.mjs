import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import vm from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

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
  parameters = new Map(['rate', 'depth', 'feedback', 'stages'].map((key) => [key, new Param()]));
  port = { messages: [], postMessage(message) { this.messages.push(message); } };
  constructor(context, name, options) {
    super(); assert.equal(name, 'phaser-processor');
    assert.deepEqual(options.outputChannelCount, [2]); graph.push(this);
  }
};
const context = { currentTime: 0, createGain() { const node = new Node(); graph.push(node); return node; } };
const pedal = { id: 'phaser', type: 'phaser', enabled: true, bypassed: false,
  params: { mix: 45, level: 100, rate: .5, depth: 70, stages: 6, feedback: 40 } };
const effect = new PhaserEffect(context, pedal);
const processorNode = graph.at(-1);
effect.update({ ...pedal, params: { ...pedal.params, stages: 12, feedback: 90 } });
assert.equal(processorNode.parameters.get('stages').value, 12);
assert.equal(processorNode.parameters.get('feedback').value, .9);
const bypass = [...effect.input.connections].find((node) => node.connections.has(effect.output));
effect.update({ ...pedal, bypassed: true });
assert.equal(bypass.gain.value, 1);
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
  const params = { rate: [.5], depth: [0], feedback: [feedback], stages: [stages] };
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

const migrationBundle = await build({
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
