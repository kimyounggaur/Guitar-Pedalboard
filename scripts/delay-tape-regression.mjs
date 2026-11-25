// S3.3 Delay Tape 음정 흔들림 — 느린 와우 0.8 Hz + 빠른 플러터 6.5 Hz 두 LFO (설계서 S3.3, 보고서 R3-3, 프로브 P-10·P-26) 시험.
//   1. 상수: 지연 깊이(초) = 목표 주파수 편차 / (2π × LFO 주파수). 와우 ±0.3%, 플러터 ±0.1%, 둘이 겹쳐도 ±0.4% 로 수용 기준(±0.6%) 안이다.
//   2. 실제 DelayEffect(가짜 오디오 컨텍스트): 사인 오실레이터가 정확히 둘(0.8·6.5 Hz)이고 각자 게인을 거쳐 주 딜레이의 delayTime 에만 들어간다.
//      Tape 에서는 두 게인이 위 깊이로, 다른 모든 방식(Digital·Analog·Slapback·Pingpong)에서는 0 이다.
//   3. 방식을 오가도 오실레이터 주파수는 건드리지 않는다(주파수를 바꾸면 위상이 튄다) — 깊이만 따라간다. 끝낼 때(dispose) 둘 다 멈추고 끊는다.
//   4. 핑퐁 배선: 주 딜레이 T/2, 되먹임 루프의 두 딜레이 T → 첫 반복음 T/2, 그 뒤 T 간격 좌우 번갈아(10월 계획서 M-7). 같은 값을 프로브 P-26 이 소리로 잰다.
//   5. 소스 단언: 옛 상수(깊이 0.0002 s·4.2 Hz·4.6 Hz)가 남아 있지 않다.
// 실제 소리로 잰 1 kHz 반복음의 순간 주파수 편차(≤ ±0.6%)는 프로브 P-10(npm run probe, npm test 에 들어 있다)이 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const near = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected} (±${tolerance})`);
  checks += 1;
};

const rootUrl = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, rootUrl), 'utf8');

// ---------------------------------------------------------------------------------------------
// 묶기
// ---------------------------------------------------------------------------------------------
const bundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { DelayEffect, TAPE_WOW_HZ, TAPE_WOW_DEPTH_S, TAPE_FLUTTER_HZ, TAPE_FLUTTER_DEPTH_S } from './audio/nodes/DelayEffect.ts';",
      "export { delayTimeSeconds } from './audio/params/definitions/delay.ts';",
      "export { initialPedals } from './presets/initialPedals.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('src', rootUrl)),
    sourcefile: 'delay-tape-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { DelayEffect, TAPE_WOW_HZ, TAPE_WOW_DEPTH_S, TAPE_FLUTTER_HZ, TAPE_FLUTTER_DEPTH_S, delayTimeSeconds, initialPedals } = harness;

// ---------------------------------------------------------------------------------------------
// 1. 상수
// ---------------------------------------------------------------------------------------------
equal(TAPE_WOW_HZ, 0.8, '와우 LFO 는 0.8 Hz(설계서)');
equal(TAPE_FLUTTER_HZ, 6.5, '플러터 LFO 는 6.5 Hz(설계서)');
near(TAPE_WOW_DEPTH_S, 0.003 / (2 * Math.PI * 0.8), 1e-15, '와우 깊이(초) = 0.003 / (2π·0.8)');
near(TAPE_FLUTTER_DEPTH_S, 0.001 / (2 * Math.PI * 6.5), 1e-15, '플러터 깊이(초) = 0.001 / (2π·6.5)');
const wowDeviation = TAPE_WOW_DEPTH_S * 2 * Math.PI * TAPE_WOW_HZ;
const flutterDeviation = TAPE_FLUTTER_DEPTH_S * 2 * Math.PI * TAPE_FLUTTER_HZ;
near(wowDeviation, 0.003, 1e-12, '와우의 음정 편차는 ±0.3%');
near(flutterDeviation, 0.001, 1e-12, '플러터의 음정 편차는 ±0.1%');
ok(TAPE_WOW_HZ < TAPE_FLUTTER_HZ, '와우가 플러터보다 느리다');
ok(TAPE_WOW_DEPTH_S > TAPE_FLUTTER_DEPTH_S, '느린 와우가 더 깊다(귀에 들리는 천천히 일렁이는 음정)');
// 두 LFO 를 겹친 지연 d(t) = A1·sin(2π f1 t) + A2·sin(2π f2 t) 의 순간 주파수 편차 |d'(t)| 는 어떤 시각에서도 ±0.4% 를 넘지 않고, 와우 단독 최대(±0.3%)는 넘는다.
{
  let peak = 0;
  for (let step = 0; step < 400000; step += 1) {
    const t = step / 40000; // 10초, 0.025 ms 간격
    const speed = TAPE_WOW_DEPTH_S * 2 * Math.PI * TAPE_WOW_HZ * Math.cos(2 * Math.PI * TAPE_WOW_HZ * t)
      + TAPE_FLUTTER_DEPTH_S * 2 * Math.PI * TAPE_FLUTTER_HZ * Math.cos(2 * Math.PI * TAPE_FLUTTER_HZ * t);
    peak = Math.max(peak, Math.abs(speed));
  }
  ok(peak <= 0.004 + 1e-9, `겹친 최대 편차 ${peak} 는 ±0.4% 이하`);
  ok(peak > 0.003, `겹친 최대 편차 ${peak} 는 와우 단독(±0.3%)보다 크다 — 플러터가 실제로 더해진다`);
  ok(peak <= 0.006, '수용 기준 ±0.6% 안');
}

