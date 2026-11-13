import assert from 'node:assert/strict';
import console from 'node:console';
import vm from 'node:vm';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { CompressorEffect } = await load('src/audio/nodes/CompressorEffect.ts');
class Param {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}
class Node {
  connections = new Set(); gain = new Param();
  connect(node) { this.connections.add(node); }
  disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
}
const nodes = [];
globalThis.AudioWorkletNode = class extends Node {
  parameters = new Map(['threshold', 'ratio', 'knee', 'attack', 'release'].map((name) => [name, new Param()]));
  port = { onmessage: null, messages: [], postMessage(message) { this.messages.push(message); } };
  constructor(context, name, options) { super(); assert.equal(name, 'compressor-processor'); assert.deepEqual(options.outputChannelCount, [2]); nodes.push(this); }
};
const context = { currentTime: 0, createGain() { const node = new Node(); nodes.push(node); return node; } };
const pedal = { id: 'compressor', type: 'compressor', enabled: true, bypassed: false,
  params: { mix: 45, level: 100, sustain: 50, threshold: -30, ratio: 4, attack: .003, release: .2, knee: 20 } };
const effect = new CompressorEffect(context, pedal);
const processorNode = nodes.at(-1);
assert.equal(processorNode.parameters.get('threshold').value, -39);
assert.equal(processorNode.parameters.get('ratio').value, 8);
const direct = [...effect.input.connections].find((node) => node.connections.has(effect.output));
const gate = [...effect.input.connections].find((node) => node !== direct);
const dry = [...gate.connections].find((node) => node !== [...nodes].find((n) => n.connections.has(processorNode)));
assert.ok(dry, 'parallel direct path is connected without a delay node');
effect.update({ ...pedal, bypassed: true });
assert.equal(direct.gain.value, 1, 'bypass preserves direct signal');
processorNode.port.onmessage({ data: { type: 'reduction', value: -7.5 } });
assert.equal(effect.getGainReduction(), -7.5);
effect.dispose(); effect.dispose();
assert.deepEqual(processorNode.port.messages, [{ type: 'dispose' }]);
delete globalThis.AudioWorkletNode;

const { compressorProcessorSource } = await load('src/audio/worklets/compressor-processor.ts');
let Processor;
class MockProcessor { constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); } }; } }
vm.runInNewContext(compressorProcessorSource, { sampleRate: 48000, AudioWorkletProcessor: MockProcessor,
  registerProcessor(name, klass) { assert.equal(name, 'compressor-processor'); Processor = klass; } });
const defaults = { threshold: [-30], ratio: [4], knee: [0], attack: [.003], release: [.2] };
function run(p, params, left, right = null) {
  const output = [new Float32Array(left.length), new Float32Array(left.length)];
  p.process([right ? [left, right] : [left]], [output], params);
  return output;
}
function samples(length, value) { return new Float32Array(length).fill(value); }
// 1:1 ratio must preserve every sample with no look-ahead or dry-path combing.
const identity = new Processor();
const impulse = samples(256, 0); impulse[0] = 0.5;
const uncompressed = run(identity, { ...defaults, ratio: [1] }, impulse);
assert.equal(uncompressed[0][0], .5);
assert.ok(uncompressed[0].slice(1).every((value) => value === 0));
assert.deepEqual(uncompressed[0], uncompressed[1], 'mono is duplicated to both channels');
// Input -10 dB and threshold -30 dB at 4:1 yields -15 dB reduction after settling.
const level = Math.pow(10, -10 / 20), steady = new Processor();
const stereo = run(steady, defaults, samples(96000, level), samples(96000, level / 2));
assert.ok(Math.abs(steady.reductionDb + 15) < .05);
assert.ok(Math.abs(stereo[0].at(-1) / stereo[1].at(-1) - 2) < 1e-5, 'linked channels use identical gain');
assert.ok(Math.abs(steady.port.messages.at(-1).value + 15) < .05, 'reported reduction follows measured gain');
const hard = new Processor(), soft = new Processor();
run(hard, { ...defaults, threshold: [-20], knee: [0] }, samples(96000, .1));
run(soft, { ...defaults, threshold: [-20], knee: [20] }, samples(96000, .1));
assert.ok(Math.abs(hard.reductionDb) < .02);
assert.ok(soft.reductionDb < -1, 'soft knee starts compressing at the threshold');
const fast = new Processor(), slow = new Processor();
run(fast, { ...defaults, attack: [.001] }, samples(960, 1));
run(slow, { ...defaults, attack: [.1] }, samples(960, 1));
assert.ok(fast.reductionDb < slow.reductionDb - 5, 'attack controls gain reduction response');
run(fast, { ...defaults, release: [.05] }, samples(9600, 0));
run(slow, { ...defaults, attack: [.001], release: [1] }, samples(9600, 1));
run(slow, { ...defaults, release: [1] }, samples(9600, 0));
assert.ok(fast.reductionDb > slow.reductionDb + 5, 'release controls recovery');
steady.port.onmessage({ data: { type: 'dispose' } });
assert.equal(steady.process([], [], defaults), false);
console.log('Compressor zero-latency, dynamics, stereo and lifecycle regression passed');
