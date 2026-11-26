// S3.2 Cab IR 교체 — 마이크 위치·거리 노브를 돌릴 때 클릭이 없도록 IR 을 120 ms 디바운스 + 20 ms 페이드로 바꾼다(설계서 S3.2 변경 3, R3-2).
// 실제 CabEffect 를 가짜 오디오 컨텍스트(AudioParam 자동화를 시각별로 계산하는 가짜)와 가짜 시계 위에서 돌린다.
//   1. 첫 IR 은 바로 들어가고, 같은 설정을 다시 주면 아무 일도 하지 않는다.
//   2. 마이크 위치·거리를 연속으로 돌리는 동안에는 IR 을 만들지 않고, 마지막 입력 120 ms 뒤에 한 번만 만든다(가장 새로운 값으로).
//   3. 컨볼버 버퍼는 가지 게인이 0 일 때만 바뀐다(모든 교체에서 그 순간 게인을 잰다). 교체 뒤에는 새 보정값으로 되살아난다.
//   4. 모델·사용자 IR 은 디바운스 없이 바로 페이드를 시작한다. 교체 중에 노브가 더 움직여도 램프를 다시 걸지 않고, 가장 새로운 값으로 만든다.
//   5. 교체 도중 끔·사용자 IR 해제·dispose 에서도 타이머가 남지 않고 게인이 튀지 않는다(램프 중간에 값을 되돌리는 취소를 쓰지 않는다).
//      사용자 IR 은 모델 '내 IR'(my-ir)일 때만 쓰이고(S5.4), 저장된 IR 이 없으면 기본 캐비닛으로 대신한다. 모델이 '끔'이면 IR 이 있어도 우회한다.
//   6. 렌더 시각 타이머(contextTimers): 요청보다 일찍 울리지 않고, 현재 퀀텀 안에는 걸지 않으며, 지우면 울리지 않는다.
//   7. 소스 단언: 버퍼는 load 한 곳에서만 바꾸고, CabEffect 는 창 타이머를 직접 부르지 않는다. 페이드는 fadeParam 으로만 한다 —
//      Chrome 에서 cancelAndHoldAtTime 바로 뒤에 건 선형 램프는 페이드가 되지 않고 끊김이 된다(프로브 P-25 로 확인, REFACTOR_LOG L-220).
//   8. 설계서 변경 1·2 의 현재 상태(기록): 좌우 IR 이 같고, 기본 설정의 주파수 응답 편차가 3 dB 이하다.
// 실제 소리로 잰 클릭(출력 1차 차분 피크 증가 ≤ +6 dB)은 프로브 P-25(npm run probe)가 본다.
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

const bundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { CabEffect, CAB_IR_DEBOUNCE_MS, CAB_IR_SWAP_FADE_SECONDS } from './audio/nodes/CabEffect.ts';",
      "export { createCabinet } from './audio/utils/cabinet.ts';",
      "export { createContextTimers, RENDER_QUANTUM_FRAMES } from './audio/offline/contextTimers.ts';",
      "export { initialPedals } from './presets/initialPedals.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('src', rootUrl)),
    sourcefile: 'cab-swap-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { CabEffect, CAB_IR_DEBOUNCE_MS, CAB_IR_SWAP_FADE_SECONDS, createCabinet, createContextTimers, RENDER_QUANTUM_FRAMES, initialPedals } = harness;

// ---------------------------------------------------------------------------------------------
// 가짜 오디오: AudioParam 은 이벤트를 모아 두고 시각 x 의 값을 계산한다(Web Audio 의 취소 규칙 포함)
// ---------------------------------------------------------------------------------------------
class Param {
  constructor(clock, initial = 0) {
    this.clock = clock;
    this.initial = initial;
    this.events = [];
    this.calls = [];
    this.seq = 0;
  }
  push(type, time, value, tc) {
    this.seq += 1;
    this.events.push({ type, time, value, tc, seq: this.seq });
  }
  get value() { return this.valueAt(this.clock.now); }
  set value(next) { this.calls.push('value='); this.push('set', this.clock.now, next); }
  setValueAtTime(value, time) { this.calls.push('setValueAtTime'); this.push('set', time, value); return this; }
  linearRampToValueAtTime(value, time) { this.calls.push('linearRamp'); this.push('linear', time, value); return this; }
  setTargetAtTime(value, time, tc) { this.calls.push('setTarget'); this.push('target', time, value, tc); return this; }
  exponentialRampToValueAtTime() { return this; }
  setValueCurveAtTime() { return this; }
  // 시각 time 이후(포함)의 이벤트를 지운다. 진행 중이던 램프도 지워져서 값이 램프 앞의 값으로 돌아간다(스펙대로).
  cancelScheduledValues(time) {
    this.calls.push('cancelScheduledValues');
    this.events = this.events.filter((event) => event.time < time);
    return this;
  }
  // 시각 time 의 값으로 붙잡고, 그 뒤의 이벤트를 지운다.
  cancelAndHoldAtTime(time) {
    this.calls.push('cancelAndHoldAtTime');
    const held = this.valueAt(time);
    this.events = this.events.filter((event) => event.time <= time);
    this.push('set', time, held);
    return this;
  }
  valueAt(x) {
    let value = this.initial;
    let start = 0;
    let target = null;
    const current = (at) => (target ? target.value + (value - target.value) * Math.exp(-(at - start) / target.tc) : value);
    const sorted = [...this.events].sort((a, b) => a.time - b.time || a.seq - b.seq);
    for (const event of sorted) {
      if (event.type === 'set') {
        if (event.time > x) break;
        value = event.value; start = event.time; target = null;
      } else if (event.type === 'target') {
        if (event.time > x) break;
        value = current(event.time); start = event.time; target = { value: event.value, tc: event.tc };
      } else {
        assert.ok(!target, '가짜 오디오: setTarget 바로 뒤의 램프는 다루지 않는다(코드가 램프 전에 붙잡는지 확인)');
        if (x < event.time) return start >= event.time ? event.value : value + (event.value - value) * ((x - start) / (event.time - start));
        value = event.value; start = event.time; target = null;
      }
    }
    return current(x);
  }
}

