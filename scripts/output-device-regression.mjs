import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

class MockAudioContext {
  async setSinkId(id) {
    if (id === 'denied') throw new Error('permission denied');
    this.sinkId = id;
  }
}
globalThis.AudioContext = MockAudioContext;
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/AudioEngine.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const { AudioEngine } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const engine = AudioEngine.getInstance();
assert.equal(engine.supportsOutputSelection, true);
await engine.setOutputDevice('speakers');
const context = new MockAudioContext();
await engine.applyOutputDevice(context);
assert.equal(context.sinkId, 'speakers');
engine.context = context;
const graph = { connected: true };
engine.recorderDestination = graph;
await engine.setOutputDevice('headphones');
assert.equal(context.sinkId, 'headphones');
assert.equal(engine.recorderDestination, graph);
await assert.rejects(engine.setOutputDevice('denied'));
assert.equal(engine.outputDeviceId, 'headphones');
const second = new MockAudioContext();
await engine.applyOutputDevice(second);
assert.equal(second.sinkId, 'headphones');
const source = await readFile(new URL('../src/audio/AudioEngine.ts', import.meta.url), 'utf8');
assert.equal((source.match(/await this\.applyOutputDevice\(context\)/g) ?? []).length, 2);
delete MockAudioContext.prototype.setSinkId;
assert.equal(engine.supportsOutputSelection, false);
await assert.rejects(engine.setOutputDevice('other'));
console.log('Output device regression passed: retained selection, session restoration, errors and graph preservation.');
