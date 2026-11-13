import assert from 'node:assert/strict';
import console from 'node:console';
import vm from 'node:vm';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const bundle = await build({ entryPoints: ['src/audio/worklets/peak-limiter-processor.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { peakLimiterProcessorSource } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let Processor;
vm.runInNewContext(peakLimiterProcessorSource, {
  sampleRate: 48000, AudioWorkletProcessor: class {},
  registerProcessor(name, klass) { assert.equal(name, 'peak-limiter-processor'); Processor = klass; },
});
function process(node, left, right) {
  const out = [new Float32Array(left.length), new Float32Array(left.length)];
  node.process([right ? [left, right] : [left]], [out]);
  return out;
}
const transparent = new Processor();
const quiet = new Float32Array([0, .1, -.5, .88]);
assert.deepEqual(process(transparent, quiet)[0], quiet, 'normal input remains unchanged');
assert.deepEqual(process(new Processor(), quiet)[1], quiet, 'mono input is copied to both outputs');
const linked = new Processor();
const left = new Float32Array([.1, .1, .1]), right = new Float32Array([2, -.1, NaN]);
const out = process(linked, left, right);
assert.ok(Math.abs(out[1][0] - .89) < 1e-7, 'right-channel peak is limited');
assert.ok(Math.abs(out[0][0] - .0445) < 1e-7, 'same gain is applied to the left channel');
assert.equal(out[1][2], 0, 'NaN is replaced with silence');
const release = new Processor();
process(release, new Float32Array([2]), new Float32Array([0]));
process(release, new Float32Array(2400).fill(.1));
assert.ok(Math.abs(release.gain - (1 - (1 - .445) * Math.exp(-1))) < 1e-5, '50 ms release time constant');
const audio = new Processor();
let max = 0, nonfinite = false, halfSample;
for (let block = 0; block < 100; block++) {
  const l = new Float32Array(128), r = new Float32Array(128);
  for (let i = 0; i < l.length; i++) {
    const sample = 1.5 * Math.sin(2 * Math.PI * 500 * (block * 128 + i) / 48000);
    l[i] = sample; r[i] = sample / 2;
  }
  const [a, b] = process(audio, l, r);
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i]), Math.abs(b[i]));
    nonfinite ||= !Number.isFinite(a[i]) || !Number.isFinite(b[i]);
    if (block > 50 && Math.abs(l[i] - .75) < .001) halfSample = a[i];
  }
}
assert.ok(max <= .8900001 && !nonfinite, 'sample peak ceiling holds for sustained overload');
assert.ok(halfSample > .40 && halfSample < .50, 'sustained overloaded sine keeps its shape');
const engine = await readFile('src/audio/AudioEngine.ts', 'utf8');
assert.match(engine, /this\.howlGuard\.connect\(this\.limiter\)/);
assert.match(engine, /this\.limiter\.connect\(this\.context\.destination\)/);
assert.match(engine, /this\.limiter\?\.connect\(this\.recorderDestination\)/, 'recording taps the same limited signal');
console.log('Peak limiter transparency, ceiling, stereo, release and recording route passed');