const NODE_METHODS = new Set(['connect', 'disconnect', 'start', 'stop', 'addEventListener', 'removeEventListener']);
function fakeNode(clock, own = {}) {
  return new Proxy(own, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      if (NODE_METHODS.has(key)) return () => undefined;
      target[key] = new Param(clock); // 모르는 속성은 AudioParam 으로 본다(gain·frequency·Q 등)
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

/** 가짜 시계 + 타이머. advance(ms) 는 기한이 된 타이머를 시각 순서대로 실행하며 시계를 맞춰 간다. */
function createFakeWorld() {
  const clock = { now: 0 };
  const timers = {
    list: [],
    nextId: 1,
    setTimeout(callback, milliseconds) {
      const id = this.nextId;
      this.nextId += 1;
      this.list.push({ id, at: clock.now + milliseconds / 1000, callback });
      return id;
    },
    clearTimeout(id) { this.list = this.list.filter((timer) => timer.id !== id); },
    get pending() { return this.list.length; },
    advance(milliseconds) {
      const end = clock.now + milliseconds / 1000;
      for (;;) {
        const due = [...this.list].filter((timer) => timer.at <= end + 1e-12).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        this.list = this.list.filter((timer) => timer !== due);
        clock.now = Math.max(clock.now, due.at);
        due.callback();
      }
      clock.now = end;
    },
  };
  const swaps = []; // 컨볼버 버퍼가 바뀐 시각의 가지 게인
  const built = []; // createBuffer 로 만든 IR(길이 1 짜리 '끔' 버퍼는 뺀다)
  let convolverNode = null;
  let convolvedGain = null;
  const context = {
    sampleRate: 48000,
    get currentTime() { return clock.now; },
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { numberOfChannels: channels, length, sampleRate: rate, getChannelData: (channel) => data[channel] };
      if (length > 1) built.push(buffer);
      return buffer;
    },
    createConvolver() {
      let current = null;
      const own = { normalize: true };
      Object.defineProperty(own, 'buffer', {
        get: () => current,
        set: (next) => {
          current = next;
          if (next !== null) swaps.push({ at: clock.now, gain: convolvedGain.gain.valueAt(clock.now), buffer: next, normalize: own.normalize });
        },
      });
      convolverNode = fakeNode(clock, own);
      return convolverNode;
    },
    createGain() {
      const node = fakeNode(clock);
      // CabEffect 는 convolvedGain 을 createGain 으로 두 번째로 만든다(BaseEffect 의 게인들이 먼저). 효과 인스턴스에서 직접 집으니 여기서는 기록만 한다.
      return node;
    },
  };
  const proxy = new Proxy(context, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'string' && key.startsWith('create')) return () => fakeNode(clock);
      return undefined;
    },
  });
  return {
    clock, timers, swaps, built, context: proxy,
    bindGain(gainNode) { convolvedGain = gainNode; },
    get convolver() { return convolverNode; },
  };
}

const basePedal = { ...JSON.parse(JSON.stringify(initialPedals.find((pedal) => pedal.id === 'cab'))), active: true };
const pedalWith = (params) => ({ ...basePedal, params: { ...basePedal.params, ...params } });
const START = pedalWith({ model: 'v30-4x12', micPosition: 55, distance: 30, mix: 100 });

function createEffect(pedal = START, initialUserImpulse = null) {
  const world = createFakeWorld();
  // 사용자 IR 은 이펙트가 update 마다 이 함수로 읽는다(엔진이 넘기는 것과 같은 모양). 시험이 `user.impulse` 를 바꿔 IR 이 도착·삭제되는 것을 흉내 낸다.
  const user = { impulse: initialUserImpulse };
  // convolvedGain 은 생성자 안에서 만들어진 뒤에야 알 수 있으므로, 첫 IR 이 들어갈 때(생성자 안)까지는 바인딩이 필요 없게 임시 게인을 쓴다.
  world.bindGain({ gain: new Param(world.clock) });
  const effect = new CabEffect(world.context, pedal, world.timers, () => user.impulse);
  world.bindGain(effect.convolvedGain);
  // 생성자에서 이미 첫 IR 이 들어갔다. 그 기록은 첫 IR 이라 따로 보관한다.
  const first = world.swaps.splice(0);
  return { world, effect, first, user };
}
const fakeUserBuffer = (...samples) => ({ numberOfChannels: 1, length: samples.length, duration: 0.1, getChannelData: () => new Float32Array(samples) });

