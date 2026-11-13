import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync('src/audio/worklets/howl-guard-processor.ts', 'utf8').match(/`([\s\S]*)`;/)[1];
let Guard;
class Worklet { constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; } }
vm.runInNewContext(code, { AudioWorkletProcessor: Worklet, sampleRate: 48000, registerProcessor: (_, cls) => { Guard = cls; } });
function run(kind) {
  const guard = new Guard();
  guard.port.onmessage({ data: { enabled: true } });
  let output;
  for (let block = 0; block < 1200; block++) {
    const channel = Float32Array.from({ length: 128 }, (_, i) => {
      const t = (block * 128 + i) / 48000;
      return kind === 'silence' ? 0 : Math.sin(t * Math.PI * 2 * 440) * (kind === 'varying' ? 0.2 * (0.5 + 0.45 * Math.sin(t * 9)) : 0.2);
    });
    output = new Float32Array(128);
    const inputs = kind === 'right' ? [new Float32Array(128), channel] : [channel];
    guard.process([inputs], [[output]]);
  }
  return { guard, output };
}
const tone = run('tone');
assert.equal(tone.guard.messages.length, 1, 'sustained tone trips once');
assert.ok(tone.output.every(sample => sample === 0), 'tripped worklet immediately mutes output');
assert.equal(run('right').guard.messages.length, 1, 'right-only sustained tone trips');
assert.equal(run('silence').guard.messages.length, 0, 'silence does not trip');
assert.equal(run('varying').guard.messages.length, 0, 'varying amplitude does not trip');
console.log('Howl protection audio processing passed.');
