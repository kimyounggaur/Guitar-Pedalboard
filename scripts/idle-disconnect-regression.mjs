// S4.2 꺼진 페달 쉬기(기능 플래그 idleDisconnect)의 시험.
//  1) 플래그: 기본 켜짐, 이름 목록, 주소 읽기
//  2) BaseEffect 의 쉬기 관리: 꺼진 뒤 페이드+여유(22 ms)가 지나야 입력(effectGate → effectInput)을 끊고, 그 전에 다시 켜면 끊지 않으며,
//     쉬던 것이 켜지면 바로 잇는다. 처음부터 꺼져 있으면 기다리지 않고 바로 쉰다. 플래그를 끄면 아무것도 끊지 않고 타이머도 걸지 않는다. dispose 가 타이머를 치운다.
//  3) Delay: Trails 가 켜져 있으면 되먹임 꼬리가 −60 dB 로 줄 때까지(지연 × (n+1)) 기다린 뒤 쉬고, 쉴 때 되먹임 이득(모노·Ping-Pong 둘)을 0 으로 끊고,
//     깨어날 때 최신 목표값으로 바로 되돌린다(쉬는 동안 바뀐 값 포함). Trails 가 꺼져 있으면 22 ms.
//  4) 워클릿 5개(Compressor·Envelope Follower·Flanger·Noise Gate·Phaser): 입력이 끊긴 블록에서 절대 false 를 돌려주지 않고(Chromium 은 false 를 돌려준 처리기를
//     입력을 다시 이어도 다시 부르지 않는다 — 실측으로 확인했다, REFACTOR_LOG L-267), 상태를 비우며, 입력이 돌아오면 다시 소리를 낸다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