const samplesOf = (buffer) => [buffer.getChannelData(0), buffer.getChannelData(1)];
function expectedIr(world, model, micPosition, distance) {
  const reference = createFakeWorld();
  return createCabinet(reference.context, model, micPosition, distance);
}
function sameIr(buffer, expected) {
  const [left, right] = samplesOf(buffer);
  const [expectedLeft, expectedRight] = samplesOf(expected.impulse);
  if (left.length !== expectedLeft.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== expectedLeft[i] || right[i] !== expectedRight[i]) return false;
  }
  return true;
}
// Chrome 에서 페이드를 끊김으로 만드는 cancelAndHoldAtTime(+램프)은 Cab 의 두 가지(컨볼버·우회) 게인에 쓰지 않는다.
const assertNoHold = (effect) => {
  for (const name of ['convolvedGain', 'bypassGain']) {
    ok(!effect[name].gain.calls.includes('cancelAndHoldAtTime'), `${name}: cancelAndHoldAtTime 을 쓰지 않는다`);
  }
};
const gainAt = (effect, clock) => effect.convolvedGain.gain.valueAt(clock.now);
const makeupOf = (model, mic, dist) => 10 ** (createCabinet(createFakeWorld().context, model, mic, dist).makeupDb / 20);

// ---------------------------------------------------------------------------------------------
// 1. 첫 IR 과 같은 설정 되풀이
// ---------------------------------------------------------------------------------------------
{
  const { world, effect, first } = createEffect();
  equal(first.length, 1, '생성자에서 첫 IR 이 바로 들어간다');
  equal(first[0].normalize, false, '만든 IR 은 보정된 비정규화 컨볼루션');
  ok(sameIr(first[0].buffer, expectedIr(world, 'v30-4x12', 55, 30)), '첫 IR 은 설정대로 만든 것');
  equal(world.timers.pending, 0, '첫 IR 은 타이머 없이 들어간다');
  world.timers.advance(500);
  near(gainAt(effect, world.clock), makeupOf('v30-4x12', 55, 30), 1e-6, '첫 IR 의 보정값에 도달');
  near(effect.bypassGain.gain.valueAt(world.clock.now), 0, 1e-6, '우회 가지는 닫힘');

  const builtBefore = world.built.length;
  const callsBefore = effect.convolvedGain.gain.calls.length;
  effect.update(pedalWith({ micPosition: 55, distance: 30 }));
  equal(world.built.length, builtBefore, '같은 설정은 IR 을 다시 만들지 않는다');
  equal(world.timers.pending, 0, '같은 설정은 타이머를 걸지 않는다');
  ok(!effect.convolvedGain.gain.calls.slice(callsBefore).some((call) => call === 'linearRamp' || call === 'cancelAndHoldAtTime'), '같은 설정은 페이드를 걸지 않는다');
  assertNoHold(effect);
  effect.dispose();
}

// 처음부터 꺼져 있으면 IR 을 만들지 않고, 처음 고를 때는 페이드 없이 바로 넣는다
{
  const { world, effect, first } = createEffect(pedalWith({ model: 'off' }));
  equal(first.length, 0, '꺼진 채 시작하면 IR 을 만들지 않는다');
  equal(world.built.length, 0, '꺼진 채 시작: 만든 IR 없음');
  effect.update(pedalWith({ model: 'greenback-4x12' }));
  equal(world.swaps.length, 1, '처음 고르는 모델은 바로 들어간다');
  equal(world.timers.pending, 0, '처음 고르는 모델은 타이머가 없다');
  assertNoHold(effect);
  effect.dispose();
}

