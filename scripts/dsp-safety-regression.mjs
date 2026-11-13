import assert from 'node:assert/strict';
import console from 'node:console';
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { createCrunchCurve } = await load('src/audio/utils/curves.ts');
for (const gain of [0, 25, 50, 75, 100]) {
  const curve = createCrunchCurve(gain, 4097);
  const mid = (curve.length - 1) / 2;
  assert.equal(curve[mid], 0, `gain ${gain}: silence must stay silent`);
  assert.ok(Math.abs(curve[mid + 1] - curve[mid - 1]) < 0.015, `gain ${gain}: no jump around zero`);
  assert.ok(curve.every(Number.isFinite));
}
const { createCabinetImpulse } = await load('src/audio/utils/cabinet.ts');
const context = { sampleRate: 48000, createBuffer(channels, length, sampleRate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, getChannelData(channel) { return data[channel]; } };
} };
for (const model of ['v30-4x12', 'off']) {
  const impulse = createCabinetImpulse(context, model, 55, 30);
  assert.deepEqual(impulse.getChannelData(0), impulse.getChannelData(1), `${model}: mono cabinet response must be balanced`);
}
console.log('DSP continuity and cabinet balance passed');
