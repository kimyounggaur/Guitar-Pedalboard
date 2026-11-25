// S3.6 새 컴프레서 경로(기능 플래그 newCompressor)와 플래그 모듈의 시험.
//  1) src/config/flags.ts: 주소 읽기(?ff=a,-b), 기본값, 시험용 덮어쓰기
//  2) compressor-processor 워클릿: 경로 고르기, 새 경로(version 2)의 RMS 검출기·자동 메이크업 없음·30 Hz 보고, 옛 경로와의 차이
//  3) CompressorEffect: 플래그에 따라 워클릿에 processorOptions 를 넘기는지
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import vm from 'node:vm';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// ---------------------------------------------------------------------------------------------
// 1) 플래그 모듈 — 같은 번들 하나를 CompressorEffect 와 나눠 쓰도록 flags 는 CompressorEffect 와 함께 로드한다.
// ---------------------------------------------------------------------------------------------
const flags = await load('src/config/flags.ts');
{
  const { parseFeatureFlags, isFeatureEnabled, setFeatureFlagOverride, resetFeatureFlagOverrides, FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_NAMES } = flags;
  assert.deepEqual([...FEATURE_FLAG_NAMES], ['newCompressor']);
  assert.equal(FEATURE_FLAG_DEFAULTS.newCompressor, false, '청취 승인 전에는 꺼져 있다(설계서 7.2)');
  assert.deepEqual(parseFeatureFlags(''), {});
  assert.deepEqual(parseFeatureFlags('?ff=newCompressor'), { newCompressor: true });
  assert.deepEqual(parseFeatureFlags('ff=newCompressor'), { newCompressor: true }, '? 없이도');
  assert.deepEqual(parseFeatureFlags('?ff=-newCompressor'), { newCompressor: false });
  assert.deepEqual(parseFeatureFlags('?ff=unknown,newCompressor,,'), { newCompressor: true }, '모르는 이름·빈 조각은 무시');
  assert.deepEqual(parseFeatureFlags('?ff=unknown'), {});
  assert.deepEqual(parseFeatureFlags('?a=1&ff=-newCompressor&ff=newCompressor'), { newCompressor: true }, '뒤의 것이 이긴다');
  assert.deepEqual(parseFeatureFlags('?ff=newCompressor,-newCompressor'), { newCompressor: false });
  assert.deepEqual(parseFeatureFlags('?ff=%20newCompressor%20'), { newCompressor: true }, '앞뒤 공백');
  assert.deepEqual(parseFeatureFlags('?FF=newCompressor'), {}, '대소문자를 구분한다');
  assert.deepEqual(parseFeatureFlags('?ff=NewCompressor'), {});
  assert.deepEqual(parseFeatureFlags('?ff=- newCompressor'), { newCompressor: false }, '- 뒤 공백');
  // 검색 부분이 없는 환경(Node·워클릿)에서는 기본값
  assert.equal(isFeatureEnabled('newCompressor'), false);
  setFeatureFlagOverride('newCompressor', true);
  assert.equal(isFeatureEnabled('newCompressor'), true);
  setFeatureFlagOverride('newCompressor', false);
  assert.equal(isFeatureEnabled('newCompressor'), false);
  setFeatureFlagOverride('newCompressor', null);
  assert.equal(isFeatureEnabled('newCompressor'), false, '지우면 기본값');
  // 주소에서 읽은 값: location 이 있을 때 주소가 기본값을 이기고, 덮어쓰기가 주소를 이긴다
  globalThis.location = { search: '?ff=newCompressor' };
  resetFeatureFlagOverrides();
  assert.equal(isFeatureEnabled('newCompressor'), true, '주소 ?ff=newCompressor');
  setFeatureFlagOverride('newCompressor', false);
  assert.equal(isFeatureEnabled('newCompressor'), false, '덮어쓰기가 주소를 이긴다');
  resetFeatureFlagOverrides();
  assert.equal(isFeatureEnabled('newCompressor'), true, 'reset 은 덮어쓰기를 지우고 주소를 다시 읽는다');
  globalThis.location = { search: '?ff=-newCompressor' };
  resetFeatureFlagOverrides();
  assert.equal(isFeatureEnabled('newCompressor'), false);
  // 덮어쓰기를 null 로 지우면 주소 값으로 돌아간다(기본값이 아니라)
  globalThis.location = { search: '?ff=newCompressor' };
  resetFeatureFlagOverrides();
  setFeatureFlagOverride('newCompressor', false);
  setFeatureFlagOverride('newCompressor', null);
  assert.equal(isFeatureEnabled('newCompressor'), true, 'null 은 주소 값으로 돌아간다');
  // 주소는 한 번 읽고 기억한다: 읽은 뒤 주소가 바뀌어도 reset 전에는 그대로
  globalThis.location = { search: '' };
  assert.equal(isFeatureEnabled('newCompressor'), true, '주소는 한 번만 읽는다');
  resetFeatureFlagOverrides();
  assert.equal(isFeatureEnabled('newCompressor'), false, 'reset 뒤에는 새 주소를 읽는다');
  delete globalThis.location;
  resetFeatureFlagOverrides();
  assert.equal(isFeatureEnabled('newCompressor'), false);
}