// ---------------------------------------------------------------------------------------------
// 2·3. 노브 드래그: 연속 입력 동안 만들지 않고, 멈춘 뒤 120 ms 에 한 번, 게인 0 에서 바꾼다
// ---------------------------------------------------------------------------------------------
{
  const { world, effect } = createEffect();
  world.timers.advance(500);
  const builtBefore = world.built.length;
  const bufferBefore = effect.convolver.buffer;
  const rampsBefore = effect.convolvedGain.gain.calls.filter((call) => call === 'linearRamp').length;
  let mic = 55;
  for (let i = 0; i < 10; i += 1) {
    mic += 2;
    effect.update(pedalWith({ micPosition: mic }));
    world.timers.advance(20);
  }
  equal(world.built.length, builtBefore, '드래그 중에는 IR 을 만들지 않는다');
  ok(effect.convolver.buffer === bufferBefore, '드래그 중에는 컨볼버 버퍼가 그대로');
  equal(effect.convolvedGain.gain.calls.filter((call) => call === 'linearRamp').length, rampsBefore, '드래그 중에는 가지를 줄이지 않는다');
  world.timers.advance(CAB_IR_DEBOUNCE_MS - 20 - 1); // 마지막 입력 뒤 119 ms
  equal(world.built.length, builtBefore, `마지막 입력 ${CAB_IR_DEBOUNCE_MS - 1} ms 뒤까지는 만들지 않는다`);
  equal(effect.phase, 'idle', '디바운스 중에는 교체 단계가 시작되지 않는다');
  world.timers.advance(2); // 121 ms: 페이드 시작
  equal(effect.phase, 'fadingOut', `마지막 입력 ${CAB_IR_DEBOUNCE_MS} ms 뒤 페이드가 시작된다`);
  ok(effect.convolver.buffer === bufferBefore, '페이드 중에는 아직 IR 이 그대로');
  equal(world.built.length, builtBefore, '페이드 시작 때는 아직 만들지 않는다(교체 때 만든다)');
  world.timers.advance(10);
  const half = gainAt(effect, world.clock);
  const makeup = makeupOf('v30-4x12', 55, 30);
  ok(half > 0.2 * makeup && half < 0.8 * makeup, `페이드 중간에는 가지 게인이 중간쯤이다(${half})`);
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000); // 교체와 되살리기가 시작된 뒤
  equal(world.built.length, builtBefore + 1, '드래그가 끝나면 IR 을 정확히 한 번 만든다');
  equal(world.swaps.length, 1, '버퍼는 한 번 바뀐다');
  near(world.swaps[0].gain, 0, 1e-9, '버퍼가 바뀌는 순간 가지 게인은 0');
  ok(sameIr(world.swaps[0].buffer, expectedIr(world, 'v30-4x12', mic, 30)), '가장 새로운 마이크 위치로 만든 IR');
  world.timers.advance(100);
  equal(effect.phase, 'idle', '교체가 끝나면 idle');
  near(gainAt(effect, world.clock), makeupOf('v30-4x12', mic, 30), 1e-6, '새 IR 의 보정값으로 되살아난다');
  equal(world.timers.pending, 0, '끝나면 남은 타이머가 없다');
  assertNoHold(effect);
  effect.dispose();
}

// 거리 노브도 같다. 값이 원래대로 돌아오면 아무것도 바꾸지 않는다.
{
  const { world, effect } = createEffect();
  world.timers.advance(500);
  const builtBefore = world.built.length;
  effect.update(pedalWith({ distance: 60 }));
  world.timers.advance(60);
  equal(world.timers.pending, 1, '거리 변경: 디바운스 타이머 하나');
  effect.update(pedalWith({ distance: 30 })); // 원래 값
  equal(world.timers.pending, 0, '값이 원래대로 돌아오면 타이머를 접는다');
  world.timers.advance(500);
  equal(world.built.length, builtBefore, '원래 값으로 돌아오면 IR 을 만들지 않는다');
  equal(world.swaps.length, 0, '원래 값으로 돌아오면 버퍼를 바꾸지 않는다');
  effect.update(pedalWith({ distance: 80 }));
  world.timers.advance(CAB_IR_DEBOUNCE_MS + CAB_IR_SWAP_FADE_SECONDS * 1000 + 5);
  equal(world.swaps.length, 1, '거리 변경도 한 번 바뀐다');
  near(world.swaps[0].gain, 0, 1e-9, '거리 변경: 교체 순간 게인 0');
  ok(sameIr(world.swaps[0].buffer, expectedIr(world, 'v30-4x12', 55, 80)), '거리 80 으로 만든 IR');
  assertNoHold(effect);
  effect.dispose();
}

