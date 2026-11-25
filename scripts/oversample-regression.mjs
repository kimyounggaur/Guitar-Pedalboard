// S3.7 왜곡 페달 오버샘플링(기능 플래그 oversample2x)의 시험.
//  1) 플래그: 마스터 + 페달별 기본값(켜짐 = 지금의 2배), 주소 읽기, 마스터와 페달 플래그의 조합 → 2배/4배
//  2) 이펙트: Drive·Crunch·Fuzz 가 만들 때 고른 배수를 WaveShaper 에 주고, 지연(latencySeconds)이 그 배수의 표 값인가
//  3) 표: params/latency.json 의 2배·4배가 기준선 P-16·P-29 의 실측과 맞고, 4배가 2배보다 1 ms 넘게 길다
//  4) measure.ts 의 nonHarmonicDb(배음이 아닌 성분의 전력): 합성 신호로 값·가림(guard)·직류·배음 처리를 확인
//  5) 소스: 세 이펙트가 오버샘플링 문자열을 직접 쓰지 않고 oversampleModeFor 를 쓴다
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const rootUrl = new URL('../', import.meta.url);
const importBundle = async (result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected} (±${tolerance})`);

// 플래그 모듈을 이펙트와 같은 번들에 넣어야 시험이 덮어쓴 값을 이펙트가 본다.
const harness = await importBundle(
  await build({
    stdin: {
      contents: [
        "export * from './config/flags.ts';",
        "export * from './audio/utils/oversample.ts';",
        "export * from './audio/engine/latency.ts';",
        "export { DriveEffect } from './audio/nodes/DriveEffect.ts';",
        "export { CrunchEffect } from './audio/nodes/CrunchEffect.ts';",
        "export { FuzzEffect } from './audio/nodes/FuzzEffect.ts';",
        "export { initialPedals } from './presets/initialPedals.ts';",
        "export { nonHarmonicDb } from './audio/testing/measure.ts';",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('src', rootUrl)),
      sourcefile: 'oversample-harness.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  }),
);
const {
  FEATURE_FLAG_DEFAULTS, parseFeatureFlags, isFeatureEnabled, setFeatureFlagOverride, resetFeatureFlagOverrides,
  oversampleModeFor, fixedLatencySeconds, DriveEffect, CrunchEffect, FuzzEffect, initialPedals, nonHarmonicDb,
} = harness;

const PEDAL_FLAG = { drive: 'oversample2xDrive', crunch: 'oversample2xCrunch', fuzz: 'oversample2xFuzz' };

// ---------------------------------------------------------------------------------------------
// 1. 플래그
// ---------------------------------------------------------------------------------------------
for (const name of ['oversample2x', 'oversample2xDrive', 'oversample2xCrunch', 'oversample2xFuzz']) {
  assert.equal(FEATURE_FLAG_DEFAULTS[name], true, `${name}: 기본값이 켜짐(= 지금 앱의 2배, 설계서 4배는 끈 쪽)`);
  assert.equal(isFeatureEnabled(name), true, `${name}: 아무것도 정하지 않으면 켜짐`);
}
assert.deepEqual(parseFeatureFlags('?ff=-oversample2x'), { oversample2x: false });
assert.deepEqual(parseFeatureFlags('?ff=-oversample2xFuzz,oversample2xDrive'), { oversample2xFuzz: false, oversample2xDrive: true });
assert.deepEqual(parseFeatureFlags('?ff=oversample2'), {}, '이름이 같아야 한다');

for (const pedal of ['drive', 'crunch', 'fuzz']) assert.equal(oversampleModeFor(pedal), '2x', `${pedal}: 기본값은 2배`);
// 마스터를 끄면 모든 페달이 4배
setFeatureFlagOverride('oversample2x', false);
for (const pedal of ['drive', 'crunch', 'fuzz']) assert.equal(oversampleModeFor(pedal), '4x', `마스터 끔 → ${pedal} 4배`);
// 마스터가 꺼져 있으면 페달 플래그를 켜도 4배(둘 다 켜져 있어야 2배)
for (const pedal of ['drive', 'crunch', 'fuzz']) setFeatureFlagOverride(PEDAL_FLAG[pedal], true);
for (const pedal of ['drive', 'crunch', 'fuzz']) assert.equal(oversampleModeFor(pedal), '4x', `마스터 끔 + ${pedal} 켬 → 4배`);
resetFeatureFlagOverrides();
// 페달 하나만 끄면 그 페달만 4배
for (const off of ['drive', 'crunch', 'fuzz']) {
  setFeatureFlagOverride(PEDAL_FLAG[off], false);
  for (const pedal of ['drive', 'crunch', 'fuzz']) assert.equal(oversampleModeFor(pedal), pedal === off ? '4x' : '2x', `${off} 만 끔 → ${pedal}`);
  resetFeatureFlagOverrides();
}
// 시험이 정한 값은 이펙트를 새로 만들 때만 읽힌다는 것은 아래 2 에서 본다.

// ---------------------------------------------------------------------------------------------
// 2. 이펙트
// ---------------------------------------------------------------------------------------------
class Param {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}
class FakeNode {
  gain = new Param(); frequency = new Param(); Q = new Param(); detune = new Param();
  connect() {} disconnect() {}
}
class FakeWorkletNode extends FakeNode {
  parameters = new Map(); port = { postMessage() {}, onmessage: null };
}
globalThis.AudioWorkletNode = FakeWorkletNode;
const shapers = [];
const fakeContext = (sampleRate) => ({
  sampleRate, currentTime: 0,
  createGain: () => new FakeNode(), createBiquadFilter: () => new FakeNode(), createConvolver: () => new FakeNode(),
  createWaveShaper: () => { const node = new FakeNode(); shapers.push(node); return node; },
  createBuffer: (count, length) => {
    const data = Array.from({ length: count }, () => new Float32Array(length));
    return { numberOfChannels: count, length, getChannelData: (channel) => data[channel] };
  },
});
const pedalState = (id, active = true) => {
  const base = initialPedals.find((candidate) => candidate.id === id);
  assert.ok(base, `기본 페달 ${id}`);
  return { ...JSON.parse(JSON.stringify(base)), active };
};
const Effects = { drive: DriveEffect, crunch: CrunchEffect, fuzz: FuzzEffect };
const table = JSON.parse(await readFile(new URL('src/audio/params/latency.json', rootUrl), 'utf8'));
const tableSeconds = (mode, rate) => table.oversample[mode][String(rate)] / 1000;

for (const rate of [44100, 48000]) {
  assert.equal(fixedLatencySeconds('oversample2x', rate), tableSeconds('2x', rate), `표의 2배 @${rate}`);
  assert.equal(fixedLatencySeconds('oversample4x', rate), tableSeconds('4x', rate), `표의 4배 @${rate}`);
  assert.ok(tableSeconds('4x', rate) - tableSeconds('2x', rate) > 0.001, `4배가 2배보다 1 ms 넘게 길다 @${rate}`);
  for (const [pedal, Effect] of Object.entries(Effects)) {
    const build_ = (setup) => {
      resetFeatureFlagOverrides();
      setup?.();
      shapers.length = 0;
      const effect = new Effect(fakeContext(rate), pedalState(pedal));
      assert.equal(shapers.length, 1, `${pedal}: WaveShaper 하나`);
      return { effect, mode: shapers[0].oversample };
    };
    const normal = build_();
    assert.equal(normal.mode, '2x', `${pedal} 기본: WaveShaper 2배`);
    assert.equal(normal.effect.latencySeconds, tableSeconds('2x', rate), `${pedal} 기본 지연 = 2배 표 @${rate}`);
    const master = build_(() => setFeatureFlagOverride('oversample2x', false));
    assert.equal(master.mode, '4x', `${pedal} 마스터 끔: WaveShaper 4배`);
    assert.equal(master.effect.latencySeconds, tableSeconds('4x', rate), `${pedal} 마스터 끔 지연 = 4배 표 @${rate}`);
    const own = build_(() => setFeatureFlagOverride(PEDAL_FLAG[pedal], false));
    assert.equal(own.mode, '4x', `${pedal} 자기 플래그 끔: 4배`);
    assert.equal(own.effect.latencySeconds, tableSeconds('4x', rate), `${pedal} 자기 플래그 끔 지연 @${rate}`);
    // 다른 페달의 플래그를 끄는 것은 이 페달에 영향이 없다
    const other = build_(() => { for (const key of Object.keys(PEDAL_FLAG)) if (key !== pedal) setFeatureFlagOverride(PEDAL_FLAG[key], false); });
    assert.equal(other.mode, '2x', `${pedal}: 다른 페달 플래그는 상관없다`);
    // 꺼진 페달은 4배여도 지연 0 이고, 켜졌다 꺼지면 0 으로 돌아온다
    resetFeatureFlagOverrides();
    setFeatureFlagOverride('oversample2x', false);
    const off = new Effect(fakeContext(rate), pedalState(pedal, false));
    assert.equal(off.latencySeconds, 0, `${pedal} 꺼짐: 0`);
    off.update(pedalState(pedal, true));
    assert.equal(off.latencySeconds, tableSeconds('4x', rate), `${pedal} 켜면 4배 표`);
    off.update(pedalState(pedal, false));
    assert.equal(off.latencySeconds, 0, `${pedal} 다시 끄면 0`);
    // 이펙트를 만든 뒤에 플래그를 바꿔도 이미 만든 이펙트는 그대로다(만들 때 한 번 읽는다)
    resetFeatureFlagOverrides();
    const kept = build_();
    setFeatureFlagOverride('oversample2x', false);
    kept.effect.update(pedalState(pedal, true));
    assert.equal(kept.effect.latencySeconds, tableSeconds('2x', rate), `${pedal}: 만든 뒤 플래그를 바꿔도 그대로`);
    assert.equal(shapers[0].oversample, '2x', `${pedal}: WaveShaper 도 그대로`);
    resetFeatureFlagOverrides();
  }
}

// ---------------------------------------------------------------------------------------------
// 3. 표와 기준선(P-16 의 2배, P-29 의 4배)
// ---------------------------------------------------------------------------------------------
const baseline = JSON.parse(await readFile(new URL('docs/baseline/audio-probe.json', rootUrl), 'utf8'));
for (const rate of ['44100', '48000']) {
  const p16 = baseline.results[rate]['P-16'].metrics;
  const p29 = baseline.results[rate]['P-29'].metrics;
  near(p29['latencyMs.empty'], p16['latencyMs.empty'], 0.005, `P-29 빈 체인 = P-16 빈 체인 @${rate}`);
  for (const pedal of ['drive', 'crunch', 'fuzz']) {
    near(table.oversample['2x'][rate], p29[`latencyMs.extra.${pedal}.2x`], 0.01, `latency.json 2배 @${rate} = P-29 ${pedal} 2x`);
    near(p29[`latencyMs.extra.${pedal}.2x`], p16[`latencyMs.${pedal}`] - p16['latencyMs.empty'], 0.01, `P-29 ${pedal} 2x = P-16 ${pedal} − 빈 체인`);
    near(table.oversample['4x'][rate], p29[`latencyMs.extra.${pedal}.4x`], 0.01, `latency.json 4배 @${rate} = P-29 ${pedal} 4x`);
  }
}
{
  // 4배 표도 샘플레이트 환산이 2배와 같은 방식이다(프레임 수를 유지)
  const frames = (tableSeconds('4x', 48000) * 48000);
  near(fixedLatencySeconds('oversample4x', 96000), frames / 96000, 1e-12, '4배: 96 kHz 는 48 kHz 값의 프레임 수로');
  assert.equal(fixedLatencySeconds('oversample4x', 0), 0);
}

// ---------------------------------------------------------------------------------------------
// 4. nonHarmonicDb
// ---------------------------------------------------------------------------------------------
{
  const size = 4096;
  const bin = 101; // 홀수. 기본음 = 101 × rate / 4096
  const build_ = (parts, offset = 0) => {
    const signal = new Float64Array(size + 1000);
    for (let i = 0; i < signal.length; i += 1) {
      let value = offset;
      for (const [part, amplitude] of parts) value += amplitude * Math.sin((2 * Math.PI * part * i) / size);
      signal[i] = value;
    }
    return signal;
  };
  const measure = (parts, offset = 0, start = 0, guard) => nonHarmonicDb(build_(parts, offset), size, bin, start, guard);
  assert.ok(measure([[bin, 0.5]]) <= -190, '순수한 사인은 배음이 아닌 성분이 없다');
  assert.ok(measure([[bin, 0.5]], 0, 777) <= -190, '창 시작 위치와 상관없다(기본음이 bin 에 딱 맞으면 주기가 창에 정수 번 들어간다)');
  near(measure([[bin, 0.5], [777, 0.005]]), -40, 0.01, '−40 dBc 에일리어스(기본음 0.5, 에일리어스 0.005)');
  near(measure([[bin, 0.5], [150, 0.05]]), -20, 0.01, '−20 dBc');
  near(measure([[bin, 0.5], [777, 0.005], [1511, 0.005]]), -37, 0.02, '같은 크기 둘이면 3 dB 커진다(전력 합)');
  assert.ok(measure([[bin, 0.5], [2 * bin, 0.25], [3 * bin, 0.1], [7 * bin, 0.05]]) <= -190, '배음(2·3·7 배)은 세지 않는다');
  near(measure([[bin, 0.5], [2 * bin, 0.25], [777, 0.005]]), -40, 0.01, '배음이 있어도 에일리어스만 센다');
  assert.ok(measure([[bin, 0.5]], 0.1) <= -190, '직류는 세지 않는다');
  // guard: 배음 자리 ±guard bin 을 가린다. Hann 창은 한 성분을 ±1 bin 로 번지게 하므로 가장자리 성분은 번진 한 칸이 세어진다.
  assert.ok(measure([[bin, 0.5], [3 * bin + 1, 0.005]]) <= -190, '배음에서 1칸 떨어진 성분은 번짐까지 가려진다');
  near(measure([[bin, 0.5], [3 * bin + 2, 0.005]]), -47.78, 0.05, '배음에서 2칸: 가운데는 가려지고 번진 한 칸(1/6 전력)만 센다');
  near(measure([[bin, 0.5], [3 * bin + 4, 0.005]]), -40, 0.01, '배음에서 4칸 떨어지면 온전히 센다');
  assert.ok(measure([[bin, 0.5], [3 * bin + 2, 0.005]], 0, 0, 3) <= -190, 'guard 를 3 으로 넓히면 2칸 떨어진 성분도 가려진다');
}

// ---------------------------------------------------------------------------------------------
// 5. 소스
// ---------------------------------------------------------------------------------------------
for (const [file, pedal] of [['DriveEffect', 'drive'], ['CrunchEffect', 'crunch'], ['FuzzEffect', 'fuzz']]) {
  const source = await readFile(new URL(`src/audio/nodes/${file}.ts`, rootUrl), 'utf8');
  assert.ok(!/oversample\s*=\s*'[0-9n]/.test(source), `${file}: 오버샘플링 문자열을 직접 쓰지 않는다`);
  assert.ok(source.includes(`oversampleModeFor('${pedal}')`), `${file}: oversampleModeFor('${pedal}') 로 배수를 정한다`);
  assert.ok(source.includes('this.shaper.oversample = this.oversampleMode'), `${file}: WaveShaper 에 정한 배수를 준다`);
  assert.ok(source.includes("'oversample4x'"), `${file}: 지연은 배수의 표를 쓴다`);
}

console.log('왜곡 페달 오버샘플링(S3.7) 시험 통과');
