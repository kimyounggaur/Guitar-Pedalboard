import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

// 순수 함수(검사·자르기·정규화)는 한 번에 묶어 읽는다.
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const pure = await build({
  stdin: {
    contents: [
      "export { validateCabinetWav, validateImpulseSamples, limitImpulseLength, channelsOf, MAX_CAB_IR_BYTES, MAX_CAB_IR_SECONDS, MAX_CAB_IR_FILE_SECONDS, CAB_IR_CUT_FADE_SECONDS } from './audio/utils/cabinetIr.ts';",
      "export { normalizeUserImpulse, MAX_CAB_MAKEUP_DB } from './audio/utils/cabinet.ts';",
    ].join('\n'),
    resolveDir: srcDir, sourcefile: 'cabinet-ir-pure.ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const {
  validateCabinetWav, validateImpulseSamples, limitImpulseLength, channelsOf,
  MAX_CAB_IR_BYTES, MAX_CAB_IR_SECONDS, MAX_CAB_IR_FILE_SECONDS, CAB_IR_CUT_FADE_SECONDS,
  normalizeUserImpulse, MAX_CAB_MAKEUP_DB,
} = await import(`data:text/javascript;base64,${Buffer.from(pure.outputFiles[0].text).toString('base64')}`);

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

// ── 1. WAV 파일 검사 ────────────────────────────────────────────────────────────────────────
assert.equal(MAX_CAB_IR_SECONDS, 1, '컨볼버에 쓰는 길이는 1초(설계서 S5.4)');
assert.equal(MAX_CAB_IR_FILE_SECONDS, 10);
for (const data of [wav(), wav({ channels: 2 }), wav({ format: 3, bits: 32 }), wav({ seconds: 1 }),
  wav({ seconds: 1.5 }), wav({ seconds: 2.01 }), wav({ seconds: MAX_CAB_IR_FILE_SECONDS })]) validateCabinetWav(data);
for (const data of [wav({ seconds: MAX_CAB_IR_FILE_SECONDS + 0.01 }), wav({ channels: 4 }), wav({ format: 6 }), new ArrayBuffer(44), new ArrayBuffer(MAX_CAB_IR_BYTES + 1)]) {
  assert.throws(() => validateCabinetWav(data));
}
const truncated = wav(); new DataView(truncated).setUint32(40, 0xffffffff, true);
assert.throws(() => validateCabinetWav(truncated));

// ── 2. 1초 넘게 자르기 ──────────────────────────────────────────────────────────────────────
const ones = (frames, channels = 1) => ({ sampleRate: 48000, channels: Array.from({ length: channels }, () => new Float32Array(frames).fill(1)) });
{
  const half = limitImpulseLength(ones(24000));
  assert.equal(half.cut, false); assert.equal(half.channels[0].length, 24000); assert.equal(half.originalSeconds, 0.5);
  const input = ones(24000);
  assert.notEqual(limitImpulseLength(input).channels[0], input.channels[0], '입력 배열을 그대로 돌려주지 않는다');

  const exact = limitImpulseLength(ones(48000));
  assert.equal(exact.cut, false, '정확히 1초는 자르지 않는다'); assert.equal(exact.channels[0].length, 48000);
  assert.equal(exact.channels[0][47999], 1, '자르지 않으면 끝도 그대로');

  const rounding = limitImpulseLength(ones(48010));
  assert.equal(rounding.cut, false, '디코딩 오차(1 ms 이내)는 잘렸다고 알리지 않는다');
  assert.equal(rounding.channels[0].length, 48000, '그래도 컨볼버에는 1초만 넣는다');
  assert.equal(rounding.channels[0][47999], 1, '오차만큼 잘라낼 때는 페이드를 걸지 않는다');

  const over = limitImpulseLength(ones(48100));
  assert.equal(over.cut, true, '1 ms 를 넘으면 잘렸다고 알린다');

  const long = limitImpulseLength(ones(72000, 2));
  assert.equal(long.cut, true); assert.equal(long.originalSeconds, 1.5);
  assert.equal(long.channels.length, 2); assert.equal(long.channels[1].length, 48000);
  const fade = Math.round(CAB_IR_CUT_FADE_SECONDS * 48000);
  const tail = long.channels[0];
  assert.equal(tail[48000 - fade - 1], 1, '페이드 앞은 그대로');
  assert.ok(tail[48000 - fade] > 0.99, '페이드는 1 에서 시작');
  assert.equal(tail[47999], 0, '맨 끝은 0');
  for (let i = 48000 - fade + 1; i < 48000; i++) assert.ok(tail[i] <= tail[i - 1] + 1e-7, `페이드는 단조 감소(${i})`);
  assert.deepEqual(long.channels[1], long.channels[0], '두 채널을 같게 처리한다');
  const m = limitImpulseLength({ sampleRate: 44100, channels: [new Float32Array(66150).fill(1)] });
  assert.equal(m.channels[0].length, 44100, '44.1 kHz 도 1초');
}

// ── 3. 시료 검사 ────────────────────────────────────────────────────────────────────────────
validateImpulseSamples({ sampleRate: 48000, channels: [Float32Array.of(0, .2, -.1)] });
for (const bad of [[Float32Array.of(0, 0)], [Float32Array.of(NaN)], [Float32Array.of(9)], [Float32Array.of(.1), Float32Array.of(.1), Float32Array.of(.1)], [new Float32Array(0)], []]) {
  assert.throws(() => validateImpulseSamples({ sampleRate: 48000, channels: bad }));
}
{
  const fake = { numberOfChannels: 1, length: 3, sampleRate: 48000, getChannelData: () => Float32Array.of(1, 2, 3) };
  const taken = channelsOf(fake);
  assert.equal(taken.sampleRate, 48000); assert.deepEqual([...taken.channels[0]], [1, 2, 3]);
  assert.notEqual(taken.channels[0], fake.getChannelData(), '복사본이다');
  assert.throws(() => channelsOf({ ...fake, numberOfChannels: 4 }));
  assert.throws(() => channelsOf({ ...fake, length: 0 }));
}

// ── 4. 에너지 정규화 ────────────────────────────────────────────────────────────────────────
// 기준 스펙트럼: 여섯 줄의 기본음 × 배음 1~16, 가중 1/h². 정규화된 IR 의 이 가중 평균 이득이 1(0 dB)이어야 한다.
const FUNDAMENTALS = [82.4069, 110, 146.8324, 195.9977, 246.9417, 329.6276];
function magnitude(samples, rate, hz) {
  let re = 0, im = 0;
  for (let i = 0; i < samples.length; i++) { const a = -2 * Math.PI * hz * i / rate; re += samples[i] * Math.cos(a); im += samples[i] * Math.sin(a); }
  return Math.hypot(re, im);
}
function referenceGain(channels, rate) {
  let input = 0, output = 0;
  for (const f of FUNDAMENTALS) for (let h = 1; h <= 16; h++) {
    if (f * h >= rate / 2) continue;
    let energy = 0;
    for (const ch of channels) energy += magnitude(ch, rate, f * h) ** 2;
    input += 1 / (h * h); output += energy / channels.length / (h * h);
  }
  return Math.sqrt(output / input);
}
function lowpassedImpulse(frames, rate, tau, gain) {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = gain * Math.exp(-i / (rate * tau)) * (1 + 0.3 * Math.sin(i * 0.05));
  return out;
}
{
  const rate = 48000;
  const raw = [lowpassedImpulse(2400, rate, 0.002, 0.01)];
  const copy = Float32Array.from(raw[0]);
  const { channels, makeupDb } = normalizeUserImpulse(raw, rate);
  assert.deepEqual(raw[0], copy, '입력은 바뀌지 않는다');
  assert.ok(Math.abs(referenceGain(channels, rate) - 1) < 0.02, `정규화 뒤 기준 이득 ≈ 1 (실제 ${referenceGain(channels, rate)})`);
  assert.equal(makeupDb, 0, '피크 상한에 걸리지 않으면 보충 이득이 없다');

  // 크기 불변: IR 을 몇 배로 키워도 같은 결과
  const quiet = normalizeUserImpulse([raw[0].map((v) => v * 0.01)], rate).channels[0];
  const loud = normalizeUserImpulse([raw[0].map((v) => v * 30)], rate).channels[0];
  for (let i = 0; i < 2400; i += 97) assert.ok(Math.abs(quiet[i] - loud[i]) < 1e-5 * Math.max(1, Math.abs(loud[i])), '크기에 상관없이 같은 음량');

  // 피크 상한: 좁은 공진 IR 은 기준 음량까지 올리지 못하고, 부족분은 합성 경로 이득으로 보충(상한 MAX_CAB_MAKEUP_DB)
  const ringing = new Float32Array(4800);
  for (let i = 0; i < ringing.length; i++) ringing[i] = Math.exp(-i / 2400) * Math.sin(2 * Math.PI * 3000 * i / rate);
  const peaky = normalizeUserImpulse([ringing], rate);
  assert.ok(peaky.makeupDb > 0 && peaky.makeupDb <= MAX_CAB_MAKEUP_DB, `피크 상한에 걸리면 보충 이득이 생긴다(${peaky.makeupDb})`);
  const peakGain = Math.max(...[1000, 2000, 3000, 4000].map((hz) => magnitude(peaky.channels[0], rate, hz)));
  assert.ok(peakGain <= 10 ** (8 / 20) + 0.05, `대역 피크 ≤ +8 dB (${20 * Math.log10(peakGain)} dB)`);

  // 스테레오: 한 채널이 절반이면 평균 에너지로 맞춘다
  const left = lowpassedImpulse(2400, rate, 0.002, 0.01), right = left.map((v) => v * 0.5);
  const stereo = normalizeUserImpulse([left, right], rate);
  // 큰 채널이 피크 상한에 먼저 닿으면 IR 은 덜 올라가고, 모자란 만큼을 합성 경로 이득(makeupDb)이 채운다. 둘을 곱하면 1.
  const stereoTotal = referenceGain(stereo.channels, rate) * 10 ** (stereo.makeupDb / 20);
  assert.ok(Math.abs(stereoTotal - 1) < 0.02, `스테레오도 평균 기준 이득(보충 포함) ≈ 1 (실제 ${stereoTotal})`);
  assert.ok(Math.abs(stereo.channels[1][10] / stereo.channels[0][10] - 0.5) < 1e-5, '채널 사이 비율은 보존');

  // 44.1 kHz 에서도 같은 기준
  const raw44 = [lowpassedImpulse(2205, 44100, 0.002, 0.01)];
  assert.ok(Math.abs(referenceGain(normalizeUserImpulse(raw44, 44100).channels, 44100) - 1) < 0.02, '44.1 kHz');
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
const pedal = { id: 'cab', type: 'cab', active: true,
  params: { mix: 100, level: 100, model: 'v30-4x12', micPosition: 55, distance: 30, lowCut: 85, highCut: 5400, presence: 1.5 } };
const withParams = (params) => ({ ...pedal, params: { ...pedal.params, ...params } });
// S3.2: IR 교체는 페이드 뒤 타이머로 일어난다. 이 시험은 시계를 흉내 내지 않고 걸린 타이머를 차례로 모두 실행해 최종 상태만 본다
// (타이밍 자체는 scripts/cab-swap-regression.mjs 가 본다).
const queue = [];
const timers = {
  setTimeout: (callback) => { queue.push(callback); return queue.length; },
  clearTimeout: () => {},
};
const flush = () => { while (queue.length) queue.shift()(); };
const user = { impulse: null };
const effect = new CabEffect(context, pedal, timers, () => user.impulse);
const builtIn = convolver.buffer;
assert.equal(convolver.normalize, false, 'generated IR uses calibrated unnormalized convolution');
const custom = { numberOfChannels: 1, length: 3, getChannelData: () => Float32Array.of(0, .2, -.1) };
user.impulse = { buffer: custom, makeupDb: 0 };
effect.update(pedal);
flush();
assert.notEqual(convolver.buffer, custom, "모델이 '내 IR' 이 아니면 저장된 IR 이 있어도 쓰지 않는다");
effect.update(withParams({ model: 'my-ir' }));
flush();
assert.equal(convolver.buffer, custom);
assert.equal(convolver.normalize, false, '사용자 IR 은 앱이 정규화했으므로 컨볼버 정규화를 끈다');
effect.update(withParams({ model: 'my-ir', micPosition: 25 }));
flush();
assert.equal(convolver.buffer, custom, 'parameter changes do not silently discard the IR');
effect.update(withParams({ model: 'v30-4x12', micPosition: 25 }));
flush();
assert.notEqual(convolver.buffer, custom);
assert.equal(convolver.normalize, false, 'generated normalization restored after leaving the user IR');
assert.ok(convolver.buffer && builtIn, 'restoring the selected built-in IR works');
effect.dispose();
assert.equal(convolver.buffer, null, 'dispose releases the loaded IR');
console.log('Cabinet WAV IR validation, normalization and lifecycle passed');