// ---------------------------------------------------------------------------------------------
// 4. 모델 변경은 바로 페이드, 교체 중 노브가 움직여도 램프를 다시 걸지 않고 최신 값으로 만든다
// ---------------------------------------------------------------------------------------------
{
  const { world, effect } = createEffect();
  world.timers.advance(500);
  effect.update(pedalWith({ model: 'greenback-4x12' }));
  equal(effect.phase, 'fadingOut', '모델 변경은 디바운스 없이 바로 페이드를 시작한다');
  equal(effect.debounceTimer, null, '모델 변경에는 디바운스 타이머가 없다');
  const ramps = effect.convolvedGain.gain.calls.filter((call) => call === 'linearRamp').length;
  const cancels = effect.convolvedGain.gain.calls.filter((call) => call === 'cancelScheduledValues' || call === 'cancelAndHoldAtTime').length;
  world.timers.advance(5);
  effect.update(pedalWith({ model: 'greenback-4x12', micPosition: 70 })); // 페이드 도중 마이크가 움직인다
  effect.update(pedalWith({ model: 'greenback-4x12', micPosition: 72 }));
  equal(effect.convolvedGain.gain.calls.filter((call) => call === 'linearRamp').length, ramps, '교체 중에는 램프를 다시 걸지 않는다');
  equal(effect.convolvedGain.gain.calls.filter((call) => call === 'cancelScheduledValues' || call === 'cancelAndHoldAtTime').length, cancels, '교체 중에는 게인 자동화를 취소하지 않는다');
  world.timers.advance(16);
  equal(world.swaps.length, 1, '교체는 한 번');
  near(world.swaps[0].gain, 0, 1e-9, '모델 교체 순간 게인 0');
  ok(sameIr(world.swaps[0].buffer, expectedIr(world, 'greenback-4x12', 72, 30)), '페이드 도중 움직인 값까지 반영한 최신 IR');
  world.timers.advance(10); // 되살리는 중
  // 되살리는 도중(교체 후 10 ms)에 노브가 또 움직인다: 지금은 건드리지 않고, 끝난 뒤 새 디바운스로 처리
  const gainBefore = gainAt(effect, world.clock);
  equal(effect.phase, 'fadingIn', '교체 직후에는 되살리는 중');
  effect.update(pedalWith({ model: 'greenback-4x12', micPosition: 20 }));
  near(gainAt(effect, world.clock), gainBefore, 1e-9, '되살리는 중 노브 변경이 게인을 건드리지 않는다');
  equal(effect.phase, 'fadingIn', '되살리는 중에는 단계가 그대로');
  equal(effect.debounceTimer, null, '되살리는 중에는 디바운스 타이머도 걸지 않는다(끝난 뒤에 건다)');
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 10);
  equal(effect.phase, 'idle', '되살리기가 끝나면 idle 로 돌아가고');
  equal(effect.debounceTimer !== null, true, '그 사이 움직인 노브는 새 디바운스를 건다');
  world.timers.advance(CAB_IR_DEBOUNCE_MS + CAB_IR_SWAP_FADE_SECONDS * 1000 + 5);
  equal(world.swaps.length, 2, '그 사이 움직인 노브는 한 번 더 교체한다');
  near(world.swaps[1].gain, 0, 1e-9, '두 번째 교체 순간도 게인 0');
  ok(sameIr(world.swaps[1].buffer, expectedIr(world, 'greenback-4x12', 20, 30)), '두 번째 교체는 마이크 20 의 IR');
  world.timers.advance(100);
  near(gainAt(effect, world.clock), makeupOf('greenback-4x12', 20, 30), 1e-6, '마지막 보정값으로 끝난다');
  assertNoHold(effect);
  effect.dispose();
}

// 되살리는 중에 모델을 바꾸면 바로 새 페이드를 걸지 않고 끝난 뒤에 시작한다
{
  const { world, effect } = createEffect();
  world.timers.advance(500);
  effect.update(pedalWith({ model: 'blue-1x12' }));
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 1); // 교체 직후
  equal(effect.phase, 'fadingIn', '교체 직후 되살리는 중');
  const ramps = effect.convolvedGain.gain.calls.filter((call) => call === 'linearRamp').length;
  effect.update(pedalWith({ model: 'jensen-1x12' }));
  equal(effect.convolvedGain.gain.calls.filter((call) => call === 'linearRamp').length, ramps, '되살리는 중에는 모델을 바꿔도 램프를 새로 걸지 않는다');
  equal(effect.phase, 'fadingIn', '되살리는 중에는 단계가 그대로');
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 15);
  equal(effect.phase, 'fadingOut', '되살리기가 끝나면 바로(디바운스 없이) 다음 페이드가 시작된다');
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 5);
  equal(world.swaps.length, 2, '모델 두 번 바꾼 것이 교체 두 번');
  near(world.swaps[1].gain, 0, 1e-9, '두 번째 교체 순간도 게인 0');
  ok(sameIr(world.swaps[1].buffer, expectedIr(world, 'jensen-1x12', 55, 30)), '두 번째 교체는 Jensen IR');
  assertNoHold(effect);
  effect.dispose();
}

// ---------------------------------------------------------------------------------------------
// 5. 교체 도중 끔·dispose·사용자 IR
// ---------------------------------------------------------------------------------------------
{
  const { world, effect } = createEffect();
  world.timers.advance(500);
  effect.update(pedalWith({ model: 'blue-1x12' }));
  world.timers.advance(8); // 페이드 도중
  const before = gainAt(effect, world.clock);
  effect.update(pedalWith({ model: 'off' }));
  equal(world.timers.pending, 0, '끄면 교체 타이머를 모두 접는다');
  equal(effect.phase, 'idle', '끄면 교체 단계가 idle');
  near(gainAt(effect, world.clock), before, 1e-9, '끄는 순간 가지 게인이 튀지 않는다(램프 중간 값에서 이어서 내린다)');
  world.timers.advance(200);
  equal(world.swaps.length, 0, '끈 뒤에는 버퍼를 바꾸지 않는다');
  near(gainAt(effect, world.clock), 0, 1e-6, '끈 뒤 가지 게인 0');
  near(effect.bypassGain.gain.valueAt(world.clock.now), 1, 1e-3, '끈 뒤 우회 가지 1');
  // 다시 켠다: 끄기 전 IR(v30 55/30)이 남아 있으므로 같은 설정이면 다시 만들지 않고 게인만 올린다.
  const builtBefore = world.built.length;
  effect.update(pedalWith({ model: 'v30-4x12' }));
  equal(world.built.length, builtBefore, '꺼졌다 같은 설정으로 돌아오면 IR 을 다시 만들지 않는다');
  world.timers.advance(300);
  near(gainAt(effect, world.clock), makeupOf('v30-4x12', 55, 30), 1e-6, '다시 켜면 보정값으로 올라간다');
  near(effect.bypassGain.gain.valueAt(world.clock.now), 0, 1e-3, '다시 켜면 우회 가지 0');
  assertNoHold(effect);
  effect.dispose();
}