// ---------------------------------------------------------------------------------------------
// 2) 워클릿
// ---------------------------------------------------------------------------------------------
const { compressorProcessorSource } = await load('src/audio/worklets/compressor-processor.ts');

function makeProcessorClass(sampleRate) {
  let Processor;
  class MockProcessor {
    constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); } }; }
  }
  vm.runInNewContext(compressorProcessorSource, {
    sampleRate, AudioWorkletProcessor: MockProcessor,
    registerProcessor(name, klass) { assert.equal(name, 'compressor-processor'); Processor = klass; },
  });
  return Processor;
}

const BLOCK = 128;
function defaultsFor(overrides = {}) {
  const base = { threshold: -30, ratio: 4, knee: 0, attack: .003, release: .2 };
  const merged = { ...base, ...overrides };
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, [value]]));
}
/** 블록(128)마다 process 를 불러 left(·right)를 통과시킨다. 출력 채널 둘을 돌려주고 블록마다의 감소량(dB)을 모은다. */
function drive(processor, params, left, right = null, trace = null) {
  const length = left.length;
  const outLeft = new Float32Array(length);
  const outRight = new Float32Array(length);
  for (let start = 0; start < length; start += BLOCK) {
    const end = Math.min(length, start + BLOCK);
    const inLeft = left.subarray(start, end);
    const input = right ? [inLeft, right.subarray(start, end)] : [inLeft];
    const output = [outLeft.subarray(start, end), outRight.subarray(start, end)];
    assert.equal(processor.process([input], [output], params), true);
    if (trace) trace.push(processor.reductionDb);
  }
  return [outLeft, outRight];
}
function sine(rate, seconds, hz, amplitude) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}
function rmsDb(samples, from, to) {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / (to - from));
}
const options2 = (extra = {}) => ({ processorOptions: { version: 2, ...extra } });

