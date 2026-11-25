import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const effectSource = await readFile(
  new URL('../src/audio/nodes/ChorusEffect.ts', import.meta.url),
  'utf8',
);

assert.match(effectSource, /const MIN_DELAY_SECONDS = 0\.012;/);
assert.match(effectSource, /const MAX_DELAY_SECONDS = 0\.028;/);
assert.match(effectSource, /const MAX_MODULATION_SECONDS = 0\.004;/);
assert.match(effectSource, /export const CHORUS_VOICE_BANK_SIZE = 4;/);
assert.match(effectSource, /const LFO_RETIRE_SECONDS = 0\.1;/);
assert.doesNotMatch(effectSource, /\.value\s*=/, 'AudioParam 직접 대입이 있습니다.');
assert.doesNotMatch(effectSource, /setValueAtTime|linearRampToValueAtTime/);

// update 는 노드를 직접 만들지 않는다. LFO 묶음은 보이스 수가 바뀔 때만 syncLfos 가 갈아 끼운다(S4.2, 위 동작 시험이 센다).
const updateStart = effectSource.indexOf('override update(');
const syncStart = effectSource.indexOf('private syncLfos(');
const disposeStart = effectSource.indexOf('override dispose(');
assert.ok(updateStart >= 0 && syncStart > updateStart && disposeStart > syncStart, 'update/syncLfos/dispose 구현을 찾을 수 없습니다.');
const updateSource = effectSource.slice(updateStart, syncStart);
assert.doesNotMatch(
  updateSource,
  /new\s+(?:Gain|Delay|Oscillator|StereoPanner|BiquadFilter)Node/,
  'update 중 오디오 노드를 재생성합니다.',
);
assert.match(updateSource, /this\.syncLfos\(params\.voices, params\.rate\);/);
assert.match(effectSource.slice(syncStart, disposeStart), /new OscillatorNode\(/);
assert.match(updateSource, /smoothParam\(lfo\.oscillator\.frequency/);
assert.match(updateSource, /smoothParam\(lfo\.depth\.gain/);
assert.match(effectSource, /oscillator\.start\(\);/);
assert.match(effectSource, /lfo\.oscillator\.stop\(\);/);
assert.match(effectSource, /lfo\.oscillator\.stop\(stopAt\);/);
assert.match(effectSource, /if \(this\.disposed\) return;/);
assert.match(effectSource, /voice\.delay\.disconnect\(\);/);
assert.match(effectSource, /voice\.panner\.disconnect\(\);/);
assert.match(effectSource, /voice\.gain\.disconnect\(\);/);
assert.match(effectSource, /lfo\.depth\.disconnect\(\);/);

// ---------------------------------------------------------------------------------------------
// LFO 는 지금 보이스 수만큼만 돈다(S4.2): 가짜 노드로 만들어진 오실레이터를 센다.
// ---------------------------------------------------------------------------------------------
{
  class Param {
    constructor(value = 0) { this.value = value; this.history = []; }
    cancelScheduledValues() {}
    setTargetAtTime(value) { this.value = value; this.history.push(value); }
    setValueAtTime(value) { this.value = value; this.history.push(value); }
    linearRampToValueAtTime(value) { this.value = value; this.history.push(value); }
  }
  const created = { oscillators: [], gains: [] };
  class FakeNode {
    constructor() {
      this.edges = new Set();
      this.gain = new Param(1); this.frequency = new Param(); this.Q = new Param(); this.detune = new Param();
      this.delayTime = new Param(); this.pan = new Param();
      this.started = false; this.stopped = []; this.disconnectedAll = false; this.onended = null;
    }
    connect(destination) { this.edges.add(destination); return destination; }
    disconnect(destination) { if (destination === undefined) { this.edges.clear(); this.disconnectedAll = true; } else this.edges.delete(destination); }
    start() { this.started = true; }
    stop(when) { this.stopped.push(when === undefined ? 'now' : when); }
    setPeriodicWave() {}
  }
  const withOptions = (node, options) => {
    if (options && options.gain !== undefined) node.gain.value = options.gain;
    if (options && options.frequency !== undefined) node.frequency.value = options.frequency;
    if (options && options.delayTime !== undefined) node.delayTime.value = options.delayTime;
    return node;
  };
  globalThis.GainNode = class extends FakeNode { constructor(_context, options) { super(); withOptions(this, options); created.gains.push(this); } };
  globalThis.DelayNode = class extends FakeNode { constructor(_context, options) { super(); withOptions(this, options); } };
  globalThis.StereoPannerNode = class extends FakeNode { constructor() { super(); } };
  globalThis.BiquadFilterNode = class extends FakeNode { constructor() { super(); } };
  globalThis.OscillatorNode = class extends FakeNode { constructor(_context, options) { super(); withOptions(this, options); this.initialFrequency = options.frequency; created.oscillators.push(this); } };
  const context = new Proxy({ sampleRate: 48000, currentTime: 2 }, {
    get: (target, name) => (typeof name === 'string' && name.startsWith('create') ? () => new FakeNode() : target[name]),
  });

  const harness = await build({
    stdin: {
      contents: "export { ChorusEffect } from './audio/nodes/ChorusEffect.ts';\nexport { initialPedals } from './presets/initialPedals.ts';",
      resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
      sourcefile: 'chorus-lfo-harness.ts',
    },
    bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
  });
  const { ChorusEffect, initialPedals } = await import(`data:text/javascript;base64,${Buffer.from(harness.outputFiles[0].text).toString('base64')}`);
  const base = initialPedals.find((candidate) => candidate.id === 'chorus');
  assert.ok(base, '기본 Chorus 페달');
  const pedalWith = (overrides) => ({ ...JSON.parse(JSON.stringify(base)), params: { ...JSON.parse(JSON.stringify(base)).params, ...overrides } });

  // 처음부터 보이스 수만큼만 만든다(예전에는 항상 아홉 개).
  for (const voices of [2, 3, 4]) {
    created.oscillators.length = 0;
    const effect = new ChorusEffect(context, pedalWith({ voices }));
    assert.equal(created.oscillators.length, voices, `보이스 ${voices}: 오실레이터 ${voices}개만 만든다`);
    assert.ok(created.oscillators.every((oscillator) => oscillator.started), '만든 것은 모두 시작한다');
    assert.equal(effect.lfos.length, voices);
    effect.dispose();
  }

  created.oscillators.length = 0;
  const effect = new ChorusEffect(context, pedalWith({ voices: 3, rate: 5 }));
  assert.equal(created.oscillators.length, 3);
  assert.ok(created.oscillators.every((oscillator) => oscillator.initialFrequency === 0.8), '처음 만들 때는 옛 구현처럼 기본 속도(0.8 Hz)로 시작해 update 가 옮긴다');
  const firstSet = [...created.oscillators];
  effect.update(pedalWith({ voices: 3, rate: 6, depth: 70 }));
  assert.equal(created.oscillators.length, 3, '보이스 수가 같으면 다른 노브를 돌려도 노드를 만들지 않는다');

  // 보이스 수를 바꾸면 새 묶음을 만들고 옛 묶음은 깊이를 0 으로 내린 뒤 끈다.
  effect.update(pedalWith({ voices: 4, rate: 6, depth: 70 }));
  assert.equal(created.oscillators.length, 7, '새 묶음 4개가 더해진다');
  const secondSet = created.oscillators.slice(3);
  assert.ok(secondSet.every((oscillator) => oscillator.initialFrequency === 6), '새 묶음은 지금 속도로 시작한다');
  assert.equal(effect.lfos.length, 4);
  assert.equal(effect.retiring.size, 3, '옛 묶음 3개가 물러나는 중이다');
  for (const oscillator of firstSet) {
    assert.deepEqual(oscillator.stopped, [2.1], '옛 묶음은 0.1초 뒤에 끈다');
    assert.equal(typeof oscillator.onended, 'function');
  }
  assert.ok(secondSet.every((oscillator) => oscillator.stopped.length === 0), '새 묶음은 끄지 않는다');
  // 깊이 게이트: 옛 것은 0 으로, 새 것은 깊이로
  const depthOf = (oscillator) => [...oscillator.edges][0];
  assert.ok(firstSet.every((oscillator) => depthOf(oscillator).gain.value === 0), '옛 묶음의 깊이는 0 으로 내린다');
  assert.ok(secondSet.every((oscillator) => depthOf(oscillator).gain.value > 0), '새 묶음의 깊이는 올린다');
  // 끝났다는 알림이 오면 연결을 정리한다
  firstSet.forEach((oscillator) => oscillator.onended());
  assert.equal(effect.retiring.size, 0, '끝난 묶음은 목록에서 빠진다');
  assert.ok(firstSet.every((oscillator) => oscillator.disconnectedAll), '끝난 오실레이터는 연결을 끊는다');

  // 정리하면 지금 묶음과 물러나는 묶음을 모두 끈다
  effect.update(pedalWith({ voices: 2 }));
  assert.equal(effect.lfos.length, 2);
  assert.equal(effect.retiring.size, 4);
  const everything = [...created.oscillators];
  effect.dispose();
  assert.equal(effect.retiring.size, 0);
  const current = everything.slice(-2);
  assert.ok(current.every((oscillator) => oscillator.stopped.includes('now') && oscillator.disconnectedAll), '정리하면 지금 묶음을 바로 끈다');
  assert.ok(secondSet.every((oscillator) => oscillator.stopped.includes('now') && oscillator.disconnectedAll), '물러나는 중이던 묶음도 정리한다');
  assert.ok([...secondSet, ...current].every((oscillator) => oscillator.onended === null), '정리한 뒤에는 알림이 없다');
  delete globalThis.GainNode; delete globalThis.DelayNode; delete globalThis.StereoPannerNode; delete globalThis.BiquadFilterNode; delete globalThis.OscillatorNode;
}

const migrationBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [
    fileURLToPath(new URL('../src/store/__migration_check.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const migrationCode = migrationBundle.outputFiles[0].text;
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationCode).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log('Chorus regression passed: schema v5, bounds/NaN, fixed voice bank, LFOs follow the voice count, smoothing and lifecycle.');