{
  const { world, effect } = createEffect();
  world.timers.advance(500);
  effect.update(pedalWith({ micPosition: 80 }));
  ok(world.timers.pending > 0, 'dispose 전에 디바운스 타이머가 있다');
  assertNoHold(effect);
  effect.dispose();
  equal(world.timers.pending, 0, 'dispose 는 타이머를 모두 접는다');
  world.timers.advance(1000);
  equal(world.swaps.length, 0, 'dispose 뒤에는 버퍼가 바뀌지 않는다');
}

{
  // 사용자 IR: 모델 '내 IR' 로 고르기·다른 모델로 돌아가기도 페이드로 바꾼다. 사용자 IR 에서는 노브가 IR 을 바꾸지 않는다.
  const { world, effect, user } = createEffect();
  world.timers.advance(500);
  const custom = fakeUserBuffer(0, 0.2, -0.1);
  user.impulse = { buffer: custom, makeupDb: 3 };
  effect.update(pedalWith({ model: 'my-ir' }));
  equal(effect.phase, 'fadingOut', "모델을 '내 IR' 로 고르면 바로 페이드를 시작한다");
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 1);
  equal(world.swaps.length, 1, '사용자 IR 교체 한 번');
  ok(world.swaps[0].buffer === custom, '컨볼버에 사용자 IR 이 들어간다');
  equal(world.swaps[0].normalize, false, '정규화는 앱이 이미 했으므로 컨볼버의 자체 정규화를 끈다');
  near(world.swaps[0].gain, 0, 1e-9, '사용자 IR 교체 순간 게인 0');
  world.timers.advance(100);
  near(gainAt(effect, world.clock), 10 ** (3 / 20), 1e-6, '사용자 IR 의 보충 이득(makeupDb)으로 올라간다');
  effect.update(pedalWith({ model: 'my-ir', micPosition: 10, distance: 90 }));
  equal(world.timers.pending, 0, '사용자 IR 에서 노브를 돌려도 타이머가 없다');
  equal(world.swaps.length, 1, '사용자 IR 에서 노브를 돌려도 IR 을 버리지 않는다');
  // 다른 사용자 IR 로 바꾸면 바뀌고, 같은 IR 을 다시 주면 아무 일도 없다
  const other = fakeUserBuffer(0, 0.3, -0.2);
  world.timers.advance(100);
  user.impulse = { buffer: other, makeupDb: 0 };
  effect.update(pedalWith({ model: 'my-ir', micPosition: 10, distance: 90 }));
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 1);
  equal(world.swaps.length, 2, '다른 사용자 IR 은 교체한다');
  ok(world.swaps[1].buffer === other, '새 사용자 IR 이 컨볼버에 들어간다');
  world.timers.advance(100);
  near(gainAt(effect, world.clock), 1, 1e-6, '새 IR 은 보충 이득 0 dB');
  user.impulse = { buffer: other, makeupDb: 0 };
  effect.update(pedalWith({ model: 'my-ir', micPosition: 10, distance: 90 }));
  equal(world.timers.pending, 0, '같은 사용자 IR 을 다시 주면 타이머가 없다');
  equal(world.swaps.length, 2, '같은 사용자 IR 을 다시 주면 버퍼를 바꾸지 않는다');
  // 다른 모델로 돌아가면 만든 IR 로 페이드 교체하고, IR 은 그대로 남아 있다(다시 '내 IR' 을 고르면 쓴다).
  effect.update(pedalWith({ model: 'v30-4x12', micPosition: 10, distance: 90 }));
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 1);
  equal(world.swaps.length, 3, '다른 모델로 돌아가는 것도 페이드 교체');
  equal(world.swaps[2].normalize, false, '만든 IR 은 비정규화 컨볼루션');
  near(world.swaps[2].gain, 0, 1e-9, '돌아가는 교체 순간 게인 0');
  ok(sameIr(world.swaps[2].buffer, expectedIr(world, 'v30-4x12', 10, 90)), '그 사이 움직인 노브 값의 IR 로 돌아온다');
  world.timers.advance(100);
  effect.update(pedalWith({ model: 'my-ir', micPosition: 10, distance: 90 }));
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 1);
  equal(world.swaps.length, 4, "다시 '내 IR' 을 고르면 남아 있던 IR 을 쓴다");
  ok(world.swaps[3].buffer === other, '같은 사용자 IR 이다');
  assertNoHold(effect);
  effect.dispose();
}

