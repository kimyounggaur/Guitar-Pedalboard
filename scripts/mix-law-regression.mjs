// S3.1 Delay·Reverb Mix — 원음은 그대로, 효과음만 더하기(설계서 S3.1, 보고서 R3-7, 프로브 P-15) 시험.
//   1. 순수 함수 mixGains: crossfade 는 원음이 1 − Mix 로 줄고, additive 는 원음 1(변화 0 dB)에 효과음만 Mix 만큼 더한다. 꺼지면 원음 0,
//      꼬리(trails)를 남기는 꺼진 딜레이·리버브는 효과음만 Mix 로 남는다. Mix 가 범위를 벗어나도 맞춘다.
//   2. 실제 BaseEffect(가짜 오디오 컨텍스트): 방식을 정하지 않으면 crossfade, additive 를 주면 원음 게인이 Mix 와 상관없이 1.
//      Mix 를 바꾸는 갱신(update)과 켜고 끄기에서도 같다.
//   3. 실제 DelayEffect·ReverbEffect 는 additive, 나머지 페달(드라이브·크런치·퍼즈·EQ)은 crossfade — 기본 구성의 모든 형이 이 표대로다.
//   4. 소스 단언: BaseEffect 가 페달 형 이름('delay'·'reverb')으로 원음을 가르지 않고, additive 를 고르는 클래스는 딜레이·리버브 둘뿐이다.
// 실제 소리로 잰 원음 레벨 변화(0 ± 0.1 dB)는 프로브 P-15(npm run probe, npm test 에 들어 있다)가 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
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
const toDb = (linear) => 20 * Math.log10(linear);

const rootUrl = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, rootUrl), 'utf8');

// ---------------------------------------------------------------------------------------------
// 묶기
// ---------------------------------------------------------------------------------------------
const bundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { mixGains } from './audio/nodes/mixLaw.ts';",
      "export { BaseEffect } from './audio/nodes/BaseEffect.ts';",
      "export { DelayEffect } from './audio/nodes/DelayEffect.ts';",
      "export { ReverbEffect } from './audio/nodes/ReverbEffect.ts';",
      "export { DriveEffect } from './audio/nodes/DriveEffect.ts';",
      "export { CrunchEffect } from './audio/nodes/CrunchEffect.ts';",
      "export { FuzzEffect } from './audio/nodes/FuzzEffect.ts';",
      "export { EQEffect } from './audio/nodes/EQEffect.ts';",
      "export { initialPedals } from './presets/initialPedals.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('src', rootUrl)),
    sourcefile: 'mix-law-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { mixGains, BaseEffect, DelayEffect, ReverbEffect, DriveEffect, CrunchEffect, FuzzEffect, EQEffect, initialPedals } = harness;

// ---------------------------------------------------------------------------------------------
// 1. 순수 함수
// ---------------------------------------------------------------------------------------------
for (const mix of [0, 0.1, 0.3, 0.5, 0.75, 1]) {
  const crossfade = mixGains('crossfade', mix, true, false);
  near(crossfade.dry, 1 - mix, 1e-12, `crossfade Mix ${mix}: 원음 = 1 − Mix`);
  near(crossfade.wet, mix, 1e-12, `crossfade Mix ${mix}: 효과음 = Mix`);
  const additive = mixGains('additive', mix, true, false);
  equal(additive.dry, 1, `additive Mix ${mix}: 원음은 그대로 1`);
  near(additive.wet, mix, 1e-12, `additive Mix ${mix}: 효과음 = Mix`);
}
// 설계서·P-15 의 숫자: Mix 30% 에서 crossfade 는 원음이 약 −3.1 dB, additive 는 0 dB
near(toDb(mixGains('crossfade', 0.3, true, false).dry), -3.098, 0.01, 'Mix 30% crossfade 원음은 −3.1 dB(보고서가 본 현상)');
near(toDb(mixGains('additive', 0.3, true, false).dry), 0, 1e-9, 'Mix 30% additive 원음은 0 dB(P-15 목표)');
// 꺼짐: 원음은 우회 경로가 맡으므로 dry 0, trails 가 없으면 wet 도 0
for (const law of ['crossfade', 'additive']) {
  deepEqualGains(mixGains(law, 0.3, false, false), { dry: 0, wet: 0 }, `${law} 꺼짐`);
  deepEqualGains(mixGains(law, 0.3, false, true), { dry: 0, wet: 0.3 }, `${law} 꺼짐 + trails: 효과음 꼬리만 남는다`);
  deepEqualGains(mixGains(law, 0.3, true, true), law === 'additive' ? { dry: 1, wet: 0.3 } : { dry: 0.7, wet: 0.3 }, `${law} 켜짐 + trails: trails 는 켜졌을 때 아무것도 바꾸지 않는다`);
}
// 범위 밖
deepEqualGains(mixGains('crossfade', -0.5, true, false), { dry: 1, wet: 0 }, 'Mix < 0 은 0');
deepEqualGains(mixGains('crossfade', 1.5, true, false), { dry: 0, wet: 1 }, 'Mix > 1 은 1');
deepEqualGains(mixGains('additive', 1.5, true, false), { dry: 1, wet: 1 }, 'additive Mix > 1 은 1');
function deepEqualGains(actual, expected, message) {
  near(actual.dry, expected.dry, 1e-12, `${message}: 원음`);
  near(actual.wet, expected.wet, 1e-12, `${message}: 효과음`);
}

