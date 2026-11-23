// 하울링 가드·레벨 미터(S1.5, 설계서 4.3 · 부록 B · 결정 D9) 시험.
//   1. 판정 수치(guardSpec.ts)가 부록 B 와 같다 — 승인 없이 바뀌는 것을 막는다.
//   2. HowlSpectrum: FFT 가 정의대로 맞고, 주파수 풀이가 센트 단위로 정확하다.
//   3. HowlDetector: 실제 시험 신호(signals.ts H-1~H-4, G-1~G-3)를 44.1/48 kHz 로 흘려 부록 B 기대값을 확인한다.
//      L-44 보강(새 음 재시작·기준 음 붙들기·기울기 앞 프레임 제외)이 왜 필요한지 '글자 그대로' 판정과 비교해 기록한다.
//   4. level-meter / output-guard 워클릿: 실제 파일을 esbuild 로 묶어 오디오 스레드를 흉내 낸 vm 에서 돌린다.
//   5. levelReading / MonitorService / monitorStore: 화면·세션 쪽 순수 계산과 메시지 처리.
//   6. 소스 단언: 워클릿이 화면·시계 API 에 기대지 않는다(C1), 옛 문자열 워클릿이 없다, 엔진 배선.
// 소리가 실제로 어떻게 나는지(렌더 결과)는 오디오 렌더 프로브 P-07/P-17 이 잰다. 실기기 하울링은 사람이 확인한다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = (relative) => readFileSync(root(relative), 'utf8');
/** vm 안에서 만든 객체는 프로토타입이 달라 deepStrictEqual 이 거절한다. JSON 으로 바깥 영역의 평범한 값으로 바꾼다. */
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: 기대 ${expected} ± ${tolerance}, 실제 ${actual}`);

// ---------------------------------------------------------------------------------------------
// 불러오기
// ---------------------------------------------------------------------------------------------
async function loadModule(entry) {
  const bundle = await build({ entryPoints: [root(entry)], bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

const spec = await loadModule('src/audio/engine/guardSpec.ts');
const { HowlSpectrum, HowlDetector } = await loadModule('src/audio/monitor/howlDetector.ts');
const signals = await loadModule('src/audio/testing/signals.ts');

const monitorBundle = await build({
  stdin: {
    contents: `
      export * from './audio/monitor/levelReading.ts';
      export { MonitorService } from './audio/monitor/MonitorService.ts';
      export { useMonitorStore, monitorSink, readInputLevel, readOutputLevel } from './store/monitorStore.ts';
    `,
    resolveDir: root('src'),
    sourcefile: 'monitor-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const monitor = await import(`data:text/javascript;base64,${Buffer.from(monitorBundle.outputFiles[0].text).toString('base64')}`);

async function compileWorklet(entry) {
  const compiled = await build({ entryPoints: [root(entry)], bundle: true, format: 'iife', target: 'es2022', write: false });
  return compiled.outputFiles[0].text;
}
const levelMeterCode = await compileWorklet('src/audio/worklets/level-meter.worklet.ts');
const outputGuardCode = await compileWorklet('src/audio/worklets/output-guard.worklet.ts');

/** 오디오 스레드의 전역을 흉내 낸다. `state.currentFrame` 은 process 를 부른 뒤 테스트가 올려 준다. */
function loadProcessor(code, sampleRate) {
  const state = { currentFrame: 0 };
  const registered = [];
  let Processor;
  vm.runInNewContext(code, {
    sampleRate,
    get currentFrame() {
      return state.currentFrame;
    },
    AudioWorkletProcessor: class {
      constructor(options) {
        this.options = options;
        this.port = { messages: [], onmessage: null, postMessage: (message) => this.port.messages.push(message) };
      }
    },
    registerProcessor(name, klass) {
      registered.push(name);
      Processor = klass;
    },
  });
  return { Processor, registered, state };
}

// ---------------------------------------------------------------------------------------------
// 1. 판정 수치는 부록 B 그대로다(D9)
// ---------------------------------------------------------------------------------------------
{
  assert.equal(spec.HOWL_WINDOW_SAMPLES, 2048, '분석 창 2048 샘플');
  assert.equal(spec.HOWL_HOP_SAMPLES, 1024, '분석 간격 1024 샘플');
  assert.equal(spec.HOWL_LEVEL_FLOOR_DB, -50, '레벨 하한 −50 dBFS');
  assert.equal(spec.HOWL_TONAL_RATIO, 0.8, '톤 성분 비율 80%');
  assert.equal(spec.HOWL_TONAL_PEAK_COUNT, 8, '상위 8개 피크');
  assert.equal(spec.HOWL_TONAL_PEAK_HALF_WIDTH_BINS, 2, '피크마다 ±2 빈');
  assert.equal(spec.HOWL_BAND_LOW_HZ, 80);
  assert.equal(spec.HOWL_BAND_HIGH_HZ, 8000);
  assert.equal(spec.HOWL_PITCH_TOLERANCE_CENTS, 20, '음높이 ±20센트');
  assert.equal(spec.HOWL_HOLD_SECONDS, 1.0, '지속 1.0초');
  assert.equal(spec.HOWL_MIN_SLOPE_DB_PER_SECOND, -1.0, '기울기 ≥ −1.0 dB/s');
  assert.equal(spec.HOWL_MUTE_RAMP_SECONDS, 0.01, '무음 램프 10 ms');
  // 부록 B 에 없는 보강(L-44). 값이 바뀌면 이 시험이 알려 준다.
  assert.equal(spec.HOWL_ONSET_RISE_DB, 6);
  assert.equal(spec.HOWL_ONSET_LOOKBACK_FRAMES, 5);
  assert.equal(spec.HOWL_SLOPE_SKIP_FRAMES, 2);
  assert.equal(spec.HOWL_REFERENCE_HOLD_DB, 3);
  // 메시지·이름
  assert.equal(spec.LEVEL_METER_PROCESSOR_NAME, 'level-meter');
  assert.equal(spec.OUTPUT_GUARD_PROCESSOR_NAME, 'output-guard');
  assert.equal(spec.LEVEL_REPORT_HZ, 30);
  assert.equal(spec.LEVEL_SILENT_DB, -120);
  assert.equal(spec.LEVEL_CLIP_THRESHOLD, 0.99);
  assert.equal(spec.LIMITER_REPORT_SECONDS, 0.1);
}

// ---------------------------------------------------------------------------------------------
// 2. HowlSpectrum
// ---------------------------------------------------------------------------------------------
{
  const sampleRate = 48000;
  const spectrum = new HowlSpectrum(sampleRate);
  assert.equal(spectrum.size, 2048);
  near(spectrum.binHz, 23.4375, 1e-9, '빈 폭');
  assert.throws(() => new HowlSpectrum(sampleRate, 1000), /2 의 거듭제곱/);

  // FFT 가 정의(Hann 창 · 이산 푸리에 변환)와 같다.
  const frame = new Float32Array(2048);
  let seed = 1;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  for (let i = 0; i < frame.length; i += 1) frame[i] = random() + 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  spectrum.analyze(frame, null);
  const power = spectrum.lastPower;
  let worstRelative = 0;
  for (const bin of [0, 1, 3, 17, 42, 43, 100, 511, 1000, 1023, 1024]) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < frame.length; n += 1) {
      const windowed = frame[n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / 2048));
      const angle = (-2 * Math.PI * bin * n) / 2048;
      re += windowed * Math.cos(angle);
      im += windowed * Math.sin(angle);
    }
    const naive = re * re + im * im;
    worstRelative = Math.max(worstRelative, Math.abs(naive - power[bin]) / Math.max(naive, 1e-9));
  }
  assert.ok(worstRelative < 1e-9, `FFT 가 정의와 같다(최대 상대 오차 ${worstRelative})`);

  // 레벨·톤 비율
  const tone = new Float32Array(2048);
  for (let i = 0; i < tone.length; i += 1) tone[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate + 0.3);
  const pure = spectrum.analyze(tone, null);
  near(pure.levelDb, -23.0, 0.1, '진폭 0.1 사인의 RMS 는 −23 dBFS');
  near(pure.peakHz, 1000, 0.5, '1 kHz 사인의 최대 성분');
  assert.ok(pure.tonal > 0.99, `순음의 톤 비율 ${pure.tonal}`);

  for (let i = 0; i < frame.length; i += 1) frame[i] = random();
  const noise = spectrum.analyze(frame, null);
  assert.ok(noise.tonal < 0.5, `백색 잡음의 톤 비율은 낮다(${noise.tonal})`);

  frame.fill(0);
  const silence = spectrum.analyze(frame, null);
  assert.equal(silence.levelDb, spec.LEVEL_SILENT_DB, '무음은 −120 dB');
  assert.equal(silence.peakHz, 0);
  assert.equal(silence.tonal, 0);
}

// 대역 전체에서 주파수 풀이가 정확하다(센트).
for (const sampleRate of [44100, 48000]) {
  const spectrum = new HowlSpectrum(sampleRate);
  const frame = new Float32Array(2048);
  let worst = 0;
  let worstFrequency = 0;
  for (let frequency = 82; frequency < 7900; frequency *= 1.0173) {
    for (let i = 0; i < frame.length; i += 1) frame[i] = 0.1 * Math.sin((2 * Math.PI * frequency * i) / sampleRate + 0.37);
    const cents = Math.abs(1200 * Math.log2(spectrum.analyze(frame, null).peakHz / frequency));
    if (cents > worst) {
      worst = cents;
      worstFrequency = frequency;
    }
  }
  assert.ok(worst < 1.0, `${sampleRate} Hz: 주파수 풀이 최대 오차 ${worst.toFixed(3)}센트(${worstFrequency.toFixed(1)} Hz) — 판정 허용(20센트)보다 훨씬 작아야 한다`);
}

// ---------------------------------------------------------------------------------------------
// 3. HowlDetector — 실제 시험 신호
// ---------------------------------------------------------------------------------------------
/**
 * 신호를 128 샘플씩 흘려 넣는다. 앞에 `lead` 초 무음을 둔다(마이크가 열린 직후처럼).
 * 돌려주는 cutAt 은 신호가 시작한 때부터 잰 초다. 판정이 나면 거기서 멈춘다.
 */
function runDetector(sampleRate, source, { options, lead = 0.5, gain = 1, chunk = 128 } = {}) {
  const detector = new HowlDetector(sampleRate, options);
  const events = [];
  detector.onEvent = (event) => events.push(event);
  const leadSamples = Math.round(lead * sampleRate);
  const length = typeof source === 'function' ? Math.round(source.seconds * sampleRate) : source.length;
  const total = leadSamples + length;
  const block = new Float32Array(chunk);
  for (let start = 0; start < total; start += chunk) {
    const count = Math.min(chunk, total - start);
    for (let i = 0; i < count; i += 1) {
      const index = start + i - leadSamples;
      block[i] = index < 0 ? 0 : (typeof source === 'function' ? source(index / sampleRate) : source[index]) * gain;
    }
    detector.push(block, count);
    if (detector.hasTripped) break;
  }
  const cut = events.find((event) => event.type === 'cut');
  return {
    detector,
    events,
    cut,
    cutAt: cut ? cut.atSample / sampleRate - lead : null,
    cutSample: cut ? cut.atSample : null,
    suspects: events.filter((event) => event.type === 'suspect'),
  };
}
const generated = (seconds, fn) => Object.assign(fn, { seconds });
const sine = (frequency, amplitude) => (t) => amplitude * Math.sin(2 * Math.PI * frequency * t);

const H4_PARTIALS = [80, 200, 500, 1250, 3200];
// 설계서 시험 신호 매트릭스(부록 A). H-4 는 세기가 거의 같은 다섯 음이라 입력 +20 dB 에서 본다.
const matrix = [
  { name: 'H-1', make: signals.howl1, gain: 1, howl: true, frequencies: [1000] },
  { name: 'H-2', make: signals.howl2, gain: 1, howl: true, frequencies: [2500] },
  { name: 'H-3', make: signals.howl3, gain: 1, howl: true, frequencies: [800] },
  { name: 'H-4', make: signals.howl4, gain: 10, howl: true, frequencies: H4_PARTIALS },
  { name: 'G-1', make: signals.sustainLead, gain: 1, howl: false },
  { name: 'G-2', make: signals.strumming, gain: 1, howl: false },
  { name: 'G-3', make: signals.noiseFloor, gain: 1, howl: false },
];
const matrixResult = {};
for (const sampleRate of [44100, 48000]) {
  for (const row of matrix) {
    const samples = row.make(sampleRate);
    const result = runDetector(sampleRate, samples, { gain: row.gain });
    matrixResult[`${row.name}@${sampleRate}`] = result.cutAt;
    if (row.howl) {
      assert.ok(result.cut, `${row.name} @${sampleRate}: 하울링을 잡아야 한다`);
      assert.ok(result.cutAt >= spec.HOWL_HOLD_SECONDS - 1e-9, `${row.name}: 지속 시간(1.0초)보다 일찍 차단하지 않는다(${result.cutAt})`);
      assert.ok(result.cutAt <= 1.5, `${row.name} @${sampleRate}: 1.5초 안에 차단(${result.cutAt.toFixed(3)} 초)`);
      assert.ok(
        row.frequencies.some((frequency) => Math.abs(1200 * Math.log2(result.cut.freqHz / frequency)) < 20),
        `${row.name} @${sampleRate}: 차단 주파수 ${result.cut.freqHz.toFixed(1)} Hz 가 신호의 음과 맞다`,
      );
      assert.ok(result.suspects.length >= 3, `${row.name}: 판정 중 의심 소식이 0.25초마다 나간다(${result.suspects.length}번)`);
      assert.ok(result.suspects.every((suspect, index) => index === 0 || suspect.heldMs > result.suspects[index - 1].heldMs), `${row.name}: 의심 시간이 늘어난다`);
    } else {
      assert.equal(result.cut, undefined, `${row.name} @${sampleRate}: 60초 동안 오차단 0회(${result.cutAt} 초에 차단됨)`);
      assert.equal(result.detector.samplesPushed, Math.round(0.5 * sampleRate) + samples.length, `${row.name}: 끝까지 흘려 넣었다`);
    }
  }
}

// 입력을 어떻게 쪼개서 넣어도 판정 위치가 같다(hop 은 샘플 수로만 센다).
{
  const sampleRate = 48000;
  const baseline = runDetector(sampleRate, signals.howl1(sampleRate)).cutSample;
  for (const chunk of [1, 7, 100, 128, 1000, 4096]) {
    assert.equal(runDetector(sampleRate, signals.howl1(sampleRate), { chunk }).cutSample, baseline, `블록 ${chunk} 샘플로 넣어도 같은 위치에서 차단`);
  }
}

// reset: 판정이 서면 멈추고, reset 하면 처음부터 다시 판정한다.
{
  const sampleRate = 48000;
  const first = runDetector(sampleRate, signals.howl1(sampleRate));
  assert.ok(first.detector.hasTripped);
  first.detector.reset();
  assert.equal(first.detector.hasTripped, false);
  assert.equal(first.detector.runFrames, 0);
  assert.equal(first.detector.samplesPushed, 0);
  const events = [];
  first.detector.onEvent = (event) => events.push(event);
  const tone = signals.howl1(sampleRate);
  for (let start = 0; start < tone.length && !first.detector.hasTripped; start += 128) first.detector.push(tone.subarray(start, start + 128), 128);
  const again = events.find((event) => event.type === 'cut');
  assert.ok(again, 'reset 뒤에 다시 판정한다');
  assert.ok(again.atSample / sampleRate >= 1.0, 'reset 뒤에는 이전 입력 이력을 쓰지 않고 1.0초를 다시 센다');
}

// 판정 경계(부록 B 수치 하나씩)
for (const sampleRate of [44100, 48000]) {
  const label = `@${sampleRate}`;
  // 레벨 하한 −50 dBFS: −45 는 판정하고 −55 는 잡음으로 무시한다.
  assert.ok(runDetector(sampleRate, generated(4, sine(1000, 0.00795))).cut, `레벨 −45 dBFS 의 꾸준한 음은 판정 ${label}`);
  assert.equal(runDetector(sampleRate, generated(4, sine(1000, 0.0025))).cut, undefined, `레벨 −55 dBFS 는 하한 아래라 무시 ${label}`);
  // 기울기: 줄지 않는 음(−0.5 dB/s)은 판정하고, 줄어드는 음(−1.5, −3 dB/s)은 기타 줄로 본다.
  const decaying = (rate) => generated(4, (t) => 0.2 * 10 ** ((-rate * t) / 20) * Math.sin(2 * Math.PI * 440 * t));
  assert.ok(runDetector(sampleRate, decaying(0.5)).cut, `−0.5 dB/s 로 줄어드는 음은 사실상 줄지 않는다 ${label}`);
  assert.equal(runDetector(sampleRate, decaying(1.5)).cut, undefined, `−1.5 dB/s 로 줄어드는 음은 기타 줄 ${label}`);
  assert.equal(runDetector(sampleRate, decaying(3)).cut, undefined, `−3 dB/s 로 줄어드는 음은 기타 줄 ${label}`);
  // 음높이 안정: 0.5초마다 음이 바뀌면 후보가 끊긴다. 계속 오르내리는 음도 마찬가지다.
  assert.equal(
    runDetector(sampleRate, generated(6, (t) => 0.2 * Math.sin(2 * Math.PI * (Math.floor(t / 0.5) % 2 ? 1100 : 1000) * t))).cut,
    undefined,
    `0.5초마다 바뀌는 음은 판정하지 않는다 ${label}`,
  );
  assert.equal(
    runDetector(sampleRate, generated(4, (t) => 0.2 * Math.sin(2 * Math.PI * (500 * t + 62.5 * t * t)))).cut,
    undefined,
    `4초 동안 한 옥타브 오르는 음은 음높이가 안정적이지 않다 ${label}`,
  );
  // 톤 비율: 넓은 대역 잡음은 판정하지 않는다.
  let seed = 11;
  const noise = generated(6, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.7);
  assert.equal(runDetector(sampleRate, noise).cut, undefined, `−14 dBFS 잡음은 톤이 아니다 ${label}`);
}

// L-44: 부록 B 를 글자 그대로 구현하면 어떻게 되는지. 보강이 필요했던 근거를 시험으로 남긴다.
{
  const literal = { onsetRestart: false, holdReference: false, skipLeadFrames: false };
  const g1 = signals.sustainLead(48000);
  const falseCut = runDetector(48000, g1, { options: literal });
  assert.ok(falseCut.cut, '글자 그대로의 판정은 48 kHz G-1(줄어드는 리드)을 하울링으로 오판한다 — L-44');
  assert.ok(falseCut.cutAt > 3, `오판은 새 음이 시작한 뒤에 난다(${falseCut.cutAt.toFixed(2)} 초)`);
  assert.equal(runDetector(48000, g1).cut, undefined, 'L-44 보강을 하면 같은 신호에서 오차단이 없다');

  const h4 = signals.howl4(48000);
  assert.equal(runDetector(48000, h4, { options: literal, gain: 10 }).cut, undefined, '글자 그대로의 판정은 48 kHz H-4(세기가 비슷한 다섯 음)를 놓친다 — L-44');
  assert.ok(runDetector(48000, h4, { gain: 10 }).cut, 'L-44 보강을 하면 같은 신호를 잡는다');

  // 보강 셋이 각각 어느 신호 때문에 필요한지(하나씩 끄면 그 신호가 어긋난다). 어느 보강도 다른 보강의 몫을 대신하지 않는다.
  const without = (flag) => ({ onsetRestart: true, holdReference: true, skipLeadFrames: true, [flag]: false });
  assert.ok(runDetector(48000, g1, { options: without('onsetRestart') }).cut, '① 새 음 재시작이 없으면 48 kHz G-1 을 오차단한다');
  assert.equal(runDetector(48000, g1, { options: without('holdReference') }).cut, undefined, '③ 기준 음 붙들기는 G-1 의 몫이 아니다');
  assert.equal(runDetector(48000, g1, { options: without('skipLeadFrames') }).cut, undefined, '② 앞 프레임 제외는 G-1 의 몫이 아니다');
  assert.equal(runDetector(48000, h4, { options: without('holdReference'), gain: 10 }).cut, undefined, '③ 기준 음 붙들기가 없으면 48 kHz H-4 를 놓친다');
  assert.ok(runDetector(48000, h4, { options: without('onsetRestart'), gain: 10 }).cut, '① 새 음 재시작은 H-4 의 몫이 아니다');
  assert.ok(runDetector(48000, h4, { options: without('skipLeadFrames'), gain: 10 }).cut, '② 앞 프레임 제외는 H-4 의 몫이 아니다');
  // ② 앞 프레임 제외: 소리가 막 시작한 프레임은 분석 창이 덜 차 레벨이 낮게 나와 기울기를 위로 끌어올린다.
  // 기준(−1.0 dB/s) 바로 밖인 −1.1 dB/s 로 줄어드는 음이 그 때문에 하울링으로 읽힌다(−1.2 dB/s 부터는 둘 다 기타 줄로 본다).
  for (const sampleRate of [44100, 48000]) {
    const slowDecay = generated(3, (t) => 0.1 * 10 ** ((-1.1 * t) / 20) * Math.sin(2 * Math.PI * 1000 * t));
    assert.equal(runDetector(sampleRate, slowDecay).cut, undefined, `−1.1 dB/s 로 줄어드는 음은 기타 줄 @${sampleRate}`);
    assert.ok(runDetector(sampleRate, slowDecay, { options: without('skipLeadFrames') }).cut, `② 앞 프레임 제외가 없으면 −1.1 dB/s 감쇠음을 하울링으로 오판한다 @${sampleRate}`);
  }
}

// 새로 친 음이 끼면 처음부터 다시 센다 — 1.5초마다 새로 치고 −6 dB/s 로 줄어드는 음은 하울링이 아니다.
{
  const sampleRate = 48000;
  const repicked = generated(6, (t) => {
    const phase = t % 1.5;
    const level = 0.3 * 10 ** ((-6 * phase) / 20);
    return level * Math.sin(2 * Math.PI * 330 * t);
  });
  assert.equal(runDetector(sampleRate, repicked).cut, undefined, '1.5초마다 새로 치는 줄어드는 음은 판정하지 않는다');
}

// ---------------------------------------------------------------------------------------------
// 4-a. level-meter 워클릿
// ---------------------------------------------------------------------------------------------
const QUANTUM = 128;
const filled = (value, length = QUANTUM) => new Float32Array(length).fill(value);
const dbOf = (value) => 20 * Math.log10(value);

{
  const { registered } = loadProcessor(levelMeterCode, 48000);
  assert.deepEqual(plain(registered), ['level-meter'], '워클릿은 level-meter 하나만 등록한다');
  const loaded = loadProcessor(levelMeterCode, 48000);

  // 통과: 소리는 한 샘플도 바뀌지 않는다.
  {
    const node = new loaded.Processor({ processorOptions: { tap: 'in' } });
    const left = Float32Array.from({ length: QUANTUM }, (_, i) => Math.sin(i / 7) * 0.4);
    const right = Float32Array.from({ length: QUANTUM }, (_, i) => Math.cos(i / 5) * 0.3);
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    assert.equal(node.process([[left, right]], [out]), true, 'process 는 true 를 돌려 노드를 살려 둔다');
    assert.deepEqual(Array.from(out[0]), Array.from(left), '왼쪽 통과');
    assert.deepEqual(Array.from(out[1]), Array.from(right), '오른쪽 통과');
    // 모노 입력 → 모노 출력
    const mono = [new Float32Array(QUANTUM)];
    node.process([[left]], [mono]);
    assert.deepEqual(Array.from(mono[0]), Array.from(left), '모노 통과');
    // 출력이 두 채널이고 입력이 한 채널이면 같은 소리를 둘 다에 낸다
    const upmixed = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    node.process([[left]], [upmixed]);
    assert.deepEqual(Array.from(upmixed[1]), Array.from(left));
    // 연결이 없으면 무음
    const silent = [filled(1), filled(1)];
    node.process([[]], [silent]);
    assert.ok(silent.every((channel) => channel.every((sample) => sample === 0)), '입력이 없으면 출력은 무음이다');
  }

  // 간격: 약 30 Hz, 렌더 양자 단위
  for (const [sampleRate, expectedSpacing] of [
    [48000, 13 * QUANTUM],
    [44100, 12 * QUANTUM],
  ]) {
    const meter = loadProcessor(levelMeterCode, sampleRate);
    const node = new meter.Processor({ processorOptions: { tap: 'in' } });
    const input = [filled(0.1), filled(0.1)];
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    const quanta = Math.round((3 * sampleRate) / QUANTUM);
    for (let q = 0; q < quanta; q += 1) {
      node.process([input], [out]);
      meter.state.currentFrame += QUANTUM;
    }
    const frames = node.port.messages.map((message) => message.frame);
    const perSecond = frames.length / 3;
    assert.ok(perSecond >= 25 && perSecond <= 31, `${sampleRate} Hz: 초당 보고 ${perSecond.toFixed(1)}번(약 30 Hz)`);
    assert.ok(frames.every((frame, index) => index === 0 || frame - frames[index - 1] === expectedSpacing), `${sampleRate} Hz: 보고 간격이 ${expectedSpacing} 샘플로 일정하다`);
    assert.equal(frames[0], expectedSpacing, '첫 보고의 frame 은 그 양자가 끝난 오디오 시계다');
  }

  // 값: 채널별 피크·RMS(dBFS), 보고마다 처음부터 센다
  {
    const meter = loadProcessor(levelMeterCode, 48000);
    const node = new meter.Processor({ processorOptions: { tap: 'in' } });
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    const input = [filled(0.25), new Float32Array(QUANTUM)]; // 왼쪽 DC 0.25, 오른쪽 무음
    for (let q = 0; q < 13; q += 1) {
      node.process([input], [out]);
      meter.state.currentFrame += QUANTUM;
    }
    const first = plain(node.port.messages[0]);
    assert.equal(first.type, 'level');
    assert.equal(first.tap, 'in');
    assert.equal(first.peakDb.length, 2);
    near(first.peakDb[0], dbOf(0.25), 1e-9, '왼쪽 피크');
    near(first.rmsDb[0], dbOf(0.25), 1e-9, '왼쪽 RMS');
    assert.equal(first.peakDb[1], spec.LEVEL_SILENT_DB, '무음은 −120 dB(−Infinity 를 보내지 않는다)');
    assert.equal(first.rmsDb[1], spec.LEVEL_SILENT_DB);
    assert.equal(first.clipped, false);
    // 다음 보고는 이전 값을 끌고 가지 않는다
    const quiet = [filled(0.01), filled(0.01)];
    for (let q = 0; q < 13; q += 1) {
      node.process([quiet], [out]);
      meter.state.currentFrame += QUANTUM;
    }
    const second = plain(node.port.messages[1]);
    near(second.peakDb[0], dbOf(0.01), 1e-6, '피크도 보고마다 새로 센다(float32 로 저장된 0.01)');
    near(second.rmsDb[1], dbOf(0.01), 1e-6);
    assert.equal(second.frame, 26 * QUANTUM);
  }

  // 사인파의 RMS 는 진폭/√2
  {
    const meter = loadProcessor(levelMeterCode, 48000);
    const node = new meter.Processor({ processorOptions: { tap: 'in' } });
    const out = [new Float32Array(QUANTUM)];
    let index = 0;
    for (let q = 0; q < 13; q += 1) {
      const block = Float32Array.from({ length: QUANTUM }, () => 0.5 * Math.sin((2 * Math.PI * 997 * index++) / 48000));
      node.process([[block]], [out]);
      meter.state.currentFrame += QUANTUM;
    }
    const report = plain(node.port.messages[0]);
    assert.equal(report.rmsDb.length, 1, '모노 입력은 한 채널을 보고한다');
    near(report.rmsDb[0], dbOf(0.5 / Math.SQRT2), 0.15, '사인 RMS');
    near(report.peakDb[0], dbOf(0.5), 0.05, '사인 피크');
  }

  // 클립: 0.99 이상이 한 번이라도 있으면 그 보고 구간이 클립이다. 다음 구간에는 이어지지 않는다.
  {
    const meter = loadProcessor(levelMeterCode, 48000);
    const node = new meter.Processor({ processorOptions: { tap: 'out' } });
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    const loud = filled(0.2);
    loud[40] = -0.995;
    node.process([[loud, filled(0.2)]], [out]);
    meter.state.currentFrame += QUANTUM;
    for (let q = 1; q < 13; q += 1) {
      node.process([[filled(0.2), filled(0.2)]], [out]);
      meter.state.currentFrame += QUANTUM;
    }
    for (let q = 0; q < 13; q += 1) {
      node.process([[filled(0.2), filled(0.2)]], [out]);
      meter.state.currentFrame += QUANTUM;
    }
    const [clipped, clean] = node.port.messages.map(plain);
    assert.equal(clipped.tap, 'out', 'processorOptions.tap 이 out 이면 출력 미터다');
    assert.equal(clipped.clipped, true, '0.99 이상의 샘플이 있으면 클립');
    near(clipped.peakDb[0], dbOf(0.995), 1e-4, '클립 피크');
    assert.equal(clean.clipped, false, '클립 표시는 다음 보고로 넘어가지 않는다');
  }

  // 옵션: 알 수 없는 tap 은 in, 옵션이 없어도 만들어진다
  for (const options of [undefined, {}, { processorOptions: {} }, { processorOptions: { tap: 'bogus' } }]) {
    const meter = loadProcessor(levelMeterCode, 48000);
    const node = new meter.Processor(options);
    for (let q = 0; q < 13; q += 1) node.process([[filled(0.1)]], [[new Float32Array(QUANTUM)]]);
    assert.equal(node.port.messages[0].tap, 'in', 'tap 을 모르면 입력 미터로 본다');
  }

  // 채널 수: 앞의 둘만 잰다. 연결이 없으면 무음 한 채널.
  {
    const meter = loadProcessor(levelMeterCode, 48000);
    const node = new meter.Processor({ processorOptions: { tap: 'in' } });
    const four = [filled(0.1), filled(0.2), filled(0.9), filled(0.9)];
    const out = four.map(() => new Float32Array(QUANTUM));
    for (let q = 0; q < 13; q += 1) node.process([four], [out]);
    assert.equal(node.port.messages[0].peakDb.length, 2, '4채널 입력도 앞의 둘만 보고한다');
    assert.equal(out[3][0], Math.fround(0.9), '그래도 소리는 채널을 모두 통과시킨다');
    const lone = loadProcessor(levelMeterCode, 48000);
    const unplugged = new lone.Processor({ processorOptions: { tap: 'in' } });
    for (let q = 0; q < 13; q += 1) unplugged.process([[]], [[new Float32Array(QUANTUM)]]);
    const report = plain(unplugged.port.messages[0]);
    assert.deepEqual(report.rmsDb, [spec.LEVEL_SILENT_DB], '연결이 없으면 무음 한 채널');
  }
}

// ---------------------------------------------------------------------------------------------
// 4-b. output-guard 워클릿
// ---------------------------------------------------------------------------------------------
function createGuard(processorOptions, sampleRate = 48000) {
  const loaded = loadProcessor(outputGuardCode, sampleRate);
  const node = new loaded.Processor(processorOptions === undefined ? undefined : { processorOptions });
  return { node, state: loaded.state, sampleRate, registered: loaded.registered };
}
const send = (guard, command) => guard.node.port.onmessage({ data: command });
/** 렌더 양자(128)의 배수로 맞춘 샘플 수. 마지막 양자가 모자라 NaN 이 섞이는 것을 막는다. */
const samplesFor = (sampleRate, seconds) => Math.ceil((sampleRate * seconds) / QUANTUM) * QUANTUM;
const tone = (sampleRate, frequency, amplitude, seconds) =>
  Float32Array.from({ length: samplesFor(sampleRate, seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));

/**
 * 가드를 128 샘플씩 `length`(128 의 배수) 샘플만큼 돌린다. program/analysis 는 채널 배열의 배열(없으면 빈 입력)이고
 * `from` 샘플 위치부터 읽는다. 돌려주는 left/right 는 이어 붙인 출력이다.
 */
function runGuard(guard, length, { program = [], analysis = [], from = 0 } = {}) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let start = 0; start < length; start += QUANTUM) {
    const slice = (channels) => channels.map((channel) => channel.subarray(from + start, from + start + QUANTUM));
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    guard.node.process([slice(program), slice(analysis)], [out]);
    left.set(out[0], start);
    right.set(out[1], start);
    guard.state.currentFrame += QUANTUM;
  }
  return { left, right };
}
const messagesOf = (guard, type) => plain(guard.node.port.messages).filter((message) => message.type === type);

{
  const guard = createGuard({ mode: 'device' });
  assert.deepEqual(plain(guard.registered), ['output-guard'], '워클릿은 output-guard 하나만 등록한다');
}

// 하울링을 잡으면: 10 ms 램프로 무음 → 완료 뒤에 howl-cut → reset 전까지 무음
for (const sampleRate of [48000, 44100]) {
  const rampFrames = Math.round(sampleRate * 0.01);
  const guard = createGuard({ mode: 'device' }, sampleRate);
  const length = samplesFor(sampleRate, 2.5);
  const analysis = tone(sampleRate, 1000, 0.1414, 2.5); // −20 dBFS RMS
  const program = new Float32Array(length).fill(0.5);
  const { left, right } = runGuard(guard, length, { program: [program, program], analysis: [analysis, analysis] });

  const cuts = messagesOf(guard, 'howl-cut');
  assert.equal(cuts.length, 1, `${sampleRate} Hz: howl-cut 은 한 번만 간다`);
  near(cuts[0].freqHz, 1000, 5, '차단 주파수');
  const suspects = messagesOf(guard, 'howl-suspect');
  assert.ok(suspects.length >= 3, `${sampleRate} Hz: 판정 중 의심 소식(${suspects.length}번)`);
  assert.ok(suspects.every((message) => Math.abs(message.freqHz - 1000) < 5), '의심 주파수');
  assert.ok(suspects.every((message, index) => index === 0 || (message.heldMs > suspects[index - 1].heldMs && message.frame > suspects[index - 1].frame)), '의심 소식은 시간 순서다');
  const kinds = plain(guard.node.port.messages).map((message) => message.type);
  assert.equal(kinds.at(-1), 'howl-cut', 'howl-cut 이 마지막 메시지다');

  const rampStart = left.findIndex((sample) => sample !== Math.fround(0.5));
  assert.ok(rampStart > 0, '램프가 시작한다');
  assert.equal(rampStart % QUANTUM, 0, '램프는 판정이 난 양자의 첫 샘플부터 시작한다(판정 → 무음 사이에 양자를 더 건너뛰지 않는다)');
  const firstZero = left.findIndex((sample, index) => index > rampStart && sample === 0);
  assert.ok(Math.abs(firstZero - rampStart - rampFrames) <= 2, `${sampleRate} Hz: 램프 길이 ${firstZero - rampStart} 샘플(10 ms = ${rampFrames})`);
  assert.ok(rampStart / sampleRate >= 1.0 && rampStart / sampleRate <= 1.1, `차단 시작 ${(rampStart / sampleRate).toFixed(3)} 초(하울링이 시작한 뒤 1.0~1.1초)`);
  for (let i = rampStart + 1; i <= firstZero; i += 1) assert.ok(left[i] <= left[i - 1], '램프는 단조롭게 내려간다');
  assert.equal(left[rampStart], Math.fround(0.5 * (1 - 1 / rampFrames)), '첫 램프 샘플은 한 걸음 내려간 값이다');
  for (let i = firstZero; i < length; i += 1) assert.ok(left[i] === 0 && right[i] === 0, `무음 유지(샘플 ${i})`);
  assert.equal(cuts[0].frame, (Math.floor(firstZero / QUANTUM) + 1) * QUANTUM, 'howl-cut 의 frame 은 무음이 끝난 양자의 끝 오디오 시계다');
  assert.ok(cuts[0].frame - rampStart >= rampFrames, 'howl-cut 은 무음 처리가 끝난 뒤에 간다');
}

// 분석 입력은 소리에 섞이지 않는다(프로그램이 무음이면 출력도 무음)
{
  const guard = createGuard({ mode: 'device' });
  const length = samplesFor(48000, 2);
  const analysis = tone(48000, 1000, 0.3, 2);
  const { left, right } = runGuard(guard, length, { analysis: [analysis, analysis] });
  assert.ok(left.every((sample) => sample === 0) && right.every((sample) => sample === 0), '분석 입력은 출력에 나오지 않는다');
  assert.equal(messagesOf(guard, 'howl-cut').length, 1, '프로그램이 없어도 입력 쪽 판정은 돈다');
}

// reset: 무음이 풀리고 판정이 처음부터 다시 시작한다
{
  const guard = createGuard({ mode: 'device' });
  const length = samplesFor(48000, 2);
  const analysis = tone(48000, 1000, 0.1414, 2);
  const program = new Float32Array(length).fill(0.5);
  runGuard(guard, length, { program: [program], analysis: [analysis] });
  assert.equal(messagesOf(guard, 'howl-cut').length, 1);

  send(guard, { type: 'reset' });
  const after = runGuard(guard, length, { program: [program], analysis: [analysis] });
  assert.equal(after.left[0], Math.fround(0.5), 'reset 뒤 첫 샘플부터 소리가 나온다');
  assert.equal(after.right[0], Math.fround(0.5), '모노 프로그램은 두 채널에 같은 소리를 낸다');
  const cuts = messagesOf(guard, 'howl-cut');
  assert.equal(cuts.length, 2, 'reset 뒤에는 다시 판정해 howl-cut 을 다시 보낸다');
  const secondStart = after.left.findIndex((sample) => sample !== Math.fround(0.5));
  assert.ok(secondStart / 48000 >= 1.0, `reset 뒤에도 1.0초를 다시 센다(${(secondStart / 48000).toFixed(3)} 초)`);
}

// 모드: device 만 판정한다. file·off·옵션 없음은 5초 동안 한 음이 이어져도 절대 자르지 않는다. 리미터는 별개다.
for (const [label, options] of [
  ['옵션 없음', undefined],
  ['빈 옵션', {}],
  ['mode: file', { mode: 'file' }],
  ['mode: off', { mode: 'off' }],
  ['mode: 알 수 없음', { mode: 'bogus' }],
]) {
  const guard = createGuard(options);
  const length = samplesFor(48000, 5);
  const analysis = tone(48000, 1000, 0.3, 5);
  const program = tone(48000, 440, 0.4, 5);
  const { left } = runGuard(guard, length, { program: [program, program], analysis: [analysis, analysis] });
  assert.equal(guard.node.port.messages.length, 0, `${label}: 메시지가 없다`);
  assert.deepEqual(Array.from(left.subarray(0, 4096)), Array.from(program.subarray(0, 4096)), `${label}: 소리를 그대로 통과시킨다`);
  assert.deepEqual(Array.from(left.subarray(length - 4096)), Array.from(program.subarray(length - 4096)), `${label}: 끝까지 그대로다`);
}

// arm 명령: 켜고 끄기. 다시 켤 때 이전 입력 이력을 비운다.
{
  const guard = createGuard({ mode: 'off' });
  const analysis = tone(48000, 1000, 0.1414, 6);
  let cursor = 0; // 신호의 위상이 이어지도록 앞에서 쓴 만큼 건너뛴다
  const run = (seconds) => {
    const count = samplesFor(48000, seconds);
    runGuard(guard, count, { analysis: [analysis, analysis], from: cursor });
    cursor += count;
  };
  send(guard, { type: 'arm', mode: 'device' });
  run(0.6);
  assert.equal(messagesOf(guard, 'howl-cut').length, 0, '0.6초로는 판정하지 않는다');
  send(guard, { type: 'arm', mode: 'file' });
  run(0.2);
  send(guard, { type: 'arm', mode: 'device' });
  run(0.6);
  assert.equal(messagesOf(guard, 'howl-cut').length, 0, '꺼졌다 다시 켜지면 이력을 비운다(0.6 + 0.6 = 1.2초로 오판하지 않는다)');
  run(0.6);
  assert.equal(messagesOf(guard, 'howl-cut').length, 1, '다시 켠 뒤 1.0초가 지나면 판정한다');
  // 이미 무음이면 모드를 바꿔도 reset 전까지 풀리지 않는다
  send(guard, { type: 'arm', mode: 'file' });
  const silent = runGuard(guard, QUANTUM * 4, { program: [filled(0.5, QUANTUM * 4)], analysis: [] });
  assert.ok(silent.left.every((sample) => sample === 0), 'arm 은 무음을 풀지 않는다(reset 만 푼다)');
}

// 모노 섞기: 분석 입력의 두 채널을 평균한다
{
  const rate = 48000;
  const seconds = 2;
  const length = samplesFor(rate, seconds);
  const wave = tone(rate, 1000, 0.2, seconds);
  const inverted = wave.map((sample) => -sample);
  const none = new Float32Array(length);
  const cases = [
    ['왼쪽만', [wave, none], true],
    ['오른쪽만', [none, wave], true],
    ['한 채널 입력', [wave], true],
    ['연결 없음', [], false],
    ['역상 두 채널(평균이 0)', [wave, inverted], false],
  ];
  for (const [label, analysis, expectCut] of cases) {
    const guard = createGuard({ mode: 'device' });
    runGuard(guard, length, { analysis });
    assert.equal(messagesOf(guard, 'howl-cut').length, expectCut ? 1 : 0, `분석 입력 ${label}: ${expectCut ? '판정' : '판정 없음'}`);
  }
}

// 프로그램 입력: 없으면 무음, 모노는 양쪽에
{
  const guard = createGuard({ mode: 'file' });
  const out = [filled(1), filled(1)];
  guard.node.process([[], []], [out]);
  assert.ok(out.every((channel) => channel.every((sample) => sample === 0)), '프로그램이 연결되지 않았으면 무음');
  const source = Float32Array.from({ length: QUANTUM }, (_, i) => Math.sin(i / 3) * 0.5);
  const monoOut = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  guard.node.process([[source], []], [monoOut]);
  assert.deepEqual(Array.from(monoOut[0]), Array.from(source));
  assert.deepEqual(Array.from(monoOut[1]), Array.from(source), '모노 프로그램은 두 출력 채널에 같다');
  const stereoOut = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  const rightSource = source.map((sample) => sample * 0.5);
  guard.node.process([[source, rightSource], []], [stereoOut]);
  assert.deepEqual(Array.from(stereoOut[1]), Array.from(rightSource), '스테레오는 채널을 섞지 않는다');
}

// 잘못된 명령은 무시한다
{
  const guard = createGuard({ mode: 'device' });
  for (const bad of [undefined, null, {}, { type: 'bogus' }]) assert.doesNotThrow(() => guard.node.port.onmessage({ data: bad }));
  assert.doesNotThrow(() => runGuard(guard, QUANTUM * 4, { analysis: [filled(0.1, QUANTUM * 4)] }));
}

// ---------------------------------------------------------------------------------------------
// 5. levelReading · MonitorService · monitorStore
// ---------------------------------------------------------------------------------------------
{
  const { applyLevel, toLevelReading, channelPair, SILENT_TAP, CLIP_CONSECUTIVE_REPORTS, CLIP_HOLD_MS } = monitor;
  assert.equal(CLIP_CONSECUTIVE_REPORTS, 3);
  assert.equal(CLIP_HOLD_MS, 1500);
  const level = (rmsDb, peakDb = rmsDb, frame = 1000) => ({ type: 'level', tap: 'in', rmsDb, peakDb, clipped: false, frame });

  // 선택한 채널
  const stereo = level([-30, -20], [-12, -6]);
  const all = applyLevel(SILENT_TAP, stereo, 'all', 0);
  assert.equal(all.rmsDb, -20, 'all 은 큰 쪽');
  assert.equal(all.peakDb, -6);
  assert.equal(all.channels, 2);
  assert.equal(all.frame, 1000);
  assert.equal(applyLevel(SILENT_TAP, stereo, 0, 0).rmsDb, -30, '채널 0 만');
  assert.equal(applyLevel(SILENT_TAP, stereo, 1, 0).rmsDb, -20, '채널 1 만');
  const missing = applyLevel(SILENT_TAP, level([-18]), 1, 0);
  assert.equal(missing.rmsDb, spec.LEVEL_SILENT_DB, '모노 소스에서 2번 채널을 고르면 무음이다');
  assert.equal(missing.channels, 1);

  // 클립: 3번 이어져야 붙든다
  const hot = level([-3], [0]);
  let tap = applyLevel(SILENT_TAP, hot, 'all', 100);
  tap = applyLevel(tap, hot, 'all', 133);
  assert.equal(tap.clipHoldUntil, 0, '2번으로는 아직 클리핑이 아니다');
  tap = applyLevel(tap, hot, 'all', 166);
  assert.equal(tap.consecutiveClipped, 3);
  assert.equal(tap.clipHoldUntil, 166 + CLIP_HOLD_MS, '3번 이어지면 1.5초 붙든다');
  const cool = applyLevel(tap, level([-20], [-10]), 'all', 200);
  assert.equal(cool.consecutiveClipped, 0, '한 번 끊기면 센 것을 비운다');
  assert.equal(cool.clipHoldUntil, 166 + CLIP_HOLD_MS, '붙든 시각은 그대로');
  assert.equal(toLevelReading(cool, 1000).isClipping, true, '붙든 동안 표시한다');
  assert.equal(toLevelReading(cool, 166 + CLIP_HOLD_MS).isClipping, false, '지나면 지운다');

  // 표시용 값
  const reading = toLevelReading({ ...SILENT_TAP, rmsDb: -20, peakDb: -6.0206 }, 0);
  near(reading.db, -20, 1e-9, 'db');
  near(reading.linear, 0.4, 1e-9, '막대 길이 = RMS × 4');
  near(reading.peakLinear, 0.5, 1e-3, '피크 길이');
  assert.equal(toLevelReading({ ...SILENT_TAP, rmsDb: -3, peakDb: 0 }, 0).linear, 1, '막대 길이는 1 에서 멈춘다');
  assert.equal(toLevelReading(SILENT_TAP, 0).isClipping, false);

  assert.deepEqual(channelPair([-12, -30]), [-12, -30]);
  assert.deepEqual(channelPair([-12]), [-12, spec.LEVEL_SILENT_DB], '모노는 2번이 무음');
  assert.deepEqual(channelPair([]), [spec.LEVEL_SILENT_DB, spec.LEVEL_SILENT_DB]);
}

{
  const { MonitorService } = monitor;
  const makeNode = () => ({ port: { onmessage: null, sent: [], closed: false, postMessage(message) { this.sent.push(message); }, close() { this.closed = true; } } });
  const makeSink = () => {
    const calls = [];
    const record = (name) => (...args) => calls.push([name, ...args]);
    return { calls, setInput: record('setInput'), setOutput: record('setOutput'), setLimiterGr: record('setLimiterGr'), setGuard: record('setGuard'), reset: record('reset') };
  };
  const callsOf = (sink, name) => sink.calls.filter((call) => call[0] === name).map((call) => call.slice(1));
  const deliver = (node, data) => node.port.onmessage({ data });
  const level = (tap, rmsDb, peakDb, frame) => ({ type: 'level', tap, rmsDb, peakDb, clipped: false, frame });

  const clock = { t: 5000 };
  const sink = makeSink();
  const service = new MonitorService(sink, () => clock.t);
  const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  const inputLevels = [];
  let selection = 'all';
  const cuts = [];
  service.attach(
    { ...nodes },
    { onInputLevels: (pair, seconds) => inputLevels.push([pair, seconds]), inputSelection: () => selection, onHowlCut: (freqHz) => cuts.push(freqHz) },
    48000,
  );
  for (const node of Object.values(nodes)) assert.equal(typeof node.port.onmessage, 'function', '네 노드 모두 수신기가 걸린다');

  // 입력 레벨 → sink + InputStage 훅(채널별 RMS, 오디오 시계 초)
  deliver(nodes.inputTap, level('in', [-30, -20], [-12, -6], 48000));
  assert.equal(callsOf(sink, 'setInput').length, 1);
  assert.equal(callsOf(sink, 'setInput')[0][0].rmsDb, -20);
  assert.deepEqual(plain(inputLevels[0]), [[-30, -20], 1], '훅에는 채널별 RMS 와 frame/sampleRate 초가 간다');
  selection = 0;
  deliver(nodes.inputTap, level('in', [-30, -20], [-12, -6], 96000));
  assert.equal(callsOf(sink, 'setInput')[1][0].rmsDb, -30, '선택한 채널이 바뀌면 다음 측정부터 따른다');
  assert.equal(inputLevels[1][1], 2);
  // 출력 레벨은 항상 모든 채널, 훅 없음
  deliver(nodes.outputTap, level('out', [-30, -20], [-12, -6], 48000));
  assert.equal(callsOf(sink, 'setOutput')[0][0].rmsDb, -20);
  assert.equal(inputLevels.length, 2, '출력 측정은 입력 훅을 부르지 않는다');
  // 메시지는 어느 노드에서 왔는지가 아니라 tap 필드로 가른다
  deliver(nodes.guard, level('out', [-40], [-30], 1));
  assert.equal(callsOf(sink, 'setOutput').length, 2);

  // 클립을 붙드는 시각은 서비스의 시계를 쓴다
  const hot = level('out', [-3], [0], 5);
  deliver(nodes.outputTap, hot);
  deliver(nodes.outputTap, hot);
  deliver(nodes.outputTap, hot);
  assert.equal(callsOf(sink, 'setOutput').at(-1)[0].clipHoldUntil, clock.t + 1500);

  // 하울링 의심·차단
  clock.t = 6000;
  deliver(nodes.guard, { type: 'howl-suspect', freqHz: 1000, heldMs: 500, frame: 100 });
  assert.deepEqual(plain(callsOf(sink, 'setGuard').at(-1)[0]), { suspect: { freqHz: 1000, heldMs: 500, at: 6000 } });
  deliver(nodes.guard, { type: 'howl-cut', freqHz: 1000, frame: 777 });
  assert.deepEqual(plain(callsOf(sink, 'setGuard').at(-1)[0]), { cut: { freqHz: 1000, frame: 777 } });
  assert.deepEqual(cuts, [1000], '차단 훅은 한 번 부른다');
  const guardCalls = callsOf(sink, 'setGuard').length;
  deliver(nodes.guard, { type: 'howl-cut', freqHz: 2000, frame: 999 });
  assert.deepEqual(cuts, [1000], '세션당 한 번만 — 두 번째 알림은 무시');
  assert.equal(callsOf(sink, 'setGuard').length, guardCalls, '두 번째 알림은 상태도 바꾸지 않는다');

  // 리미터 이득 감소
  deliver(nodes.limiter, { type: 'limiter', maxGrDb: 3.5, frame: 1 });
  deliver(nodes.limiter, { type: 'limiter', maxGrDb: -1, frame: 2 });
  assert.deepEqual(callsOf(sink, 'setLimiterGr'), [[3.5], [0]], '감소량은 0 이상으로 맞춘다');

  // 모양이 틀린 메시지는 무시
  const before = sink.calls.length;
  for (const bad of [
    null,
    undefined,
    7,
    'level',
    [],
    {},
    { type: 'bogus' },
    { type: 'level', tap: 'in', rmsDb: [], peakDb: [], frame: 1 },
    { type: 'level', tap: 'in', rmsDb: [Number.NaN], peakDb: [-10], frame: 1 },
    { type: 'level', tap: 'in', rmsDb: [-10], peakDb: [-10], frame: Number.NaN },
    { type: 'level', tap: 'in', rmsDb: '−10', peakDb: [-10], frame: 1 },
    { type: 'level', tap: 'sideways', rmsDb: [-10], peakDb: [-10], frame: 1 },
    { type: 'howl-suspect', freqHz: 'x', heldMs: 1 },
    { type: 'howl-cut', freqHz: Number.POSITIVE_INFINITY },
    { type: 'limiter', maxGrDb: Number.NaN },
  ]) {
    assert.doesNotThrow(() => deliver(nodes.guard, bad));
  }
  assert.equal(sink.calls.length, before, '잘못된 메시지는 아무것도 바꾸지 않는다');

  // 모드·reset 명령
  service.setGuardMode('device');
  assert.deepEqual(plain(nodes.guard.port.sent.at(-1)), { type: 'arm', mode: 'device' });
  assert.deepEqual(plain(callsOf(sink, 'setGuard').at(-1)[0]), { mode: 'device' });
  service.setGuardMode('file');
  assert.deepEqual(plain(nodes.guard.port.sent.at(-1)), { type: 'arm', mode: 'file' });
  service.resetGuard();
  assert.deepEqual(plain(nodes.guard.port.sent.at(-1)), { type: 'reset' });
  assert.deepEqual(plain(callsOf(sink, 'setGuard').at(-1)[0]), { suspect: null, cut: null }, 'reset 은 화면의 의심·차단 표시도 비운다');
  deliver(nodes.guard, { type: 'howl-cut', freqHz: 1500, frame: 5 });
  assert.deepEqual(cuts, [1000, 1500], 'reset 뒤의 새 세션에서는 차단을 다시 알린다');

  // 떼기: 포트를 닫고 화면 값을 비운다
  service.detach();
  for (const node of Object.values(nodes)) {
    assert.equal(node.port.onmessage, null, '수신기를 뗀다');
    assert.equal(node.port.closed, true, '포트를 닫는다');
  }
  assert.equal(callsOf(sink, 'reset').length, 1, '화면 값을 한 번 비운다');
  service.detach();
  assert.equal(callsOf(sink, 'reset').length, 1, '떼고 또 떼도 다시 비우지 않는다');
  assert.doesNotThrow(() => service.setGuardMode('device'), '붙은 노드가 없어도 모드 지시는 던지지 않는다');
  assert.doesNotThrow(() => service.resetGuard());
  assert.doesNotThrow(() => service.handleMessage(level('in', [-20], [-10], 1)), '떼어진 뒤 늦게 온 메시지도 던지지 않는다');

  // 다시 붙이면 먼저 뗀다. 가드가 없는 구성(널 노드)도 된다.
  const second = new MonitorService(makeSink(), () => 0);
  const a = makeNode();
  const b = makeNode();
  second.attach({ inputTap: a, guard: null, outputTap: null, limiter: undefined }, {}, 0);
  assert.equal(typeof a.port.onmessage, 'function');
  second.attach({ inputTap: b }, {}, 44100);
  assert.equal(a.port.closed, true, '다시 붙이면 먼저 붙은 노드를 뗀다');
  assert.equal(typeof b.port.onmessage, 'function');
  assert.doesNotThrow(() => second.setGuardMode('device'));
}

{
  const { useMonitorStore, monitorSink, readInputLevel, readOutputLevel, SILENT_TAP } = monitor;
  const state = () => useMonitorStore.getState();
  assert.equal(state().input, SILENT_TAP);
  assert.equal(state().output, SILENT_TAP);
  assert.equal(state().limiterGrDb, 0);
  assert.deepEqual(plain(state().guard), { mode: 'off', suspect: null, cut: null });

  monitorSink.setInput({ ...SILENT_TAP, rmsDb: -20, peakDb: -6.0206, channels: 2, frame: 10 });
  monitorSink.setOutput({ ...SILENT_TAP, rmsDb: -10, peakDb: -3, channels: 2, frame: 11 });
  monitorSink.setLimiterGr(2.5);
  monitorSink.setGuard({ mode: 'device' });
  monitorSink.setGuard({ suspect: { freqHz: 1000, heldMs: 250, at: 1 } });
  assert.deepEqual(plain(state().guard), { mode: 'device', suspect: { freqHz: 1000, heldMs: 250, at: 1 }, cut: null }, '가드 상태는 조각을 합친다');
  near(readInputLevel(0).linear, 0.4, 1e-9, '입력 읽기');
  near(readOutputLevel(0).db, -10, 1e-9, '출력 읽기');
  assert.equal(state().limiterGrDb, 2.5);

  monitorSink.reset();
  assert.equal(state().input, SILENT_TAP);
  assert.equal(state().limiterGrDb, 0);
  assert.deepEqual(plain(state().guard), { mode: 'off', suspect: null, cut: null });
  assert.equal(readInputLevel(0).db, spec.LEVEL_SILENT_DB, '세션이 끝나면 미터는 무음이다');
}

// ---------------------------------------------------------------------------------------------
// 6. 소스 단언
// ---------------------------------------------------------------------------------------------
{
  assert.equal(existsSync(root('src/audio/worklets/howl-guard-processor.ts')), false, '문자열로 들고 있던 옛 하울링 가드는 없다');
  const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  const importsOf = (source) => [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]).sort();

  // 순수 모듈 층: guardSpec 은 import 가 없고, 판정기는 guardSpec 만, 워클릿은 둘만 가져온다(앱 코드·스토어를 모른다).
  assert.deepEqual(importsOf(read('src/audio/engine/guardSpec.ts')), [], 'guardSpec.ts 는 값만 있는 순수 모듈이다');
  assert.deepEqual(importsOf(read('src/audio/monitor/howlDetector.ts')), ['../engine/guardSpec'], '판정기는 guardSpec 만 쓴다');
  assert.deepEqual(importsOf(read('src/audio/worklets/output-guard.worklet.ts')), ['../engine/guardSpec', '../monitor/howlDetector'], 'output-guard 는 guardSpec 과 판정기만 쓴다');
  assert.deepEqual(importsOf(read('src/audio/worklets/level-meter.worklet.ts')), ['../engine/guardSpec'], 'level-meter 는 guardSpec 만 쓴다');
  assert.deepEqual(importsOf(read('src/audio/monitor/levelReading.ts')).filter((from) => !from.startsWith('..')), [], 'levelReading 은 외부 패키지를 쓰지 않는다');
  assert.doesNotMatch(read('src/audio/monitor/MonitorService.ts'), /from '\.\.\/\.\.\/store|from 'zustand'|useMonitorStore/, 'MonitorService 는 저장소를 직접 부르지 않는다(sink 로 내보낸다)');

  // C1: 판정·측정은 화면·탭·문서 상태에 기대지 않는다
  // `this.window`(분석 창 배열)나 `window:` 필드는 전역 window 가 아니므로 점·콜론이 붙은 것은 거른다.
  const forbidden = /(?<![.\w])(document|window|requestAnimationFrame|setTimeout|setInterval|performance|visibilityState|navigator)(?![\w:])/;
  for (const file of ['src/audio/worklets/output-guard.worklet.ts', 'src/audio/worklets/level-meter.worklet.ts', 'src/audio/monitor/howlDetector.ts']) {
    const code = withoutComments(read(file));
    assert.doesNotMatch(code, forbidden, `${file}: 오디오 스레드 코드는 화면·시계 API 를 쓰지 않는다`);
  }

  // 판정은 출력 레벨을 보지 않는다(설계서 4.3 — 기본 구성은 출력 최고치가 낮아 레벨 기준이 닿지 않는다)
  const guardCode = withoutComments(read('src/audio/worklets/output-guard.worklet.ts'));
  assert.match(guardCode, /this\.analyze\(analysis, frames\)/, '판정기는 분석 입력(입력 1)을 먹는다');
  assert.doesNotMatch(guardCode, /detector\.push\([^)]*program/, '프로그램(출력) 입력은 판정에 쓰지 않는다');

  // 엔진 배선
  const engine = read('src/audio/AudioEngine.ts');
  assert.match(engine, /connect\(this\.outputGuard, 0, GUARD_ANALYSIS_INPUT\)/, '입력 트림 뒤 → 가드 입력 1(분석)');
  assert.match(engine, /createOutputGuard\(context, this\.currentGuardMode\(\)\)/, '가드는 만들 때 모드를 받는다');
  assert.match(engine, /createLevelMeter\(context, 'in'\)[\s\S]{0,80}createLevelMeter\(context, 'out'\)/, '입력·출력 미터 두 곳');
  const store = read('src/store/audioStore.ts');
  assert.match(store, /audioEngine\.setHowlHandler\(\(freqHz\) => \{[\s\S]{0,400}stopSession\('howl', \{ howlFrequencyHz: freqHz \}\)/, '차단 알림 → 정지 절차(S1.2)에 주파수를 넘긴다');
  assert.match(store, /audioEngine\.setMonitorSink\(monitorSink\)/, '엔진의 측정 결과는 monitorStore 로 간다');
  const workletModules = read('src/audio/offline/workletModules.ts');
  assert.match(workletModules, /levelMeterWorkletUrl[\s\S]*outputGuardWorkletUrl/, '오프라인 렌더에도 level-meter · output-guard 가 등록된다');
  assert.doesNotMatch(workletModules, /howl-guard|howlGuard/, '옛 이름은 남기지 않는다');
  assert.match(engine, /levelMeterWorkletUrl/, '라이브 엔진도 level-meter 를 등록한다');
  assert.match(engine, /outputGuardWorkletUrl/, '라이브 엔진도 output-guard 를 등록한다');
  assert.doesNotMatch(engine, /howl-guard|howlGuard/, '라이브 엔진에도 옛 이름이 없다');
}

console.log(
  `Howl guard regression passed (${Object.entries(matrixResult)
    .filter(([name]) => name.startsWith('H-'))
    .map(([name, seconds]) => `${name} ${seconds.toFixed(2)}s`)
    .join(', ')}).`,
);