// ---------------------------------------------------------------------------------------------
// 가짜 오디오 컨텍스트 — 노드의 연결과 파라미터 자동화를 기록한다
// ---------------------------------------------------------------------------------------------
class Param {
  valueWrites = 0;
  calls = 0; // 자동화 호출(setTargetAtTime 등) 횟수
  target = 0;
  #value = 0;
  get value() { return this.#value; }
  set value(next) { this.#value = next; this.target = next; this.valueWrites += 1; }
  setValueAtTime(value) { this.calls += 1; this.#value = value; this.target = value; return this; }
  linearRampToValueAtTime(value) { this.calls += 1; this.target = value; return this; }
  exponentialRampToValueAtTime(value) { this.calls += 1; this.target = value; return this; }
  setTargetAtTime(value) { this.calls += 1; this.target = value; return this; }
  setValueCurveAtTime() { this.calls += 1; return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}
function fakeNode(kind) {
  const own = { kind, connections: [], started: false, stopped: false, disconnected: false };
  own.connect = (destination) => { own.connections.push(destination); return destination; };
  own.disconnect = () => { own.disconnected = true; };
  own.start = () => { own.started = true; };
  own.stop = () => { own.stopped = true; };
  own.addEventListener = () => undefined;
  own.removeEventListener = () => undefined;
  own.getFrequencyResponse = () => undefined;
  return new Proxy(own, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      target[key] = new Param(); // 모르는 속성은 AudioParam 으로 본다(gain·frequency·delayTime·pan 등)
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}
function fakeContext() {
  const nodes = [];
  const context = new Proxy({ currentTime: 0, sampleRate: 48000, state: 'running', nodes }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'string' && key.startsWith('create')) {
        const kind = key.slice('create'.length);
        return () => { const node = fakeNode(kind); nodes.push(node); return node; };
      }
      return undefined;
    },
  });
  return context;
}
globalThis.window = { setTimeout: () => 1, clearTimeout: () => undefined };

const delayPedal = (params = {}, active = true) => {
  const base = initialPedals.find((candidate) => candidate.type === 'delay');
  assert.ok(base, '기본 구성에 딜레이가 있다');
  const copy = JSON.parse(JSON.stringify(base));
  return { ...copy, active, params: { ...copy.params, ...params } };
};
const make = (params, active = true) => {
  const context = fakeContext();
  const effect = new DelayEffect(context, delayPedal(params, active));
  const oscillators = context.nodes.filter((node) => node.kind === 'Oscillator');
  const delays = context.nodes.filter((node) => node.kind === 'Delay');
  return { context, effect, oscillators, delays };
};

// ---------------------------------------------------------------------------------------------
// 2. Tape: 오실레이터 둘, 각자 게인을 거쳐 주 딜레이의 delayTime 에만 들어간다
// ---------------------------------------------------------------------------------------------
{
  const { context, effect, oscillators, delays } = make({ mode: 'tape' });
  equal(oscillators.length, 2, 'LFO 오실레이터는 정확히 둘(와우·플러터)');
  const [wow, flutter] = oscillators;
  for (const [name, oscillator, hz] of [['와우', wow, TAPE_WOW_HZ], ['플러터', flutter, TAPE_FLUTTER_HZ]]) {
    equal(oscillator.type, 'sine', `${name}: 사인 LFO`);
    equal(oscillator.frequency.value, hz, `${name}: 주파수 ${hz} Hz`);
    ok(oscillator.started, `${name}: 시작했다`);
    equal(oscillator.connections.length, 1, `${name}: 연결은 하나(깊이 게인)`);
  }
  equal(delays.length, 3, '딜레이는 셋(주 딜레이 + 핑퐁 되먹임 둘)');
  const [mainDelay, leftLoop, rightLoop] = delays;
  const wowGain = wow.connections[0];
  const flutterGain = flutter.connections[0];
  equal(wowGain.kind, 'Gain', '와우는 게인으로 간다');
  equal(flutterGain.kind, 'Gain', '플러터는 게인으로 간다');
  ok(wowGain !== flutterGain, '두 LFO 는 각자 깊이 게인을 가진다');
  equal(wowGain.connections.length, 1, '와우 게인의 출력은 하나');
  equal(flutterGain.connections.length, 1, '플러터 게인의 출력은 하나');
  ok(wowGain.connections[0] === mainDelay.delayTime, '와우 → 주 딜레이 delayTime');
  ok(flutterGain.connections[0] === mainDelay.delayTime, '플러터 → 주 딜레이 delayTime');
  // 되먹임 루프의 딜레이 시간은 흔들지 않는다 — 흔들면 반복마다 누적되어 음정이 크게 틀어진다
  const modulated = context.nodes.filter((node) => node.connections.includes(leftLoop.delayTime) || node.connections.includes(rightLoop.delayTime));
  equal(modulated.length, 0, '핑퐁 되먹임 딜레이의 delayTime 에는 LFO 가 들어가지 않는다');
  near(wowGain.gain.target, TAPE_WOW_DEPTH_S, 1e-15, 'Tape: 와우 깊이');
  near(flutterGain.gain.target, TAPE_FLUTTER_DEPTH_S, 1e-15, 'Tape: 플러터 깊이');
  effect.dispose();
}

// ---------------------------------------------------------------------------------------------
// 3-a. 다른 방식에서는 깊이 0 (LFO 는 돌지만 지연을 흔들지 않는다)
// ---------------------------------------------------------------------------------------------
for (const mode of ['digital', 'analog', 'slapback', 'pingpong']) {
  const { oscillators } = make({ mode });
  equal(oscillators.length, 2, `${mode}: 오실레이터 둘`);
  for (const oscillator of oscillators) {
    equal(oscillator.connections[0].gain.target, 0, `${mode}: LFO 깊이 0 — 지연을 흔들지 않는다`);
  }
}

// ---------------------------------------------------------------------------------------------
// 3-b. 방식을 오가도 주파수는 그대로, 깊이만 따라간다
// ---------------------------------------------------------------------------------------------
{
  const { effect, oscillators } = make({ mode: 'digital' });
  const [wow, flutter] = oscillators;
  const writesBefore = [wow.frequency.valueWrites, flutter.frequency.valueWrites];
  const callsBefore = [wow.frequency.calls, flutter.frequency.calls];
  const gains = [wow.connections[0].gain, flutter.connections[0].gain];
  const sequence = ['tape', 'digital', 'tape', 'analog', 'tape', 'pingpong', 'slapback', 'tape'];
  for (const mode of sequence) {
    effect.update(delayPedal({ mode }));
    const depths = mode === 'tape' ? [TAPE_WOW_DEPTH_S, TAPE_FLUTTER_DEPTH_S] : [0, 0];
    near(gains[0].target, depths[0], 1e-15, `${mode}: 와우 깊이가 방식을 따른다`);
    near(gains[1].target, depths[1], 1e-15, `${mode}: 플러터 깊이가 방식을 따른다`);
  }
  equal(wow.frequency.valueWrites, writesBefore[0], '와우 주파수는 방식을 바꿔도 다시 쓰지 않는다(위상이 튀지 않는다)');
  equal(flutter.frequency.valueWrites, writesBefore[1], '플러터 주파수도 마찬가지');
  equal(wow.frequency.calls, callsBefore[0], '와우 주파수에 자동화를 걸지 않는다');
  equal(flutter.frequency.calls, callsBefore[1], '플러터 주파수에 자동화를 걸지 않는다');
  // 다른 파라미터(시간·피드백·톤·Mix)를 바꿔도 깊이는 그대로
  effect.update(delayPedal({ mode: 'tape', timeMs: 700, feedback: 0.8, tone: 20, mix: 55 }));
  near(gains[0].target, TAPE_WOW_DEPTH_S, 1e-15, 'Tape 에서 시간·피드백·톤·Mix 를 바꿔도 와우 깊이 그대로');
  near(gains[1].target, TAPE_FLUTTER_DEPTH_S, 1e-15, 'Tape 에서 시간·피드백·톤·Mix 를 바꿔도 플러터 깊이 그대로');
  // 꺼도(우회) 깊이는 모드가 정한다 — 꺼진 Tape 의 꼬리(trails)도 같은 테이프 질감을 유지한다
  effect.update(delayPedal({ mode: 'tape' }, false));
  near(gains[0].target, TAPE_WOW_DEPTH_S, 1e-15, '꺼진 Tape: 꼬리의 와우 깊이도 그대로');
  effect.dispose();
}

// ---------------------------------------------------------------------------------------------
// 3-c. dispose
// ---------------------------------------------------------------------------------------------
{
  const { effect, oscillators } = make({ mode: 'tape' });
  effect.dispose();
  for (const oscillator of oscillators) {
    ok(oscillator.stopped, 'dispose: 오실레이터 정지');
    ok(oscillator.disconnected, 'dispose: 오실레이터 연결 해제');
    ok(oscillator.connections[0].disconnected, 'dispose: 깊이 게인 연결 해제');
  }
}

// ---------------------------------------------------------------------------------------------
// 4. 핑퐁 배선: 첫 반복음 T/2, 이후 T 간격
// ---------------------------------------------------------------------------------------------
{
  const sync = { sync: true, bpm: 120, division: '1/4' };
  equal(delayTimeSeconds({ mode: 'pingpong', timeMs: 280, ...sync }), 0.5, 'Sync 120 BPM 1/4 → T = 500 ms');
  const { delays } = make({ mode: 'pingpong', ...sync });
  const [mainDelay, leftLoop, rightLoop] = delays;
  near(mainDelay.delayTime.target, 0.25, 1e-12, '핑퐁: 주 딜레이는 T/2 = 250 ms(첫 반복음)');
  near(leftLoop.delayTime.target, 0.5, 1e-12, '핑퐁: 왼쪽 되먹임 딜레이는 T');
  near(rightLoop.delayTime.target, 0.5, 1e-12, '핑퐁: 오른쪽 되먹임 딜레이는 T');
  // 반복음 시각표: 첫 = T/2(왼쪽), 이후 T 간격으로 오른쪽·왼쪽…
  const taps = [0, 1, 2, 3].map((k) => (mainDelay.delayTime.target + k * leftLoop.delayTime.target) * 1000);
  const expected = [250, 750, 1250, 1750];
  taps.forEach((value, index) => near(value, expected[index], 1e-9, `핑퐁 반복음 ${index + 1}: ${expected[index]} ms`));
  // 핑퐁이 아니면 주 딜레이가 T 다(첫 반복음 = T = 500 ms, 이후 T 간격 — 설계서의 500·1,000·1,500 ms 는 이쪽이다)
  const digital = make({ mode: 'digital', ...sync }).delays;
  near(digital[0].delayTime.target, 0.5, 1e-12, 'Digital: 주 딜레이는 T = 500 ms');
}

// ---------------------------------------------------------------------------------------------
// 5. 소스 단언
// ---------------------------------------------------------------------------------------------
{
  const source = await read('src/audio/nodes/DelayEffect.ts');
  for (const old of ['0.0002', '? 4.2 :', 'frequency.value = 4.6', ': 0.1,']) {
    ok(!source.includes(old), `옛 플러터 상수 ${old} 가 남아 있지 않다`);
  }
  ok(/this\.wowDepth\.connect\(this\.delay\.delayTime\)/.test(source), '와우 깊이는 주 딜레이 delayTime 으로');
  ok(/this\.flutterDepth\.connect\(this\.delay\.delayTime\)/.test(source), '플러터 깊이는 주 딜레이 delayTime 으로');
  ok(/smoothParam\(this\.wowDepth\.gain,/.test(source) && /smoothParam\(this\.flutterDepth\.gain,/.test(source), '깊이는 smoothParam 으로 바꾼다(클릭 없이)');
  ok(!/this\.(wow|flutter)\.frequency\.(?:setTargetAtTime|linearRamp)|smoothParam\(this\.(wow|flutter)\.frequency/.test(source), 'LFO 주파수는 갱신 때 건드리지 않는다');
}

console.log(`delay-tape-regression: ${checks} checks passed`);