// ---------------------------------------------------------------------------------------------
// 가짜 오디오 컨텍스트: 게인 목표값만 기록한다(가장 마지막으로 정한 값 = 램프가 끝났을 때의 값)
// ---------------------------------------------------------------------------------------------
class Param {
  value = 0;
  target = 0;
  setValueAtTime(value) { this.value = value; this.target = value; return this; }
  linearRampToValueAtTime(value) { this.target = value; return this; }
  exponentialRampToValueAtTime(value) { this.target = value; return this; }
  setTargetAtTime(value) { this.target = value; return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}
const NODE_METHODS = new Set(['connect', 'disconnect', 'start', 'stop', 'addEventListener', 'removeEventListener', 'getFrequencyResponse']);
function fakeNode() {
  const own = {};
  return new Proxy(own, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      if (NODE_METHODS.has(key)) return () => undefined;
      target[key] = new Param(); // 모르는 속성은 AudioParam 으로 본다(gain·frequency·delayTime·pan 등)
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}
const fakeContext = () => new Proxy({ currentTime: 0, sampleRate: 48000, state: 'running' }, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string' && key.startsWith('create')) return () => fakeNode();
    return undefined;
  },
});
// 퍼즈의 게이트 같은 워클릿 노드도 같은 가짜로 만든다(파라미터는 모두 기록만 한다)
globalThis.AudioWorkletNode = class {
  constructor() {
    const node = fakeNode();
    node.parameters = { get: () => new Param(), has: () => true, forEach: () => undefined };
    node.port = { postMessage: () => undefined, onmessage: null };
    return node;
  }
};
// 리버브가 쓰는 창 타이머와 임펄스 캐시(여기서는 임펄스가 도착하지 않는 가짜)
globalThis.window = { setTimeout: () => 1, clearTimeout: () => undefined };
const impulseCache = { describe: () => ({ key: 'k', revision: 0 }), getCached: () => null, request: () => new Promise(() => undefined) };

const pedalOf = (id, { active = true, mix = 30, trails } = {}) => {
  const base = initialPedals.find((candidate) => candidate.id === id);
  assert.ok(base, `기본 페달 ${id}`);
  const params = { ...JSON.parse(JSON.stringify(base.params)), mix };
  if (trails !== undefined) params.trails = trails;
  return { ...JSON.parse(JSON.stringify(base)), active, params };
};
const dryOf = (effect) => effect.dryGain.gain.target;
const wetOf = (effect) => effect.wetGain.gain.target;

// ---------------------------------------------------------------------------------------------
// 2. 실제 BaseEffect
// ---------------------------------------------------------------------------------------------
{
  const plain = new BaseEffect(fakeContext(), pedalOf('drive', { mix: 30 }));
  near(dryOf(plain), 0.7, 1e-9, 'BaseEffect 기본(방식을 정하지 않음)은 crossfade: Mix 30% 에서 원음 0.7');
  near(wetOf(plain), 0.3, 1e-9, 'BaseEffect 기본: 효과음 0.3');
  const explicitCrossfade = new BaseEffect(fakeContext(), pedalOf('drive', { mix: 30 }), { mixLaw: 'crossfade' });
  near(dryOf(explicitCrossfade), 0.7, 1e-9, 'mixLaw: crossfade 를 주어도 같다');
  const additive = new BaseEffect(fakeContext(), pedalOf('drive', { mix: 30 }), { mixLaw: 'additive' });
  equal(dryOf(additive), 1, 'mixLaw: additive 는 페달 형(drive)과 상관없이 원음 1');
  near(wetOf(additive), 0.3, 1e-9, 'additive 효과음 0.3');
  // Mix 를 바꾸는 갱신: 생성 때(즉시)가 아니라 램프 경로를 지난다
  for (const mix of [0, 10, 55, 100]) {
    additive.update(pedalOf('drive', { mix }));
    equal(dryOf(additive), 1, `additive: Mix ${mix}% 로 갱신해도 원음 1`);
    near(wetOf(additive), mix / 100, 1e-9, `additive: Mix ${mix}% 효과음`);
    plain.update(pedalOf('drive', { mix }));
    near(dryOf(plain), 1 - mix / 100, 1e-9, `crossfade: Mix ${mix}% 원음`);
  }
  // 켜고 끄기: 꺼지면 원음 경로는 우회(bypassAll)가 맡는다
  additive.update(pedalOf('drive', { active: false, mix: 30 }));
  equal(dryOf(additive), 0, 'additive 꺼짐: 원음 게인 0(우회 경로가 소리를 낸다)');
  equal(additive.bypassAll.gain.target, 1, 'additive 꺼짐: 우회 경로가 열린다');
  equal(wetOf(additive), 0, 'additive 꺼짐(trails 없음): 효과음 0');
  additive.update(pedalOf('drive', { active: true, mix: 30 }));
  equal(dryOf(additive), 1, 'additive 다시 켜면 원음 1');
  equal(additive.bypassAll.gain.target, 0, 'additive 다시 켜면 우회 경로가 닫힌다');
}

