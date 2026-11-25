// S2.10 지연·끊김 표시(D11, R2-10) — Node 수준의 시험.
//   1. 단위: 입력 트랙 통계(ms)·트랙 설정(초)·컨텍스트 지연(초)을 ms 로 통일한다. 쓸 수 없는 값은 null 이다('미포함').
//   2. 합계: 입력 + 처리(켜진 페달 + 리미터) + 출력. 읽지 못한 조각은 합계에 0 으로 들어가고 missing 에 적힌다. 음원 파일은 입력 지연이 없다(0).
//   3. 페달 지연: BaseEffect.latencySeconds 는 꺼져 있으면 0, 켜져 있으면 processingLatencySeconds(기본 0). 드라이브·크런치·퍼즈(2배 오버샘플링)와
//      캐비닛(컨볼버)만 값이 있고, 그 값은 params/latency.json 이다. 이 표는 docs/baseline/audio-probe.json 의 P-16 에서 나온 값과 맞아야 한다.
//   4. 끊김: playbackStats.underrunEvents 의 '세션 시작 대비' 증가분. 지원하지 않으면 null('측정 불가').
//   5. 노이즈 게이트 워클릿에서 글리치 집계를 없앴다(소스 확인).
//   6. 화면 문구: 지연 안내에 'ASIO' 가 없고, 설계서 4.12 의 안내가 그대로 있다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const rootUrl = new URL('../', import.meta.url);
const importBundle = async (result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

// ---------------------------------------------------------------------------------------------
// 묶기: 순수 계산 모듈과 페달 클래스, 그리고 AudioEngine
// ---------------------------------------------------------------------------------------------
const harness = await importBundle(
  await build({
    plugins: [workerUrlStub],
    stdin: {
      contents: [
        "export * from './audio/engine/latency.ts';",
        "export { BaseEffect } from './audio/nodes/BaseEffect.ts';",
        "export { DriveEffect } from './audio/nodes/DriveEffect.ts';",
        "export { CrunchEffect } from './audio/nodes/CrunchEffect.ts';",
        "export { FuzzEffect } from './audio/nodes/FuzzEffect.ts';",
        "export { CabEffect } from './audio/nodes/CabEffect.ts';",
        "export { initialPedals } from './presets/initialPedals.ts';",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('src', rootUrl)),
      sourcefile: 'latency-harness.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  }),
);
const {
  EMPTY_LATENCY, LATENCY_ADVICE, LATENCY_ADVICE_THRESHOLD_MS, UNDERRUN_UNAVAILABLE_REASON,
  secondsToMs, readInputLatency, readOutputLatency, fixedLatencySeconds, limiterLatencyMs, pedalsLatencyMs,
  summarizeLatency, formatLatency, readUnderrunEvents, underrunsSince,
  BaseEffect, DriveEffect, CrunchEffect, FuzzEffect, CabEffect, initialPedals,
} = harness;

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected} (±${tolerance})`);

// ---------------------------------------------------------------------------------------------
// 1. 단위
// ---------------------------------------------------------------------------------------------
assert.equal(secondsToMs(0.01), 10, '초 → ms');
assert.equal(secondsToMs(0), 0);
for (const bad of [undefined, null, '0.01', NaN, Infinity, -0.001, {}]) assert.equal(secondsToMs(bad), null, `못 쓰는 값: ${String(bad)}`);

const track = (stats, settings) => ({ stats, getSettings: () => settings });
// 트랙 통계는 이미 ms 다(곱하지 않는다). 트랙 설정은 초라 1000 을 곱한다.
assert.deepEqual(readInputLatency(track({ latency: 12 }, { latency: 0.002 })), { ms: 12, source: 'track-stats' }, '통계가 있으면 설정보다 먼저(ms 그대로)');
assert.deepEqual(readInputLatency(track(undefined, { latency: 0.01 })), { ms: 10, source: 'track-settings' }, '통계가 없으면 설정(초 → ms)');
assert.deepEqual(readInputLatency(track({ latency: 0 }, { latency: 0.002 })), { ms: 2, source: 'track-settings' }, '통계 0 은 잰 값이 없다는 뜻이라 설정으로 간다');
assert.deepEqual(readInputLatency(track({ latency: NaN }, { latency: 0.002 })), { ms: 2, source: 'track-settings' }, '통계가 숫자가 아니면 설정');
assert.deepEqual(readInputLatency(track({ latency: -3 }, { latency: 0.002 })), { ms: 2, source: 'track-settings' }, '통계가 음수면 설정');
assert.deepEqual(readInputLatency(track({}, { latency: 0.005 })), { ms: 5, source: 'track-settings' }, '통계 객체에 latency 가 없으면 설정');
assert.deepEqual(readInputLatency(track(null, { latency: 0.005 })), { ms: 5, source: 'track-settings' }, 'stats 가 null 이면 설정');
assert.deepEqual(readInputLatency(track(undefined, { latency: 0 })), { ms: 0, source: 'track-settings' }, '설정이 0 이면 0 ms(예전 동작 그대로)');
assert.equal(readInputLatency(track(undefined, {})), null, '둘 다 없으면 null');
assert.equal(readInputLatency(track(undefined, undefined)), null, '설정 객체도 없으면 null');
assert.equal(readInputLatency(track(undefined, { latency: 'fast' })), null, '설정이 문자열이면 null');
assert.equal(readInputLatency(null), null, '트랙이 없으면 null');
assert.equal(readInputLatency(undefined), null);
assert.equal(readInputLatency('track'), null, '객체가 아니면 null');
const throwingStats = { get stats() { throw new Error('no stats'); }, getSettings: () => ({ latency: 0.004 }) };
assert.deepEqual(readInputLatency(throwingStats), { ms: 4, source: 'track-settings' }, '통계를 읽다 예외가 나면 설정으로');
const throwingSettings = { stats: { latency: 0 }, getSettings: () => { throw new Error('device lost'); } };
assert.equal(readInputLatency(throwingSettings), null, '설정을 읽다 예외가 나면 null(통계도 0)');
assert.deepEqual(readInputLatency({ stats: { latency: 7 }, getSettings: () => { throw new Error('device lost'); } }), { ms: 7, source: 'track-stats' }, '통계가 있으면 설정을 읽지 않는다');

assert.deepEqual(readOutputLatency({ baseLatency: 0.01, outputLatency: 0.005 }), { base: 10, device: 5 }, '출력 지연도 초 → ms');
assert.deepEqual(readOutputLatency({ baseLatency: 0.01 }), { base: 10, device: null }, 'outputLatency 가 없으면 장치 지연만 null');
assert.deepEqual(readOutputLatency({ outputLatency: 0.005 }), { base: null, device: 5 });
assert.deepEqual(readOutputLatency({}), { base: null, device: null });
assert.deepEqual(readOutputLatency({ baseLatency: NaN, outputLatency: -1 }), { base: null, device: null }, '쓸 수 없는 값은 null');
assert.deepEqual(readOutputLatency({ get baseLatency() { throw new Error('x'); }, outputLatency: 0.002 }), { base: null, device: 2 }, '읽다 예외가 나도 다른 조각은 읽는다');

// ---------------------------------------------------------------------------------------------
// 2. 합계와 '미포함'
// ---------------------------------------------------------------------------------------------
const full = { sampleRate: 48000, inputKind: 'device', input: 10, inputSource: 'track-stats', pedals: 2.705, limiter: 1, outputBase: 10, outputDevice: 5 };
let summary = summarizeLatency(full);
near(summary.totalMs, 28.705, 1e-9, '입력 10 + 처리 3.705 + 출력 15');
assert.equal(summary.inputMs, 10);
near(summary.processingMs, 3.705, 1e-9, '처리 = 페달 + 리미터');
assert.equal(summary.outputMs, 15);
assert.deepEqual(summary.missing, []);

summary = summarizeLatency({ ...full, input: null, inputSource: null });
near(summary.totalMs, 18.705, 1e-9, '입력을 못 읽으면 합계에서 빠진다');
assert.equal(summary.inputMs, null);
assert.deepEqual(summary.missing, ['input']);

summary = summarizeLatency({ ...full, inputKind: 'file', input: null, inputSource: null });
near(summary.totalMs, 18.705, 1e-9, '음원 파일은 입력 지연이 0 이다');
assert.equal(summary.inputMs, 0);
assert.deepEqual(summary.missing, [], '음원 파일의 입력은 미포함이 아니라 해당 없음');

summary = summarizeLatency({ ...full, outputDevice: null });
near(summary.totalMs, 23.705, 1e-9);
assert.equal(summary.outputMs, 10);
assert.deepEqual(summary.missing, ['outputDevice']);

summary = summarizeLatency({ ...full, outputBase: null });
assert.equal(summary.outputMs, 5);
assert.deepEqual(summary.missing, ['outputBase']);

summary = summarizeLatency({ ...full, outputBase: null, outputDevice: null });
near(summary.totalMs, 13.705, 1e-9, '출력을 전혀 못 읽으면 입력 + 처리');
assert.equal(summary.outputMs, null);
assert.deepEqual(summary.missing, ['output']);

summary = summarizeLatency({ ...full, input: null, outputBase: null, outputDevice: null });
near(summary.totalMs, 3.705, 1e-9, '처리만 읽힌 경우');
assert.deepEqual(summary.missing, ['input', 'output']);

summary = summarizeLatency(EMPTY_LATENCY);
assert.equal(summary.totalMs, null, '컨텍스트가 없으면 합계 없음');
assert.deepEqual(summary.missing, []);

// ---------------------------------------------------------------------------------------------
// 3. 페달 지연 표(P-16)와 페달 클래스
// ---------------------------------------------------------------------------------------------
const baseline = JSON.parse(await readFile(new URL('docs/baseline/audio-probe.json', rootUrl), 'utf8'));
const table = JSON.parse(await readFile(new URL('src/audio/params/latency.json', rootUrl), 'utf8'));
assert.equal(table.unit, 'ms');
for (const rate of ['44100', '48000']) {
  const p16 = baseline.results[rate]['P-16'].metrics;
  const empty = p16['latencyMs.empty'];
  near(empty, 1000 * (Math.max(1, Math.round(Number(rate) * 0.001)) / Number(rate)), 0.005, `P-16 빈 체인은 리미터 룩어헤드(${rate} Hz)`);
  for (const type of ['drive', 'crunch', 'fuzz']) {
    near(table.oversample['2x'][rate], p16[`latencyMs.${type}`] - empty, 0.01, `latency.json oversample 2x @${rate} = P-16 ${type} − 빈 체인`);
  }
  near(table.convolver[rate], p16['latencyMs.cab'] - empty, 0.01, `latency.json convolver @${rate} = P-16 cab − 빈 체인`);
  for (const type of ['noiseGate', 'compressor', 'graphicEq', 'eq']) {
    near(p16[`latencyMs.${type}`], empty, 0.01, `P-16 ${type} 는 지연을 더하지 않는다 → 페달 클래스가 지연 0 이어야 한다`);
  }
}

assert.equal(fixedLatencySeconds('oversample2x', 48000), 0.002705, '표의 값 그대로(초)');
assert.equal(fixedLatencySeconds('oversample2x', 44100), 0.002941);
assert.equal(fixedLatencySeconds('convolver', 48000), 0.000089);
// 표에 없는 샘플레이트: 가장 가까운 측정값의 프레임 수를 유지한 채 환산한다.
const frames48 = 0.002705 * 48000;
near(fixedLatencySeconds('oversample2x', 96000), frames48 / 96000, 1e-12, '96 kHz 는 48 kHz 값의 프레임 수로');
near(fixedLatencySeconds('oversample2x', 32000), (0.002941 * 44100) / 32000, 1e-12, '32 kHz 는 가장 가까운 44.1 kHz 값의 프레임 수로');
near(fixedLatencySeconds('oversample2x', 48000.4), 0.002705, 1e-12, '반올림한 샘플레이트로 표를 찾는다');
for (const bad of [0, -1, NaN, Infinity]) assert.equal(fixedLatencySeconds('oversample2x', bad), 0, `샘플레이트 ${bad}`);

near(limiterLatencyMs(48000), 1, 1e-12, '리미터 룩어헤드 48 kHz = 48 프레임 = 1 ms');
near(limiterLatencyMs(44100), (44 / 44100) * 1000, 1e-12, '44.1 kHz = 44 프레임');
assert.equal(limiterLatencyMs(0), 0);

near(pedalsLatencyMs([{ latencySeconds: 0.002705 }, { latencySeconds: 0 }, { latencySeconds: 0.000089 }]), 2.794, 1e-9, '켜진 페달들의 합(ms)');
assert.equal(pedalsLatencyMs([]), 0);
assert.equal(pedalsLatencyMs(new Map([['a', { latencySeconds: NaN }], ['b', { latencySeconds: -1 }]]).values()), 0, '쓸 수 없는 값은 더하지 않는다');

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
const fakeContext = (sampleRate) => ({
  sampleRate, currentTime: 0,
  createGain: () => new FakeNode(), createBiquadFilter: () => new FakeNode(), createWaveShaper: () => new FakeNode(), createConvolver: () => new FakeNode(),
  createBuffer: (count, length) => {
    const data = Array.from({ length: count }, () => new Float32Array(length));
    return { numberOfChannels: count, length, getChannelData: (channel) => data[channel] };
  },
});
const pedalState = (id, active = true, params = {}) => {
  const base = initialPedals.find((candidate) => candidate.id === id);
  assert.ok(base, `기본 페달 ${id}`);
  return { ...structuredCloneJson(base), active, params: { ...structuredCloneJson(base.params), ...params } };
};
function structuredCloneJson(value) { return JSON.parse(JSON.stringify(value)); }

for (const sampleRate of [44100, 48000]) {
  const context = fakeContext(sampleRate);
  const expected = { oversample: table.oversample['2x'][String(sampleRate)] / 1000, convolver: table.convolver[String(sampleRate)] / 1000 };
  for (const [Effect, id, seconds] of [[DriveEffect, 'drive', expected.oversample], [CrunchEffect, 'crunch', expected.oversample], [FuzzEffect, 'fuzz', expected.oversample], [CabEffect, 'cab', expected.convolver]]) {
    const on = new Effect(context, pedalState(id, true));
    assert.equal(on.latencySeconds, seconds, `${id} 켜짐 @${sampleRate}: 표의 값`);
    const off = new Effect(context, pedalState(id, false));
    assert.equal(off.latencySeconds, 0, `${id} 꺼짐 @${sampleRate}: 0`);
    on.update(pedalState(id, false));
    assert.equal(on.latencySeconds, 0, `${id}: 켜졌다 꺼지면 0 으로 돌아온다`);
    on.update(pedalState(id, true));
    assert.equal(on.latencySeconds, seconds, `${id}: 다시 켜면 표의 값`);
  }
}
{
  const context = fakeContext(48000);
  // 지연 값만 보는 시험이라 IR 교체 타이머(S3.2)는 아무 일도 하지 않는 타이머로 막아 둔다.
  const noTimers = { setTimeout: () => 0, clearTimeout: () => undefined };
  const cabOff = new CabEffect(context, pedalState('cab', true, { model: 'off' }), noTimers);
  assert.equal(cabOff.latencySeconds, 0, '캐비닛 model off 는 컨볼버를 거치지 않는다');
  cabOff.update(pedalState('cab', true, { model: 'v30-4x12' }));
  assert.equal(cabOff.latencySeconds, 0.000089, '모델을 고르면 컨볼버 지연');
  cabOff.update(pedalState('cab', true, { model: 'off' }));
  assert.equal(cabOff.latencySeconds, 0, '다시 off');
  cabOff.setCustomImpulse({ numberOfChannels: 1, length: 1, getChannelData: () => new Float32Array(1) });
  assert.equal(cabOff.latencySeconds, 0.000089, '사용자 IR 은 model off 여도 컨볼버를 쓴다');
  const plain = new BaseEffect(context, pedalState('eq', true));
  assert.equal(plain.latencySeconds, 0, 'BaseEffect 기본 지연은 0');
}

// 기본 체인에서 켜진 페달의 지연 합 + 리미터가 P-16 의 '기본 구성' 측정값과 맞는다(표가 실제 지연을 설명한다).
for (const rate of [44100, 48000]) {
  const context = fakeContext(rate);
  const classes = { drive: DriveEffect, crunch: CrunchEffect, fuzz: FuzzEffect, cab: CabEffect };
  const effects = initialPedals
    .filter((pedal) => pedal.active)
    .map((pedal) => (classes[pedal.type] ? new classes[pedal.type](context, structuredCloneJson(pedal)) : { latencySeconds: 0 }));
  const predicted = pedalsLatencyMs(effects) + limiterLatencyMs(rate);
  near(predicted, baseline.results[String(rate)]['P-16'].metrics['latencyMs.default'], 0.05, `기본 체인 @${rate}: 켜진 페달 지연 합 + 리미터 = P-16 기본 구성`);
}

// 지연을 더하는 페달 클래스는 넷뿐이다. 나머지 페달은 BaseEffect 의 기본 0 을 그대로 쓴다(소스 확인).
{
  const files = (await readdir(new URL('src/audio/nodes/', rootUrl))).filter((name) => name.endsWith('Effect.ts') && name !== 'BaseEffect.ts');
  const overriding = [];
  for (const name of files) {
    const source = await readFile(new URL(`src/audio/nodes/${name}`, rootUrl), 'utf8');
    if (source.includes('processingLatencySeconds')) overriding.push(name);
  }
  assert.deepEqual(overriding.sort(), ['CabEffect.ts', 'CrunchEffect.ts', 'DriveEffect.ts', 'FuzzEffect.ts'], '지연을 더하는 페달 = 오버샘플링 셋 + 캐비닛(P-16 으로 잰 것)');
}

// ---------------------------------------------------------------------------------------------
// 4. 끊김(playbackStats)
// ---------------------------------------------------------------------------------------------
assert.equal(readUnderrunEvents(null), null, '컨텍스트 없음');
assert.equal(readUnderrunEvents({ state: 'running' }), null, 'playbackStats 없음 → 측정 불가');
assert.equal(readUnderrunEvents({ state: 'running', playbackStats: null }), null);
assert.equal(readUnderrunEvents({ state: 'running', playbackStats: {} }), null, 'underrunEvents 없음');
assert.equal(readUnderrunEvents({ state: 'running', playbackStats: { underrunEvents: 0 } }), 0, '0 은 끊김 없음(측정은 된다)');
assert.equal(readUnderrunEvents({ state: 'running', playbackStats: { underrunEvents: 7 } }), 7);
for (const bad of [NaN, -1, 1.5, Infinity, '3', null]) assert.equal(readUnderrunEvents({ state: 'running', playbackStats: { underrunEvents: bad } }), null, `쓸 수 없는 값: ${String(bad)}`);
assert.equal(readUnderrunEvents({ state: 'closed', playbackStats: { underrunEvents: 4 } }), null, '닫힌 컨텍스트');
assert.equal(readUnderrunEvents({ state: 'running', get playbackStats() { throw new Error('x'); } }), null, '읽다 예외');
assert.equal(underrunsSince(8, 5), 3, '세션 시작 대비 증가분');
assert.equal(underrunsSince(5, 5), 0);
assert.equal(underrunsSince(3, 5), 0, '카운터가 되감겨도 음수로 보이지 않는다');
assert.equal(underrunsSince(8, null), 8, '기준선이 없으면 컨텍스트 시작부터');
assert.equal(underrunsSince(null, 5), null, '지금 값을 못 읽으면 측정 불가');
assert.equal(underrunsSince(null, null), null);

// ---------------------------------------------------------------------------------------------
// 5. 화면 문구
// ---------------------------------------------------------------------------------------------
let display = formatLatency(full);
assert.equal(display.totalMs, summarizeLatency(full).totalMs, '화면의 합계 = 계산한 합계');
assert.equal(display.headline, '지연 약 28.7 ms @ 48.0 kHz');
assert.deepEqual(display.items.map((item) => item.key), ['input', 'processing', 'output']);
assert.deepEqual(display.items.map((item) => item.text), [
  '입력 10.0 ms(트랙 통계)',
  '처리 3.7 ms(페달 2.7 ms + 리미터 1.0 ms)',
  '출력 15.0 ms(버퍼 10.0 ms + 장치 5.0 ms)',
]);
assert.equal(display.advice, LATENCY_ADVICE, '20 ms 를 넘으면 안내');

display = formatLatency({ ...full, inputSource: 'track-settings', input: 1 });
assert.equal(display.items[0].text, '입력 1.0 ms(장치 설정값)');
assert.equal(display.advice, null, '합계 20 ms 이하면 안내 없음');
display = formatLatency({ ...full, input: null, inputSource: null });
assert.equal(display.items[0].text, '입력 지연 미포함', '입력을 못 읽으면 미포함');
display = formatLatency({ ...full, inputKind: 'file', input: null, inputSource: null });
assert.equal(display.items[0].text, '입력 없음(음원 파일)');
display = formatLatency({ ...full, outputDevice: null });
assert.equal(display.items[2].text, '출력 10.0 ms(장치 지연 미포함)');
display = formatLatency({ ...full, outputBase: null });
assert.equal(display.items[2].text, '출력 5.0 ms(버퍼 지연 미포함)');
display = formatLatency({ ...full, outputBase: null, outputDevice: null });
assert.equal(display.items[2].text, '출력 지연 미포함');
display = formatLatency(EMPTY_LATENCY);
assert.equal(display.headline, '지연시간 측정 대기');
assert.deepEqual(display.items, []);
assert.equal(display.totalMs, null);
assert.equal(display.advice, null);

// 안내 경계: 정확히 20 ms 는 안내하지 않고, 그보다 크면 한다.
assert.equal(LATENCY_ADVICE_THRESHOLD_MS, 20);
const atThreshold = { ...full, outputBase: 10, outputDevice: 0 };
atThreshold.input = 20 - (atThreshold.pedals + atThreshold.limiter) - 10;
near(summarizeLatency(atThreshold).totalMs, 20, 1e-9, '경계 값을 만들었다');
assert.equal(formatLatency(atThreshold).advice, null, '정확히 20 ms 는 안내하지 않는다');
assert.equal(formatLatency({ ...atThreshold, input: atThreshold.input + 0.1 }).advice, LATENCY_ADVICE, '20 ms 를 넘으면 안내한다');

for (const needle of ['유선 헤드폰', '블루투스', '다른 오디오 앱', '48 kHz', '노트북 전원']) assert.ok(LATENCY_ADVICE.includes(needle), `안내에 '${needle}'`);
assert.ok(LATENCY_ADVICE.startsWith('지연을 줄이려면:'));
const everyText = [LATENCY_ADVICE, UNDERRUN_UNAVAILABLE_REASON, display.headline, ...formatLatency(full).items.map((item) => item.text)];
for (const text of everyText) assert.ok(!/asio/i.test(text), `'ASIO' 가 화면 문구에 없다: ${text}`);
assert.ok(UNDERRUN_UNAVAILABLE_REASON.includes('playbackStats'), '측정 불가의 이유를 말한다');

// ---------------------------------------------------------------------------------------------
// 6. AudioEngine 의 읽기(세션 기준선)
// ---------------------------------------------------------------------------------------------
const { AudioEngine } = await importBundle(
  await build({ plugins: [workerUrlStub], entryPoints: [fileURLToPath(new URL('src/audio/AudioEngine.ts', rootUrl))], bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false }),
);
const engine = AudioEngine.getInstance();
assert.deepEqual(engine.readLatency(), EMPTY_LATENCY, '컨텍스트가 없으면 빈 읽음');
assert.equal(engine.readUnderrunCount(), null, '컨텍스트가 없으면 측정 불가');
assert.deepEqual(engine.readProcessingLatency(), { sampleRate: 0, pedals: 0, limiter: 0 }, '컨텍스트가 없으면 처리 지연도 비어 있다');

engine.context = { state: 'running', sampleRate: 48000, baseLatency: 0.01, outputLatency: 0.005, playbackStats: { underrunEvents: 3 } };
engine.stream = { getAudioTracks: () => [{ stats: { latency: 6 }, getSettings: () => ({ latency: 0.002 }) }] };
engine.effects = new Map([
  ['drive', { latencySeconds: 0.002705 }],
  ['noise-gate', { latencySeconds: 0 }],
  ['cab', { latencySeconds: 0.000089 }],
]);
let reading = engine.readLatency();
assert.equal(reading.sampleRate, 48000);
assert.equal(reading.inputKind, 'device');
assert.equal(reading.input, 6, '트랙 통계가 먼저');
assert.equal(reading.inputSource, 'track-stats');
near(reading.pedals, 2.794, 1e-9, '엔진이 가진 페달들의 지연 합');
near(reading.limiter, 1, 1e-12);
assert.equal(reading.outputBase, 10);
assert.equal(reading.outputDevice, 5);
near(summarizeLatency(reading).totalMs, 6 + 2.794 + 1 + 15, 1e-9, '입력 + 처리 + 출력이 모두 합계에 들어간다');
const processingOnly = engine.readProcessingLatency();
assert.equal(processingOnly.sampleRate, 48000);
near(processingOnly.pedals, 2.794, 1e-9, '처리 지연만 따로 읽어도 같은 값');
near(processingOnly.limiter, 1, 1e-12);
engine.effects.set('fuzz', { latencySeconds: 0.002705 });
near(engine.readProcessingLatency().pedals, 2.794 + 2.705, 1e-9, '페달이 늘면(그래프가 만들어지면) 바로 반영된다');
engine.effects.delete('fuzz');

engine.stream = { getAudioTracks: () => [{ getSettings: () => ({ latency: 0.002 }) }] };
reading = engine.readLatency();
assert.equal(reading.input, 2, '트랙 통계가 없으면 설정');
assert.equal(reading.inputSource, 'track-settings');
engine.stream = { getAudioTracks: () => [{ getSettings: () => ({}) }] };
assert.equal(engine.readLatency().input, null, '둘 다 없으면 미포함');
engine.stream = { getAudioTracks: () => { throw new Error('device lost'); } };
assert.equal(engine.readLatency().input, null, '장치가 빠져 예외가 나도 읽기는 죽지 않는다');
engine.stream = null;
engine.audioElement = {};
reading = engine.readLatency();
assert.equal(reading.inputKind, 'file', '음원 파일 모드');
assert.equal(reading.input, null);
assert.deepEqual(summarizeLatency(reading).missing, [], '음원 파일 모드는 입력 미포함이 아니다');
engine.audioElement = null;

// 끊김: 세션 시작 때 읽은 값이 기준선이다.
engine.underrunBaseline = null;
assert.equal(engine.readUnderrunCount(), 3, '기준선이 없으면 컨텍스트 시작부터 센다');
engine.markSessionStart(engine.context);
assert.equal(engine.underrunBaseline, 3, '세션 시작 때의 값이 기준선');
assert.equal(engine.readUnderrunCount(), 0, '시작 직후에는 0');
engine.context.playbackStats.underrunEvents = 10;
assert.equal(engine.readUnderrunCount(), 7, '증가분 = 10 − 3');
engine.context.playbackStats.underrunEvents = NaN;
assert.equal(engine.readUnderrunCount(), null, '값이 깨지면 측정 불가');
engine.context.playbackStats.underrunEvents = 12;
assert.equal(engine.readUnderrunCount(), 9);
delete engine.context.playbackStats;
assert.equal(engine.readUnderrunCount(), null, '지원하지 않으면 측정 불가');
engine.markSessionStart(engine.context);
assert.equal(engine.underrunBaseline, null, '지원하지 않는 컨텍스트의 기준선은 null');
engine.context = { state: 'closed', sampleRate: 48000, playbackStats: { underrunEvents: 1 } };
assert.deepEqual(engine.readLatency(), EMPTY_LATENCY, '닫힌 컨텍스트는 빈 읽음');
assert.equal(engine.readUnderrunCount(), null);
assert.deepEqual(engine.readProcessingLatency(), { sampleRate: 0, pedals: 0, limiter: 0 }, '닫힌 컨텍스트의 처리 지연도 비어 있다');

// ---------------------------------------------------------------------------------------------
// 7. 소스 확인: 노이즈 게이트의 글리치 집계가 없다, 화면에 ASIO 가 없다
// ---------------------------------------------------------------------------------------------
const read = (path) => readFile(new URL(path, rootUrl), 'utf8');
const gateWorklet = await read('src/audio/worklets/noise-gate-processor.ts');
const gateEffect = await read('src/audio/nodes/NoiseGateEffect.ts');
for (const [name, source] of [['noise-gate-processor.ts', gateWorklet], ['NoiseGateEffect.ts', gateEffect]]) {
  for (const word of ['glitch', 'Glitch', 'missedFrames', 'lastProcessFrame']) assert.ok(!source.includes(word), `${name} 에 ${word} 가 없다`);
}
assert.ok(gateWorklet.includes("type: 'gate-state'") || gateWorklet.includes("'gate-state'"), '게이트 상태 메시지는 그대로 있다');

const meterSource = await read('src/components/Meter.tsx');
const connectSource = await read('src/components/ConnectGuitarPanel.tsx');
const readme = await read('README.md');
for (const [name, source] of [['Meter.tsx', meterSource], ['ConnectGuitarPanel.tsx', connectSource], ['README.md', readme]]) {
  assert.ok(!/asio/i.test(source), `${name} 에 ASIO 안내가 없다`);
}
assert.ok(meterSource.includes('formatLatency(latency)'), 'Meter 는 formatLatency 로 문구를 만든다(합계와 항목이 같은 계산에서 나온다)');
assert.ok(meterSource.includes('UNDERRUN_UNAVAILABLE_REASON'), '측정 불가의 이유를 툴팁으로 보인다');
assert.ok(meterSource.includes('underrunCount'), 'Meter 는 세션 대비 끊김 수를 보인다');

console.log('Latency regression passed: units, input+processing+output total, pedal latency table vs P-16, session-relative underruns, wording.');