for (const rate of [44100, 48000]) {
  const Processor = makeProcessorClass(rate);
  const label = `${rate} Hz`;

  // 경로 고르기: 옵션이 없거나 이상하면 옛 경로(1)
  assert.equal(new Processor().version, 1, `${label}: 옵션 없음 = 옛 경로`);
  assert.equal(new Processor({}).version, 1);
  assert.equal(new Processor({ processorOptions: {} }).version, 1);
  assert.equal(new Processor({ processorOptions: { version: 3 } }).version, 1);
  assert.equal(new Processor({ processorOptions: { version: '2' } }).version, 1, '문자열 2 는 옛 경로');
  assert.equal(new Processor(options2()).version, 2);
  assert.equal(new Processor(options2()).detector, 'rms', '검출기 기본은 RMS');
  assert.equal(new Processor(options2({ detector: 'peak' })).detector, 'peak');
  assert.equal(new Processor(options2({ detector: 'nonsense' })).detector, 'rms');

  // 1:1 은 모든 표본을 그대로 통과(지연·메이크업 없음)
  const identity = new Processor(options2());
  const impulse = new Float32Array(rate / 10); impulse[0] = .5; impulse[300] = -.25;
  const [passLeft, passRight] = drive(identity, defaultsFor({ ratio: 1 }), impulse);
  assert.deepEqual(passLeft, impulse, `${label}: 1:1 은 그대로`);
  assert.deepEqual(passRight, impulse, `${label}: 모노는 두 채널에 같게`);

  // 자동 메이크업 없음: −10 dBFS 사인(220 Hz), 문턱 −30, 4:1, 니 0 → 감소량 −15 dB, 출력 레벨도 입력보다 15 dB 낮다
  const tone = sine(rate, 3, 220, Math.pow(10, -10 / 20));
  const fresh = new Processor(options2());
  const [toneOut] = drive(fresh, defaultsFor(), tone);
  const settled = Math.round(rate * 1.5);
  const inputDb = rmsDb(tone, settled, tone.length);
  const outputDb = rmsDb(toneOut, settled, tone.length);
  assert.ok(Math.abs(fresh.reductionDb + 15) < .5, `${label}: 새 경로 정상 상태 감소량 ${fresh.reductionDb}`);
  assert.ok(Math.abs(outputDb - inputDb + 15) < .5, `${label}: 출력 레벨 변화 ${outputDb - inputDb} 는 감소량과 같다(메이크업 없음)`);
  assert.ok(Math.abs(fresh.reductionDb - (outputDb - inputDb)) < .5, `${label}: 표시되는 감소량 = 실제 출력 변화`);
  // 같은 신호를 옛 경로에 넣으면 자동 메이크업이 +12 dB 를 얹어 출력이 감소량과 11 dB 넘게 다르다
  const legacy = new Processor();
  const [legacyOut] = drive(legacy, defaultsFor(), tone);
  const legacyChange = rmsDb(legacyOut, settled, tone.length) - inputDb;
  assert.ok(legacyChange - legacy.reductionDb > 10, `${label}: 옛 경로는 메이크업이 있다(${legacyChange} 대 ${legacy.reductionDb})`);

  // 문턱 아래에서는 아무것도 하지 않는다(레벨 변화 0)
  const quiet = sine(rate, 1, 220, Math.pow(10, -50 / 20));
  const belowThreshold = new Processor(options2());
  const [quietOut] = drive(belowThreshold, defaultsFor({ threshold: -30 }), quiet);
  assert.deepEqual(quietOut, quiet, `${label}: 문턱 아래(니 0)는 그대로`);

  // RMS 창: 진폭 1 의 1 kHz 사인이 시작하고 5 ms 가 지나면 제곱평균이 정상값(0.5)의 63% 쯤(0.316)이다
  const windowProbe = new Processor(options2());
  const fiveMs = Math.round(rate * 0.005);
  const stepIn = sine(rate, 0.01, 1000, 1).subarray(0, fiveMs);
  windowProbe.process([[stepIn]], [[new Float32Array(fiveMs), new Float32Array(fiveMs)]], defaultsFor({ ratio: 1 }));
  assert.ok(windowProbe.meanSquare > .30 && windowProbe.meanSquare < .335, `${label}: 5 ms 뒤 제곱평균 ${windowProbe.meanSquare}`);

  // 검출기 보정: 사인에서 RMS 와 피크 검출기가 같은 감소량(오차 0.5 dB 안)
  const peakDetector = new Processor(options2({ detector: 'peak' }));
  drive(peakDetector, defaultsFor(), tone);
  assert.ok(Math.abs(peakDetector.reductionDb + 15) < .5, `${label}: 피크 검출기 ${peakDetector.reductionDb}`);
  assert.ok(Math.abs(peakDetector.reductionDb - fresh.reductionDb) < .8, `${label}: 사인에서 두 검출기가 거의 같다(${peakDetector.reductionDb} 대 ${fresh.reductionDb})`);

  // 시작 반응: 0 dBFS 1 kHz 가 갑자기 시작할 때 5 ms RMS 평균이 있는 쪽이 첫 블록(128 표본)에서 덜 눌려 있고, 곧 같은 곳으로 간다
  const onset = sine(rate, 0.03, 1000, 1);
  const fastParams = defaultsFor({ ratio: 20, attack: .001, threshold: -30 });
  const rmsTrace = []; const peakTrace = [];
  drive(new Processor(options2()), fastParams, onset, null, rmsTrace);
  drive(new Processor(options2({ detector: 'peak' })), fastParams, onset, null, peakTrace);
  assert.ok(rmsTrace[0] > peakTrace[0] + .5, `${label}: 시작 직후 RMS ${rmsTrace[0]} 는 피크 ${peakTrace[0]} 보다 덜 눌려 있다`);
  assert.ok(Math.abs(rmsTrace.at(-1) - peakTrace.at(-1)) < 1, `${label}: 같은 곳으로 간다(${rmsTrace.at(-1)} 대 ${peakTrace.at(-1)})`);
  assert.ok(rmsTrace.every((value, index) => index === 0 || value <= rmsTrace[index - 1] + 1e-9), `${label}: 시작 동안 감소량이 깊어지기만 한다`);

  // 풀림: 센 소리 뒤 무음에서 릴리스 시정수(0.2 s)만큼 지나면 감소량이 63% 쯤 풀린다
  const hold = new Processor(options2());
  drive(hold, defaultsFor({ release: .2 }), sine(rate, 1, 220, .9));
  const pressed = hold.reductionDb;
  assert.ok(pressed < -15, `${label}: 센 소리에 눌린다 ${pressed}`);
  drive(hold, defaultsFor({ release: .2 }), new Float32Array(Math.round(rate * 0.2)));
  const recovered = (hold.reductionDb - pressed) / -pressed;
  assert.ok(recovered > .55 && recovered < .75, `${label}: 시정수 뒤 회복 ${recovered}`);

  // 가장 센 채널을 따른다: 오른쪽이 더 커도 같은 정도로 누른다
  const rightLouder = new Processor(options2());
  drive(rightLouder, defaultsFor(), tone.map((sample) => sample / 2), tone);
  assert.ok(Math.abs(rightLouder.reductionDb - fresh.reductionDb) < .05, `${label}: 오른쪽이 센 입력 ${rightLouder.reductionDb} 대 ${fresh.reductionDb}`);

  // 두 채널은 같은 이득(링크): 한쪽이 절반 크기여도 비가 2 로 유지
  const linked = new Processor(options2());
  const [linkLeft, linkRight] = drive(linked, defaultsFor(), tone, tone.map((sample) => sample / 2));
  let worstRatio = 0;
  for (let i = rate; i < tone.length; i += 1) {
    if (Math.abs(linkRight[i]) < 1e-3) continue;
    worstRatio = Math.max(worstRatio, Math.abs(linkLeft[i] / linkRight[i] - 2));
  }
  assert.ok(worstRatio < 1e-3, `${label}: 두 채널 이득이 같다(비 오차 ${worstRatio})`);

  // 유한하지 않은 입력은 0 으로, 감소량은 유한하게
  const bad = new Processor(options2());
  const poisoned = tone.slice(0, rate / 4);
  poisoned[100] = NaN; poisoned[101] = Infinity; poisoned[102] = -Infinity;
  const [badOut] = drive(bad, defaultsFor(), poisoned);
  assert.ok(Number.isFinite(bad.reductionDb), `${label}: 감소량 유한`);
  assert.ok(badOut.every(Number.isFinite), `${label}: 출력 유한`);
  assert.equal(badOut[100], 0);
  assert.equal(badOut[101], 0);
  assert.equal(badOut[102], 0);
  assert.ok(bad.reductionDb < -10 && Number.isFinite(bad.meanSquare), `${label}: 유한하지 않은 표본 뒤에도 계속 누른다(${bad.reductionDb})`);
  const softKnee = new Processor(options2());
  drive(softKnee, defaultsFor({ knee: 20 }), poisoned);
  assert.ok(Number.isFinite(softKnee.reductionDb) && softKnee.reductionDb < -10, `${label}: 소프트 니에서도 ${softKnee.reductionDb}`);

  // 무음이 길게 이어져도 감소량 0, 출력 0
  const silent = new Processor(options2());
  const [silentOut] = drive(silent, defaultsFor(), new Float32Array(rate));
  assert.ok(silentOut.every((value) => value === 0));
  assert.equal(silent.reductionDb, 0);

  // 범위 밖 파라미터는 한계로 자른다(문턱 −100, 비 100, 니 100, 어택 0, 릴리스 100)
  const clamped = new Processor(options2());
  const [clampedOut] = drive(clamped, { threshold: [-100], ratio: [100], knee: [100], attack: [0], release: [100] }, tone.subarray(0, rate / 2));
  assert.ok(clampedOut.every(Number.isFinite) && Number.isFinite(clamped.reductionDb), `${label}: 범위 밖 파라미터`);
  const nanParams = new Processor(options2());
  drive(nanParams, { threshold: [NaN], ratio: [NaN], knee: [NaN], attack: [NaN], release: [NaN] }, tone.subarray(0, rate / 4));
  assert.ok(Number.isFinite(nanParams.reductionDb), `${label}: NaN 파라미터`);

  // 보고 속도: 새 경로 30 Hz, 옛 경로 20 Hz (1초)
  const countMessages = (processor) => {
    drive(processor, defaultsFor(), tone.subarray(0, rate));
    return processor.port.messages.filter((message) => message.type === 'reduction').length;
  };
  const newReports = countMessages(new Processor(options2()));
  const oldReports = countMessages(new Processor());
  assert.ok(newReports >= 29 && newReports <= 30, `${label}: 새 경로 보고 ${newReports}번/초`);
  assert.ok(oldReports >= 19 && oldReports <= 20, `${label}: 옛 경로 보고 ${oldReports}번/초`);
  // 첫 보고 시각: 새 경로는 1/30 초가 찬 블록에서, 옛 경로는 1/20 초가 찬 블록에서
  for (const [version, hz] of [[2, 30], [1, 20]]) {
    const timing = new Processor(version === 2 ? options2() : undefined);
    const blocksNeeded = Math.ceil(rate / hz / BLOCK);
    let firstAt = -1;
    for (let block = 1; block <= blocksNeeded + 2; block += 1) {
      drive(timing, defaultsFor(), tone.subarray(0, BLOCK));
      if (firstAt < 0 && timing.port.messages.length > 0) firstAt = block;
    }
    assert.equal(firstAt, blocksNeeded, `${label}: 경로 ${version} 첫 보고 블록 ${firstAt} 대 ${blocksNeeded}`);
  }
  const lastMessage = fresh.port.messages.at(-1);
  assert.equal(lastMessage.type, 'reduction');
  assert.ok(Math.abs(lastMessage.value - fresh.reductionDb) < 1, `${label}: 보고한 값이 실제 감소량을 따른다`);

  // 끝낸 프로세서는 false
  fresh.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(fresh.process([[]], [[new Float32Array(BLOCK)]], defaultsFor()), false);

  // 옛 경로는 그대로다: 같은 입력에서 정상 상태 감소량·메이크업이 옛 시험과 같다(회귀 고정)
  assert.ok(Math.abs(legacy.reductionDb + 15) < .6, `${label}: 옛 경로 감소량 ${legacy.reductionDb}`);
  assert.ok(Math.abs(legacy.makeupDb - 12) < .01, `${label}: 옛 경로 메이크업 ${legacy.makeupDb}`);
  assert.equal(fresh.makeupDb, 0, `${label}: 새 경로에는 메이크업이 없다`);
}

