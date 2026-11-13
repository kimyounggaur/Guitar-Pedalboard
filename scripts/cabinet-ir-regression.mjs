import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/audio/utils/cabinetIr.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { validateCabinetWav, validateDecodedCabinetIr, MAX_CAB_IR_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function wav({ channels = 1, sampleRate = 48000, bits = 16, seconds = .1, format = 1 } = {}) {
  const align = channels * bits / 8, size = Math.round(seconds * sampleRate) * align;
  const data = new ArrayBuffer(44 + size), view = new DataView(data);
  for (const [at, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i));
  }
  view.setUint32(4, data.byteLength - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, format, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * align, true);
  view.setUint16(32, align, true); view.setUint16(34, bits, true); view.setUint32(40, size, true);
  return data;
}
for (const data of [wav(), wav({ channels: 2 }), wav({ format: 3, bits: 32 }), wav({ seconds: 2 })]) validateCabinetWav(data);
for (const data of [wav({ seconds: 2.01 }), wav({ channels: 4 }), wav({ format: 6 }), new ArrayBuffer(44), new ArrayBuffer(MAX_CAB_IR_BYTES + 1)]) {
  assert.throws(() => validateCabinetWav(data));
}
const truncated = wav(); new DataView(truncated).setUint32(40, 0xffffffff, true);
assert.throws(() => validateCabinetWav(truncated));
function decoded(samples, duration = 1) { return { numberOfChannels: 1, duration, getChannelData: () => new Float32Array(samples) }; }
validateDecodedCabinetIr(decoded([0, .2, -.1]));
for (const value of [decoded([0, 0]), decoded([NaN]), decoded([9]), decoded([.1], 3)]) {
  assert.throws(() => validateDecodedCabinetIr(value));
}
const effectBundle = await build({ entryPoints: ['src/audio/nodes/CabEffect.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { CabEffect } = await import(`data:text/javascript;base64,${Buffer.from(effectBundle.outputFiles[0].text).toString('base64')}`);
class Param {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param();
  connect() {} disconnect() {}
}
let convolver;
const context = {
  sampleRate: 48000, currentTime: 0,
  createGain: () => new Node(), createBiquadFilter: () => new Node(),
  createConvolver: () => { convolver = new Node(); convolver.buffer = null; return convolver; },
  createBuffer: (count, length) => {
    const data = Array.from({ length: count }, () => new Float32Array(length));
    return { numberOfChannels: count, getChannelData: (ch) => data[ch] };
  },
};
const pedal = { id: 'cab', type: 'cab', enabled: true, bypassed: false,
  params: { mix: 100, level: 100, model: 'v30-4x12', micPosition: 55, distance: 30, lowCut: 85, highCut: 5400, presence: 1.5 } };
const effect = new CabEffect(context, pedal);
const builtIn = convolver.buffer;
assert.equal(convolver.normalize, false, 'generated IR uses calibrated unnormalized convolution');
const custom = decoded([0, .2, -.1]);
effect.setCustomImpulse(custom);
assert.equal(convolver.buffer, custom);
assert.equal(convolver.normalize, true, 'custom IR retains Web Audio normalization');
effect.update({ ...pedal, params: { ...pedal.params, micPosition: 25 } });
assert.equal(convolver.buffer, custom, 'parameter changes do not silently discard the IR');
effect.setCustomImpulse(null);
assert.notEqual(convolver.buffer, custom);
assert.equal(convolver.normalize, false, 'generated normalization restored after custom IR removal');
assert.ok(convolver.buffer && builtIn, 'restoring the selected built-in IR works');
effect.dispose();
assert.equal(convolver.buffer, null, 'dispose releases the loaded IR');
console.log('Cabinet WAV IR validation and lifecycle passed');