const rootUrl = new URL('../', import.meta.url);
const importBundle = async (result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected} (±${tolerance})`);

const bundle = async (contents, sourcefile) => importBundle(
  await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL('src', rootUrl)), sourcefile },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  }),
);

// 플래그·타이머 모듈을 이펙트와 같은 번들에 넣어야 시험이 정한 값을 이펙트가 본다.
const harness = await bundle(
  [
    "export * from './config/flags.ts';",
    "export * from './audio/utils/timers.ts';",
    "export { DriveEffect } from './audio/nodes/DriveEffect.ts';",
    "export { DelayEffect } from './audio/nodes/DelayEffect.ts';",
    "export { initialPedals } from './presets/initialPedals.ts';",
  ].join('\n'),
  'idle-harness.ts',
);
const {
  FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_NAMES, parseFeatureFlags, isFeatureEnabled, setFeatureFlagOverride, resetFeatureFlagOverrides,
  setContextTimers, clearContextTimers, timersFor, windowTimers, DriveEffect, DelayEffect, initialPedals,
} = harness;

// ---------------------------------------------------------------------------------------------
// 1. 플래그
// ---------------------------------------------------------------------------------------------
assert.ok(FEATURE_FLAG_NAMES.includes('idleDisconnect'), '플래그 이름 목록에 있다');
assert.equal(FEATURE_FLAG_DEFAULTS.idleDisconnect, true, '기본값은 켜짐(S4.2)');
assert.equal(isFeatureEnabled('idleDisconnect'), true);
assert.deepEqual(parseFeatureFlags('?ff=-idleDisconnect'), { idleDisconnect: false });
assert.deepEqual(parseFeatureFlags('?ff=idleDisconnect'), { idleDisconnect: true });
assert.deepEqual(parseFeatureFlags('?ff=idle'), {}, '이름이 같아야 한다');
setFeatureFlagOverride('idleDisconnect', false);
assert.equal(isFeatureEnabled('idleDisconnect'), false);
resetFeatureFlagOverrides();
assert.equal(isFeatureEnabled('idleDisconnect'), true);

// ---------------------------------------------------------------------------------------------
// 도우미: 가짜 오디오 컨텍스트(연결을 기억한다)와 손으로 돌리는 시계
// ---------------------------------------------------------------------------------------------
class Param {
  constructor(value = 0) { this.value = value; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
  // 마지막으로 값을 정한 방식('value' = 바로, 'target' = 부드럽게)을 기억해 깨어날 때 바로 놓는지 본다.
  setValueAtTime(value) { this.value = value; this.via = 'value'; }
  linearRampToValueAtTime(value) { this.value = value; this.via = 'ramp'; }
  setTargetAtTime(value) { this.value = value; this.via = 'target'; }
}
class FakeNode {
  constructor() {
    this.edges = new Set();
    this.gain = new Param(1);
    this.frequency = new Param(); this.Q = new Param(); this.detune = new Param(); this.delayTime = new Param(); this.pan = new Param();
  }
  connect(destination) { this.edges.add(destination); return destination; }
  disconnect(destination) { if (destination === undefined) this.edges.clear(); else this.edges.delete(destination); }
  start() {}
  stop() {}
}
const fakeContext = (sampleRate = 48000) => new Proxy({ sampleRate, currentTime: 0 }, {
  get: (target, name) => (typeof name === 'string' && name.startsWith('create') ? () => new FakeNode() : target[name]),
});
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  const scheduled = [];
  return {
    setTimeout(callback, milliseconds) { const id = nextId; nextId += 1; pending.set(id, { at: now + milliseconds, callback }); scheduled.push(milliseconds); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now + 1e-6) { pending.delete(id); timer.callback(); }
      }
    },
    get pending() { return pending.size; },
    get scheduled() { return scheduled; },
  };
}
const stateOf = (id, overrides = {}, active = true) => {
  const base = initialPedals.find((candidate) => candidate.id === id);
  assert.ok(base, `기본 페달 ${id}`);
  const copy = JSON.parse(JSON.stringify(base));
  return { ...copy, active, params: { ...copy.params, ...overrides } };
};
const connected = (effect) => effect.effectGate.edges.has(effect.effectInput);
const make = (Effect, pedalState) => {
  const context = fakeContext();
  const timers = fakeTimers();
  setContextTimers(context, timers);
  return { context, timers, effect: new Effect(context, pedalState) };
};

// 컨텍스트에 시계를 등록하지 않으면 창 타이머. 창이 없는 Node 에서도 터지지 않고 돌며, 이벤트 루프를 붙잡지 않는다(unref).
assert.equal(timersFor({}), windowTimers, '등록이 없으면 창 타이머');
{
  let fired = 0;
  const handle = windowTimers.setTimeout(() => { fired += 1; }, 5);
  windowTimers.clearTimeout(handle);
  const kept = windowTimers.setTimeout(() => { fired += 10; }, 5);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 30));
  assert.equal(fired, 10, 'Node 에서도 창 타이머가 돌고, 지운 것은 돌지 않는다');
  assert.ok(kept !== undefined);
}
{
  const context = {};
  const timers = fakeTimers();
  setContextTimers(context, timers);
  assert.equal(timersFor(context), timers, '등록한 시계를 돌려준다');
  // 렌더가 끝나면 등록을 지운다: 남겨 두면 컨텍스트가 수거되지 않아 프로브가 멈춘다(L-268)
  clearContextTimers(context);
  assert.equal(timersFor(context), windowTimers, '등록을 지우면 다시 창 타이머');
}

// ---------------------------------------------------------------------------------------------
// 2. BaseEffect 의 쉬기 관리 (Drive: Trails 없음)
// ---------------------------------------------------------------------------------------------
{
  // 켠 채 만들면 이어져 있고 타이머가 없다
  const { effect, timers } = make(DriveEffect, stateOf('drive'));
  assert.equal(connected(effect), true, '켠 채 만들면 이어짐');
  assert.equal(timers.pending, 0, '타이머 없음');

  // 끄면 22 ms 뒤에 끊는다(그 전에는 이어져 있다: 페이드 아웃이 끝나야 한다)
  effect.update(stateOf('drive', {}, false));
  assert.equal(connected(effect), true, '끈 직후는 이어짐');
  assert.equal(timers.pending, 1);
  near(timers.scheduled.at(-1), 22, 0.01, '대기 시간(페이드 12 ms + 여유 10 ms)');
  timers.advance(21);
  assert.equal(connected(effect), true, '21 ms 에는 아직 이어짐');
  timers.advance(1);
  assert.equal(connected(effect), false, '22 ms 에 끊김');
  assert.equal(effect.effectGate.edges.has(effect.dryGain), true, '원음 경로(effectGate → dryGain)는 끊지 않는다');
  assert.equal(timers.pending, 0);

  // 꺼진 채 갱신을 거듭해도 타이머를 또 걸지 않는다
  effect.update(stateOf('drive', { gain: 40 }, false));
  assert.equal(timers.pending, 0, '쉬는 중에는 타이머를 걸지 않는다');
  assert.equal(timers.scheduled.length, 1);

  // 켜면 바로 이어진다
  effect.update(stateOf('drive'));
  assert.equal(connected(effect), true, '켜면 바로 이어짐');
  assert.equal(timers.pending, 0);

  // 끄고 22 ms 안에 다시 켜면 끊지 않는다(타이머를 치운다)
  effect.update(stateOf('drive', {}, false));
  assert.equal(timers.pending, 1);
  timers.advance(10);
  effect.update(stateOf('drive'));
  assert.equal(timers.pending, 0, '다시 켜면 타이머를 치운다');
  timers.advance(1000);
  assert.equal(connected(effect), true, '끊기지 않았다');

  // 꺼진 채 갱신을 거듭하는 중에 타이머가 한 개만 있다
  effect.update(stateOf('drive', {}, false));
  effect.update(stateOf('drive', {}, false));
  effect.update(stateOf('drive', {}, false));
  assert.equal(timers.pending, 1, '타이머는 한 개');
  // dispose 가 타이머를 치운다
  effect.dispose();
  assert.equal(timers.pending, 0, 'dispose 가 타이머를 치운다');
  timers.advance(1000);
  assert.equal(connected(effect), false, 'dispose 뒤에는 이어지지 않는다(연결이 모두 끊김)');
}
{
  // 꺼진 채 만들면 기다리지 않고 바로 쉰다
  const { effect, timers } = make(DriveEffect, stateOf('drive', {}, false));
  assert.equal(connected(effect), false, '꺼진 채 만들면 바로 끊김');
  assert.equal(timers.pending, 0);
  assert.equal(timers.scheduled.length, 0);
  effect.update(stateOf('drive'));
  assert.equal(connected(effect), true, '켜면 이어짐');
}
{
  // 플래그를 끄면 아무것도 끊지 않고 타이머도 걸지 않는다(옛 동작)
  setFeatureFlagOverride('idleDisconnect', false);
  const { effect, timers } = make(DriveEffect, stateOf('drive', {}, false));
  assert.equal(connected(effect), true, '플래그 끔: 꺼진 채 만들어도 이어짐');
  effect.update(stateOf('drive', {}, false));
  timers.advance(10_000);
  assert.equal(connected(effect), true, '플래그 끔: 끊지 않는다');
  assert.equal(timers.scheduled.length, 0, '플래그 끔: 타이머를 걸지 않는다');
  resetFeatureFlagOverrides();
}
{
  // 플래그는 만들 때 한 번 읽는다: 만든 뒤에 끄고 켜도 이 이펙트는 그대로
  const { effect, timers } = make(DriveEffect, stateOf('drive'));
  setFeatureFlagOverride('idleDisconnect', false);
  effect.update(stateOf('drive', {}, false));
  timers.advance(100);
  assert.equal(connected(effect), false, '만들 때 켜져 있었으면 그대로 쉰다');
  resetFeatureFlagOverrides();
}

// ---------------------------------------------------------------------------------------------
// 3. Delay: 꼬리·되먹임 끊기·되돌리기
// ---------------------------------------------------------------------------------------------
const delayOff = (overrides = {}) => stateOf('delay', overrides, false);
const delayOn = (overrides = {}) => stateOf('delay', overrides, true);
{
  // 기본: 280 ms, 되먹임 0.34, Trails 켬 → n = ceil(ln 0.001 / ln 0.34) = 7, 꼬리 = 0.28 × 8 = 2.24 초
  const { effect, timers } = make(DelayEffect, delayOn());
  assert.equal(effect.feedback.gain.value, 0.34, '되먹임 이득이 목표값');
  effect.update(delayOff());
  near(timers.scheduled.at(-1), 22 + 2240, 0.5, 'Trails 꼬리를 기다린다(280 ms × 8)');
  timers.advance(2261);
  assert.equal(connected(effect), true, '꼬리가 끝나기 전에는 이어짐');
  assert.equal(effect.feedback.gain.value, 0.34, '꼬리가 끝나기 전에는 되먹임을 끊지 않는다');
  timers.advance(2);
  assert.equal(connected(effect), false, '꼬리가 끝나면 끊김');
  for (const gain of [effect.feedback.gain, effect.pingPongLeftFeedback.gain, effect.pingPongRightFeedback.gain]) assert.equal(gain.value, 0, '쉬면 되먹임 이득 0');
  // 쉬는 동안 값이 바뀌어도 되먹임은 0 으로 둔다
  effect.update(delayOff({ feedback: 0.6, timeMs: 400 }));
  assert.equal(effect.feedback.gain.value, 0, '쉬는 동안은 되먹임을 올리지 않는다');
  assert.equal(effect.delay.delayTime.value, 0.4, '지연 시간은 그대로 따라간다');
  // 깨어나면 가장 최근 목표값으로 바로 되돌린다
  effect.update(delayOn({ feedback: 0.6, timeMs: 400 }));
  assert.equal(connected(effect), true);
  assert.equal(effect.feedback.gain.value, 0.6, '깨어나면 되먹임을 목표값으로 되돌린다');
  assert.equal(effect.feedback.gain.via, 'value', '깨어난 첫 갱신은 램프 없이 바로 놓는다(첫 반복음을 깎지 않게)');
  effect.update(delayOn({ feedback: 0.5, timeMs: 400 }));
  assert.equal(effect.feedback.gain.via, 'target', '그 다음부터는 평소처럼 부드럽게');
  assert.equal(effect.pingPongLeftFeedback.gain.value, 0, '모노 모드에서 Ping-Pong 이득은 0');
}
{
  // Trails 끔: 꼬리를 기다리지 않는다
  const { effect, timers } = make(DelayEffect, delayOn({ trails: false }));
  effect.update(delayOff({ trails: false }));
  near(timers.scheduled.at(-1), 22, 0.01, 'Trails 끔: 22 ms');
  timers.advance(22);
  assert.equal(connected(effect), false);
  assert.equal(effect.feedback.gain.value, 0);
}
{
  // Ping-Pong: 되먹임 이득은 좌·우 둘이다
  const { effect, timers } = make(DelayEffect, delayOn({ mode: 'pingpong', feedback: 0.5 }));
  assert.equal(effect.feedback.gain.value, 0, 'Ping-Pong 에서 모노 이득은 0');
  assert.equal(effect.pingPongLeftFeedback.gain.value, 0.5);
  assert.equal(effect.pingPongRightFeedback.gain.value, 0.5);
  effect.update(delayOff({ mode: 'pingpong', feedback: 0.5 }));
  // n = ceil(ln 0.001 / ln 0.5) = 10 → 0.28 × 11 = 3.08 초
  near(timers.scheduled.at(-1), 22 + 3080, 0.5, 'Ping-Pong 꼬리');
  timers.advance(3103);
  assert.equal(effect.pingPongLeftFeedback.gain.value, 0, '쉬면 좌 이득 0');
  assert.equal(effect.pingPongRightFeedback.gain.value, 0, '쉬면 우 이득 0');
  // 깨어나는 순간 모드를 바꿔도 그 모드의 목표값이 선다
  effect.update(delayOn({ mode: 'digital', feedback: 0.4 }));
  assert.equal(effect.feedback.gain.value, 0.4);
  assert.equal(effect.pingPongLeftFeedback.gain.value, 0);
  assert.equal(effect.pingPongRightFeedback.gain.value, 0);
}
{
  // 꼬리 시간: 되먹임이 거의 0 이면 지연 한 번, 극단(0.95 × 2 초)에서도 60 초를 넘지 않는다
  const zero = make(DelayEffect, delayOn({ feedback: 0 }));
  zero.effect.update(delayOff({ feedback: 0 }));
  near(zero.timers.scheduled.at(-1), 22 + 280, 0.5, '되먹임 0: 지연 한 번');
  const extreme = make(DelayEffect, delayOn({ feedback: 0.95, timeMs: 2000 }));
  extreme.effect.update(delayOff({ feedback: 0.95, timeMs: 2000 }));
  near(extreme.timers.scheduled.at(-1), 22 + 60_000, 0.5, '꼬리 상한 60 초');
  // 슬랩백은 되먹임을 0.22 로 줄여 쓰므로 꼬리가 짧다: n = ceil(ln 0.001 / ln 0.22) = 5, 지연은 timeMs 를 20~140 ms 로 묶는다(여기서는 120 ms)
  const slap = make(DelayEffect, delayOn({ mode: 'slapback', feedback: 0.9, timeMs: 120 }));
  slap.effect.update(delayOff({ mode: 'slapback', feedback: 0.9, timeMs: 120 }));
  near(slap.timers.scheduled.at(-1), 22 + 120 * 6, 0.5, '슬랩백 꼬리는 되먹임 0.22 로 센다');
  // 켠 채 꺼서 쉬는 도중에 다시 꺼도(값만 바뀜) 꼬리 타이머는 하나
  const again = make(DelayEffect, delayOn());
  again.effect.update(delayOff());
  again.effect.update(delayOff({ feedback: 0.9 }));
  assert.equal(again.timers.pending, 1, '꼬리 타이머는 하나');
}
{
  // 되먹임 이득은 만들 때 켠 채(쉬지 않을 때)에는 바로 목표값 — 쉬지 않은 경로의 값이 옛 동작과 같다
  setFeatureFlagOverride('idleDisconnect', false);
  const { effect, timers } = make(DelayEffect, delayOn({ feedback: 0.7 }));
  effect.update(delayOff({ feedback: 0.7 }));
  timers.advance(100_000);
  assert.equal(effect.feedback.gain.value, 0.7, '플래그 끔: 되먹임을 끊지 않는다');
  assert.equal(connected(effect), true);
  resetFeatureFlagOverrides();
}

// ---------------------------------------------------------------------------------------------
// 4. 워클릿: 입력이 끊겨도 false 를 돌려주지 않는다
// ---------------------------------------------------------------------------------------------
const processors = [
  ['compressor', 'compressorProcessorSource', 'compressor-processor'],
  ['envelope-follower', 'envelopeFollowerProcessorSource', 'envelope-follower-processor'],
  ['flanger', 'flangerProcessorSource', 'flanger-processor'],
  ['noise-gate', 'noiseGateProcessorSource', 'noise-gate-processor'],
  ['phaser', 'phaserProcessorSource', 'phaser-processor'],
];
const BLOCK = 128;
const sineBlock = (offset) => Float32Array.from({ length: BLOCK }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * (offset + i)) / 48000));
// 출력 묶음이 둘(오디오 + 제어 신호)인 처리기(Envelope Follower)가 있어 둘 다 준다.
const energyOf = (outputs) => outputs.flat().reduce((sum, channel) => sum + channel.reduce((inner, value) => inner + Math.abs(value), 0), 0);

for (const [label, exportName, processorName] of processors) {
  const fileName = `${processorName.replace('-processor', '')}-processor`;
  const module = await bundle(`export * from './audio/worklets/${fileName}.ts';`, `${label}-worklet.ts`);
  const source = module[exportName];
  assert.equal(typeof source, 'string', `${label}: 소스 문자열`);
  let Processor = null;
  class MockProcessor {
    constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); }, onmessage: null }; }
  }
  vm.runInNewContext(source, {
    sampleRate: 48000,
    AudioWorkletProcessor: MockProcessor,
    registerProcessor(name, klass) { assert.equal(name, processorName); Processor = klass; },
    Math, Float32Array, Float64Array, Array, Object, Number,
  });
  assert.ok(Processor, `${label}: 등록됨`);
  const parameters = {};
  for (const descriptor of Processor.parameterDescriptors) parameters[descriptor.name] = [descriptor.defaultValue];
  const makeOutputs = () => [[new Float32Array(BLOCK), new Float32Array(BLOCK)], [new Float32Array(BLOCK)]];
  const run = (processor, inputs, outputs = makeOutputs()) => ({ result: processor.process(inputs, outputs, parameters), outputs });

  for (const options of [{}, { processorOptions: { startOpen: true } }]) {
    const processor = new Processor(options);
    const name = `${label}${options.processorOptions ? '(startOpen)' : ''}`;
    // 평소: 입력이 있으면 true, 소리가 난다(문 닫힌 게이트·깊이 0 처리기도 잠시 뒤에는 소리가 난다)
    let heard = 0;
    for (let block = 0; block < 60; block += 1) {
      const input = sineBlock(block * BLOCK);
      const { result, outputs } = run(processor, [[input, input]]);
      assert.equal(result, true, `${name}: 입력이 있으면 true`);
      heard += energyOf(outputs);
    }
    assert.ok(heard > 0, `${name}: 입력이 있으면 소리가 난다`);

    // 입력이 끊긴 블록: false 를 돌려주면 안 된다(Chromium 이 다시 부르지 않는다). 몇 번을 불러도 true, 출력은 그대로 0
    for (let block = 0; block < 5; block += 1) {
      const { result, outputs } = run(processor, [[]]);
      assert.equal(result, true, `${name}: 입력이 끊겨도 true(false 는 영영 멈춘다)`);
      assert.equal(energyOf(outputs), 0, `${name}: 입력이 없으면 출력은 0`);
    }
    assert.equal(run(processor, []).result, true, `${name}: 입력 배열이 비어도 true`);

    // 입력이 돌아오면 다시 소리가 난다
    let heardAgain = 0;
    for (let block = 0; block < 60; block += 1) {
      const input = sineBlock(block * BLOCK);
      const { result, outputs } = run(processor, [[input, input]]);
      assert.equal(result, true, `${name}: 돌아온 입력에도 true`);
      assert.ok(outputs.flat().every((channel) => channel.every(Number.isFinite)), `${name}: 출력이 유한하다`);
      heardAgain += energyOf(outputs);
    }
    assert.ok(heardAgain > 0, `${name}: 입력이 돌아오면 다시 소리가 난다`);
  }

  // 상태를 비웠는가
  const processor = new Processor({});
  for (let block = 0; block < 60; block += 1) {
    const input = sineBlock(block * BLOCK);
    run(processor, [[input, input]]);
  }
  run(processor, [[]]);
  if (label === 'compressor') {
    assert.equal(processor.meanSquare, 0, 'compressor: 검출기 비움');
    assert.equal(processor.reductionDb, 0, 'compressor: 감소량 비움');
    assert.equal(processor.makeupDb, 0, 'compressor: 메이크업 비움');
  } else if (label === 'envelope-follower') {
    assert.equal(processor.envelope, 0, 'envelope-follower: 포락선 비움');
  } else if (label === 'flanger') {
    assert.ok(processor.buffers.every((buffer) => buffer.every((value) => value === 0)), 'flanger: 지연선 비움');
  } else if (label === 'noise-gate') {
    assert.equal(processor.envelope, 0, 'noise-gate: 포락선 비움');
    assert.equal(processor.gateGain, 0, 'noise-gate: 문 닫힌 처음 상태');
  }
  // 한 번 비운 뒤 입력이 계속 끊겨 있으면 다시 비우지 않는다(rested 표시) — 호출이 가볍다
  assert.equal(processor.rested, true, `${label}: 쉼 표시`);
  run(processor, [[sineBlock(0), sineBlock(0)]]);
  assert.equal(processor.rested, false, `${label}: 입력이 돌아오면 쉼 표시를 내린다`);
}

// 압축기는 쉴 때 감소량 표시를 0 으로 돌려보낸다(감소량이 있었을 때만 한 번)
{
  const module = await bundle("export * from './audio/worklets/compressor-processor.ts';", 'compressor-message.ts');
  let Processor = null;
  class MockProcessor { constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); }, onmessage: null }; } }
  vm.runInNewContext(module.compressorProcessorSource, {
    sampleRate: 48000, AudioWorkletProcessor: MockProcessor, registerProcessor(_name, klass) { Processor = klass; }, Math, Float32Array, Float64Array, Array, Object, Number,
  });
  const parameters = { threshold: [-60], ratio: [8], knee: [0], attack: [0.001], release: [0.2] };
  const processor = new Processor({});
  for (let block = 0; block < 400; block += 1) {
    const input = sineBlock(block * BLOCK);
    processor.process([[input]], [[new Float32Array(BLOCK)]], parameters);
  }
  assert.ok(processor.reductionDb !== 0, '큰 입력을 넣으면 감소량이 생긴다');
  const before = processor.port.messages.length;
  assert.equal(processor.process([[]], [[new Float32Array(BLOCK)]], parameters), true);
  const reset = processor.port.messages.slice(before);
  // vm 안에서 만든 객체는 프로토타입이 달라 deepStrictEqual 이 실패하므로 글자로 견준다.
  assert.equal(JSON.stringify(reset), JSON.stringify([{ type: 'reduction', value: 0 }]), '쉬면 감소량 0 을 한 번 알린다');
  processor.process([[]], [[new Float32Array(BLOCK)]], parameters);
  assert.equal(processor.port.messages.length, before + 1, '다시 알리지 않는다');
}

// ---------------------------------------------------------------------------------------------
// 5. 노이즈 게이트: 지수 계산(pow·exp)을 값이 바뀔 때만 해도 출력이 옛 구현과 비트까지 같다(S4.2)
// ---------------------------------------------------------------------------------------------
{
  // 옛 구현(f456cc0, 샘플마다 pow·exp)이 같은 시나리오에서 낸 출력의 해시. 문턱·감소량·어택·홀드·릴리스·히스테리시스가 블록마다 바뀌고
  // 열림·닫힘이 오가서 캐시가 무효가 되는 길을 모두 지난다(상태 메시지 47번).
  const GOLDEN = { hash: '98a8b784', states: 'COCCOOCOCCOOOO', messages: 47 };
  const module = await bundle("export * from './audio/worklets/noise-gate-processor.ts';", 'noise-gate-golden.ts');
  let Processor = null;
  class MockProcessor {
    constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); }, onmessage: null }; }
  }
  vm.runInNewContext(module.noiseGateProcessorSource, {
    sampleRate: 48000, AudioWorkletProcessor: MockProcessor, registerProcessor(_name, klass) { Processor = klass; }, Math, Float32Array, Array, Object, Number,
  });
  const processor = new Processor({});
  let seed = 12345;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };
  let hash = 2166136261;
  const thresholds = [-55, -40, -62, -48];
  const reductions = [-80, -40, -20, -80, -60];
  const attacks = [6, 1, 20, 6];
  const releases = [180, 40, 600, 180];
  const holds = [70, 0, 200, 70];
  const hysteresis = [4, 0, 8, 4];
  let states = '';
  for (let block = 0; block < 700; block += 1) {
    const position = block % 140;
    const amplitude = position >= 40 && position < 90 ? 0.3 * (1 - (position - 40) / 80) : 2e-4;
    const left = Float32Array.from({ length: BLOCK }, () => amplitude * rand());
    const right = Float32Array.from({ length: BLOCK }, () => amplitude * rand());
    const parameters = {
      thresholdDb: [thresholds[Math.floor(block / 97) % 4]],
      reductionDb: [reductions[Math.floor(block / 83) % 5]],
      attackMs: [attacks[Math.floor(block / 61) % 4]],
      holdMs: [holds[Math.floor(block / 71) % 4]],
      releaseMs: [releases[Math.floor(block / 53) % 4]],
      hysteresisDb: [hysteresis[Math.floor(block / 89) % 4]],
    };
    const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    assert.equal(processor.process([[left, right]], outputs, parameters), true);
    for (const channel of outputs[0]) {
      const words = new Uint32Array(channel.buffer);
      for (let index = 0; index < words.length; index += 1) {
        hash = Math.imul(hash ^ words[index], 16777619) >>> 0;
      }
    }
    if (block % 50 === 0) states += processor.state[0];
  }
  assert.equal(hash.toString(16), GOLDEN.hash, '출력이 옛 구현과 비트까지 같다');
  assert.equal(states, GOLDEN.states, '열림·닫힘 순서가 같다');
  assert.equal(processor.port.messages.length, GOLDEN.messages, '상태 메시지 수가 같다');
}

console.log('idle-disconnect: 모든 시험 통과');