// 저장된 IR 이 없는데 '내 IR' 을 고른 경우(다른 기기에서 온 프리셋, IR 을 지운 뒤): 기본 캐비닛으로 재생하고, IR 이 도착하면 바꾼다. 지우면 다시 기본 캐비닛으로 간다.
{
  const { world, effect, first, user } = createEffect(pedalWith({ model: 'my-ir' }));
  equal(first.length, 1, 'IR 이 없어도 소리가 나도록 기본 캐비닛을 바로 넣는다');
  ok(sameIr(first[0].buffer, expectedIr(world, 'v30-4x12', 55, 30)), '대신 쓰는 모델은 기본 캐비닛(v30-4x12)이다');
  equal(first[0].normalize, false);
  world.timers.advance(500);
  near(gainAt(effect, world.clock), makeupOf('v30-4x12', 55, 30), 1e-6, '기본 캐비닛의 보정값');
  near(effect.bypassGain.gain.valueAt(world.clock.now), 0, 1e-3, '우회 가지는 닫힘(날것의 소리가 나지 않는다)');

  const custom = fakeUserBuffer(0, 0.2, -0.1);
  user.impulse = { buffer: custom, makeupDb: 0 };
  effect.update(pedalWith({ model: 'my-ir' }));
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 1);
  equal(world.swaps.length, 1, 'IR 이 도착하면 바꾼다');
  ok(world.swaps[0].buffer === custom, '도착한 IR');

  world.timers.advance(100);
  user.impulse = null;
  effect.update(pedalWith({ model: 'my-ir' }));
  world.timers.advance(CAB_IR_SWAP_FADE_SECONDS * 1000 + 1);
  equal(world.swaps.length, 2, 'IR 을 지우면 기본 캐비닛으로 바꾼다');
  ok(sameIr(world.swaps[1].buffer, expectedIr(world, 'v30-4x12', 55, 30)), '기본 캐비닛으로 돌아온다');
  assertNoHold(effect);
  effect.dispose();
}

// 모델이 '끔'이면 IR 이 저장돼 있어도 우회한다. '내 IR' 을 고르면 쓰고, 다시 끄면 우회로 돌아온다.
{
  const custom = fakeUserBuffer(0, 0.2, -0.1);
  const { world, effect, first } = createEffect(pedalWith({ model: 'off' }), { buffer: custom, makeupDb: 0 });
  world.timers.advance(500);
  equal(first.length, 0, '꺼져 있으면 IR 이 있어도 컨볼버에 넣지 않는다');
  near(effect.bypassGain.gain.valueAt(world.clock.now), 1, 1e-3, '꺼진 캐비닛: 우회 가지 1');
  near(gainAt(effect, world.clock), 0, 1e-6, '꺼진 캐비닛: 컨볼버 가지 0');
  effect.update(pedalWith({ model: 'my-ir' }));
  world.timers.advance(300);
  ok(effect.convolver.buffer === custom, "'내 IR' 을 고르면 사용자 IR 이 들어간다");
  near(gainAt(effect, world.clock), 1, 1e-6, '사용자 IR: 컨볼버 가지 1');
  near(effect.bypassGain.gain.valueAt(world.clock.now), 0, 1e-3, '사용자 IR: 우회 가지 0');
  effect.update(pedalWith({ model: 'off' }));
  world.timers.advance(300);
  equal(world.timers.pending, 0, '끈 뒤 남은 타이머 없음');
  near(gainAt(effect, world.clock), 0, 1e-6, '다시 끄면 컨볼버 가지 0');
  near(effect.bypassGain.gain.valueAt(world.clock.now), 1, 1e-3, '다시 끄면 우회 가지 1');
  assertNoHold(effect);
  effect.dispose();
}

// ---------------------------------------------------------------------------------------------
// 6. 렌더 시각 타이머
// ---------------------------------------------------------------------------------------------
{
  const scheduled = [];
  const context = { sampleRate: 48000, currentTime: 1 };
  const timers = createContextTimers(context, (frame, run) => scheduled.push({ frame, run }));
  const fired = [];
  timers.setTimeout(() => fired.push('a'), 20);
  const nowFrame = 48000;
  ok(scheduled[0].frame >= nowFrame + 960, '요청한 20 ms 보다 일찍 울리지 않는다(올림)');
  ok(scheduled[0].frame < nowFrame + 960 + RENDER_QUANTUM_FRAMES, '한 퀀텀 넘게 늦지도 않는다');
  equal(scheduled[0].frame % RENDER_QUANTUM_FRAMES, 0, '렌더 퀀텀 경계');
  timers.setTimeout(() => fired.push('b'), 0);
  equal(scheduled[1].frame, nowFrame + RENDER_QUANTUM_FRAMES, '지연 0 도 현재 퀀텀 안에는 걸지 않고 한 퀀텀 뒤');
  const cleared = timers.setTimeout(() => fired.push('c'), 50);
  timers.clearTimeout(cleared);
  scheduled.forEach((entry) => entry.run());
  equal(fired.join(''), 'ab', '지운 타이머는 울리지 않고, 나머지는 한 번씩 울린다');
  scheduled.forEach((entry) => entry.run());
  equal(fired.join(''), 'ab', '같은 타이머는 두 번 울리지 않는다');
  context.currentTime = 2.5;
  timers.setTimeout(() => fired.push('d'), 120);
  const last = scheduled[scheduled.length - 1];
  ok(last.frame >= Math.round(2.5 * 48000) + 5760, '콜백 안에서 건 타이머는 그때의 시각을 기준으로 한다');
}

