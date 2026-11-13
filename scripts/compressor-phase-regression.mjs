import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/audio/nodes/CompressorEffect.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { CompressorEffect } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
class Param {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}
class Node {
  connections = new Set();
  gain = new Param();
  connect(node) { this.connections.add(node); }
  disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
}
const nodes = [];
const context = {
  currentTime: 0,
  createGain() { const node = new Node(); nodes.push(node); return node; },
  createDelay(maxDelay) { assert.ok(maxDelay >= 0.006); const node = new Node(); node.delayTime = new Param(); nodes.push(node); return node; },
  createDynamicsCompressor() { const node = new Node(); node.reduction = -7.5; for (const field of ['threshold', 'ratio', 'attack', 'release', 'knee']) node[field] = new Param(); nodes.push(node); return node; },
};
const effect = new CompressorEffect(context, {
  id: 'compressor', type: 'compressor', enabled: true, bypassed: false,
  params: { mix: 45, level: 100, sustain: 0, threshold: -30, ratio: 4, attack: .003, release: .2, knee: 20 },
});
assert.equal(effect.getGainReduction(), -7.5, 'report the compressor node measurement');
const delay = nodes.find((node) => node.delayTime);
assert.equal(delay.delayTime.value, 0.006);
const dry = [...delay.connections][0];
assert.ok(dry, 'dry delay must feed the dry gain');
const gate = nodes.find((node) => node.connections.has(delay));
assert.ok(gate, 'dry delay must follow the active effect gate');
assert.ok(!gate.connections.has(dry), 'dry branch must not retain a direct connection');
assert.ok(effect.input.connections.size === 2, 'separate bypass path remains available');
effect.dispose();
assert.equal(delay.connections.size, 0);
console.log('Compressor parallel path alignment and cleanup passed');