// ---------------------------------------------------------------------------------------------
// 3. 페달 클래스별 방식
// ---------------------------------------------------------------------------------------------
const additivePedals = [
  ['delay', (pedal) => new DelayEffect(fakeContext(), pedal)],
  ['reverb', (pedal) => new ReverbEffect(fakeContext(), pedal, impulseCache)],
];
const crossfadePedals = [
  ['drive', (pedal) => new DriveEffect(fakeContext(), pedal)],
  ['crunch', (pedal) => new CrunchEffect(fakeContext(), pedal)],
  ['fuzz', (pedal) => new FuzzEffect(fakeContext(), pedal)],
  ['eq', (pedal) => new EQEffect(fakeContext(), pedal)],
];
for (const [id, make] of additivePedals) {
  for (const mix of [10, 30, 60, 100]) {
    const effect = make(pedalOf(id, { mix }));
    equal(dryOf(effect), 1, `${id} Mix ${mix}%: 원음 1(0 dB)`);
    near(wetOf(effect), mix / 100, 1e-9, `${id} Mix ${mix}%: 효과음 = Mix`);
    effect.update(pedalOf(id, { mix: 100 - mix }));
    equal(dryOf(effect), 1, `${id}: Mix 를 ${100 - mix}% 로 바꿔도 원음 1`);
    near(wetOf(effect), (100 - mix) / 100, 1e-9, `${id}: Mix 를 바꾸면 효과음이 따라간다`);
  }
  // trails: 꺼도 꼬리가 남고, 끄면 원음은 0
  const withTrails = make(pedalOf(id, { active: false, mix: 30, trails: true }));
  equal(dryOf(withTrails), 0, `${id} 꺼짐: 원음 0`);
  near(wetOf(withTrails), 0.3, 1e-9, `${id} 꺼짐 + Trails: 효과음 꼬리가 남는다`);
  const withoutTrails = make(pedalOf(id, { active: false, mix: 30, trails: false }));
  equal(wetOf(withoutTrails), 0, `${id} 꺼짐 + Trails 없음: 효과음 0`);
}
for (const [id, make] of crossfadePedals) {
  for (const mix of [10, 30, 60, 100]) {
    const effect = make(pedalOf(id, { mix }));
    near(dryOf(effect), 1 - mix / 100, 1e-9, `${id} Mix ${mix}%: 원음 = 1 − Mix(지금 방식 그대로)`);
    near(wetOf(effect), mix / 100, 1e-9, `${id} Mix ${mix}%: 효과음 = Mix`);
  }
}
// 기본 구성에 있는 모든 페달 형: additive 는 둘뿐
const additiveTypes = new Set(additivePedals.map(([id]) => id));
const typesInBoard = new Set(initialPedals.map((pedal) => pedal.type));
ok(additiveTypes.has('delay') && additiveTypes.has('reverb') && typesInBoard.has('delay') && typesInBoard.has('reverb'), '기본 구성에 딜레이·리버브가 있다');

// ---------------------------------------------------------------------------------------------
// 4. 소스 단언
// ---------------------------------------------------------------------------------------------
{
  const base = await read('src/audio/nodes/BaseEffect.ts');
  // 형 이름('delay'·'reverb')은 꼬리(trails)를 가르는 hasTrails 에만 남는다. 원음·효과음을 정하는 곳에는 없다.
  const withoutTrailsRule = base.replace(/private hasTrails[\s\S]*?\n {2}\}\n/, '');
  ok(withoutTrailsRule.length < base.length, 'hasTrails 를 찾아 뺐다(이 단언이 헛돌지 않는다)');
  ok(!/'(delay|reverb)'/.test(withoutTrailsRule), 'BaseEffect 의 합성 코드가 페달 형 이름으로 원음을 가르지 않는다(mixLaw 로 정한다)');
  ok(base.includes("options.mixLaw ?? 'crossfade'"), '방식을 정하지 않으면 crossfade 다');
  ok(base.includes('mixGains(this.mixLaw'), 'BaseEffect 는 순수 함수 mixGains 로 목표 게인을 구한다');
  const dir = new URL('src/audio/nodes/', rootUrl);
  const users = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.ts') || file === 'mixLaw.ts' || file === 'BaseEffect.ts') continue;
    const text = await readFile(new URL(file, dir), 'utf8');
    if (text.includes('mixLaw')) users.push(file);
  }
  users.sort();
  assert.deepEqual(users, ['DelayEffect.ts', 'ReverbEffect.ts'], `mixLaw 를 고르는 페달은 딜레이·리버브뿐이다(지금: ${users.join(', ')})`);
  checks += 1;
  for (const file of users) {
    const text = await readFile(new URL(file, dir), 'utf8');
    ok(text.includes("{ mixLaw: 'additive' }"), `${file} 는 additive 를 고른다`);
  }
}

console.log(`mix-law: ${checks}건 통과`);