// ---------------------------------------------------------------------------------------------
// 7. 소스 단언
// ---------------------------------------------------------------------------------------------
{
  const source = await readFile(new URL('src/audio/nodes/CabEffect.ts', rootUrl), 'utf8');
  const loadStart = source.indexOf('private load(');
  ok(loadStart > 0, 'load 함수가 있다');
  const loadEnd = source.indexOf('\n  private ', loadStart + 1);
  const withoutLoad = source.slice(0, loadStart) + source.slice(loadEnd);
  const assigned = [...withoutLoad.matchAll(/convolver\.buffer\s*=\s*(?!=)([^;]+);/g)].map((match) => match[1].trim());
  ok(assigned.every((value) => value === 'null'), `컨볼버 버퍼는 load 밖에서 null(해제)로만 바꾼다: ${assigned.join(', ')}`);
  ok(/convolver\.buffer\s*=\s*source\.impulse\.buffer/.test(source) && /convolver\.buffer\s*=\s*cabinet\.impulse/.test(source), 'load 안에서 사용자 IR 과 만든 IR 을 넣는다');
  ok(!/\bwindow\b/.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/windowTimers/g, '')), 'CabEffect 는 창 타이머를 직접 부르지 않는다(주입받은 Timers 만 쓴다)');
  ok(!/\brampParam\b|cancelAndHoldAtTime/.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'CabEffect 는 rampParam·cancelAndHoldAtTime 을 쓰지 않는다(fadeParam 만)');
  ok(/fadeParam/.test(source), 'CabEffect 는 fadeParam 으로 페이드한다');
  equal(CAB_IR_DEBOUNCE_MS, 120, '설계서: 마이크·거리 노브는 120 ms 멈춘 뒤에만 IR 을 다시 만든다');
  equal(CAB_IR_SWAP_FADE_SECONDS, 0.02, '설계서: IR 을 바꿀 때 20 ms 웻 페이드');
  const factory = await readFile(new URL('src/audio/offline/effectFactory.ts', rootUrl), 'utf8');
  ok(/new CabEffect\(context, pedal, timers\)/.test(factory), '오프라인 팩토리는 렌더 시각 타이머를 Cab 에 넘긴다');
  const chain = await readFile(new URL('src/audio/offline/renderChain.ts', rootUrl), 'utf8');
  ok(/createOfflineEffect\(context, pedal, impulseCache, timers\)/.test(chain), 'renderChain 은 이펙트 생성에 렌더 시각 타이머를 넘긴다');
}

// ---------------------------------------------------------------------------------------------
// 8. 설계서 변경 1·2 의 현재 상태: 좌우 IR 동일, 기본 설정의 응답 편차
// ---------------------------------------------------------------------------------------------
{
  const models = ['v30-4x12', 'greenback-4x12', 'blue-1x12', 'jensen-1x12', 'tweed-1x10'];
  const sampleRate = 48000;
  const magnitude = (samples, hz) => {
    const omega = (-2 * Math.PI * hz) / sampleRate;
    let re = 1; let im = 0; let sumRe = 0; let sumIm = 0;
    const stepRe = Math.cos(omega); const stepIm = Math.sin(omega);
    for (const value of samples) {
      sumRe += value * re; sumIm += value * im;
      const nextRe = re * stepRe - im * stepIm;
      im = re * stepIm + im * stepRe; re = nextRe;
    }
    return Math.hypot(sumRe, sumIm);
  };
  const grid = [];
  for (let hz = 100; hz <= 8000; hz *= 2 ** (1 / 12)) grid.push(hz);
  // 1/12 옥타브 간격 응답(dB)이 ±1/6 옥타브 평균(= 1/3 옥타브 폭)에서 벗어난 최대 폭
  const deviationDb = (samples) => {
    const response = grid.map((hz) => 20 * Math.log10(Math.max(magnitude(samples, hz), 1e-12)));
    let worst = 0;
    for (let i = 0; i < grid.length; i += 1) {
      let sum = 0; let count = 0;
      for (let k = -2; k <= 2; k += 1) {
        const j = i + k;
        if (j >= 0 && j < grid.length) { sum += response[j]; count += 1; }
      }
      worst = Math.max(worst, Math.abs(response[i] - sum / count));
    }
    return worst;
  };
  const world = createFakeWorld();
  for (const model of models) {
    for (const [mic, distance] of [[55, 30], [0, 0], [100, 100], [30, 60]]) {
      const { impulse } = createCabinet(world.context, model, mic, distance);
      const [left, right] = samplesOf(impulse);
      ok(left.every((value, index) => value === right[index]), `${model} ${mic}/${distance}: 좌우 IR 이 같다`);
    }
    const { impulse } = createCabinet(world.context, model, 55, 30);
    const deviation = deviationDb(samplesOf(impulse)[0]);
    ok(deviation <= 3, `${model} 기본 설정: 1/3 옥타브 평활 응답 대비 편차 ${deviation.toFixed(2)} dB ≤ 3 dB`);
  }
}

console.log(`Cab IR 교체 시험 통과 (${checks} 항목)`);