// ---------------------------------------------------------------------------------------------
// 3) CompressorEffect — 플래그가 processorOptions 로 간다
// ---------------------------------------------------------------------------------------------
{
  // flags 모듈은 CompressorEffect 번들 안에 따로 들어 있으니, 같은 번들에서 둘 다 꺼낸다.
  const bundle = await build({
    stdin: {
      contents: "export { CompressorEffect } from './src/audio/nodes/CompressorEffect'; export { setFeatureFlagOverride, resetFeatureFlagOverrides } from './src/config/flags';",
      resolveDir: process.cwd(), sourcefile: 'entry.ts', loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const { CompressorEffect, setFeatureFlagOverride, resetFeatureFlagOverrides } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  class Param {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
  }
  class Node {
    connections = new Set(); gain = new Param();
    connect(node) { this.connections.add(node); }
    disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
  }
  const created = [];
  globalThis.AudioWorkletNode = class extends Node {
    parameters = new Map(['threshold', 'ratio', 'knee', 'attack', 'release'].map((name) => [name, new Param()]));
    port = { onmessage: null, messages: [], postMessage(message) { this.messages.push(message); } };
    constructor(context, name, options) { super(); this.name = name; this.options = options; created.push(this); }
  };
  const context = { currentTime: 0, createGain() { return new Node(); } };
  const pedal = { id: 'compressor', type: 'compressor', active: true,
    params: { mix: 75, level: 100, sustain: 35, threshold: -24, ratio: 4, attack: .006, release: .18, knee: 18 } };

  const legacyEffect = new CompressorEffect(context, pedal);
  assert.equal(legacyEffect.engineVersion, 1, '플래그가 꺼져 있으면 옛 경로');
  assert.deepEqual(created.at(-1).options.processorOptions, { version: 1, detector: 'rms' });
  assert.equal(created.at(-1).name, 'compressor-processor');
  assert.deepEqual(created.at(-1).options.outputChannelCount, [2]);

  setFeatureFlagOverride('newCompressor', true);
  const newEffect = new CompressorEffect(context, pedal);
  assert.equal(newEffect.engineVersion, 2, '플래그가 켜져 있으면 새 경로');
  assert.deepEqual(created.at(-1).options.processorOptions, { version: 2, detector: 'rms' });
  // 파라미터 대응은 두 경로가 같다(Sustain 매크로: 문턱 −18 dB·비 +8 까지)
  assert.equal(created.at(-1).parameters.get('threshold').value, -24 - .35 * 18);
  assert.equal(created.at(-1).parameters.get('ratio').value, 4 + .35 * 8);
  assert.equal(created.at(-1).parameters.get('knee').value, 18);
  assert.equal(created.at(-1).parameters.get('attack').value, .006);
  assert.equal(created.at(-1).parameters.get('release').value, .18);
  // 이미 만든 이펙트는 바뀌지 않는다
  assert.equal(legacyEffect.engineVersion, 1);
  newEffect.dispose(); legacyEffect.dispose();

  setFeatureFlagOverride('newCompressor', false);
  assert.equal(new CompressorEffect(context, pedal).engineVersion, 1, '덮어써서 끄면 옛 경로');
  resetFeatureFlagOverrides();
  assert.equal(new CompressorEffect(context, pedal).engineVersion, 1, '덮어쓰기를 지우면 기본값(꺼짐)');
  delete globalThis.AudioWorkletNode;
}

console.log('새 컴프레서 경로 시험 통과: 플래그 읽기·기본값, 새 워클릿(RMS 검출·메이크업 없음·30 Hz 보고·옛 경로와의 차이), CompressorEffect 의 플래그 전달');
