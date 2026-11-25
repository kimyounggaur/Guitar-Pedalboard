// Drive 왜곡 곡선 시험(S3.5, 보고서 R3-5 · 10월 계획서 M-2).
//
// 1) 바이어스 래퍼(withBias): 이득을 곱한 뒤 바이어스를 더하고 바이어스 자리의 값을 뺀다 → 곡선이 0 을 지난다(DC 없음).
// 2) 모든 모드·이득·바이어스에서 입력 0 의 출력이 정확히 0 이다(표본 수가 홀수라 가운데 표본이 입력 0).
// 3) Bias 한도 ±0.3: 한도 밖(±1, NaN)은 한도로 자르고, 어디서든 신호가 사라지지 않는다.
// 4) Distortion 이득: 노브에 대해 로그 간격으로 오르고, 노브 30% 에서 같은 위치의 Overdrive 보다 더 왜곡한다(R3-5).
// 5) 바이어스 0 에서 Overdrive·Crunch·Fuzz 모드는 이전 곡선과 같다(Distortion 만 이득이 바뀌었다).
// 시험이 결함을 실제로 잡는지(수정 전 곡선이 반드시 실패해야 함)도 함께 확인한다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const curves = await load('src/audio/utils/curves.ts');
const params = await load('src/audio/params/index.ts');
const { createDriveCurve, withBias, distortionGain, DRIVE_BIAS_LIMIT, DISTORTION_GAIN_MIN, DISTORTION_GAIN_MAX } = curves;

const MODES = ['overdrive', 'crunch', 'distortion', 'fuzz'];
const DRIVES = Array.from({ length: 21 }, (_, index) => index * 5);
const BIASES = [-0.3, -0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3];
const SAMPLES = 4097;
const MID = (SAMPLES - 1) / 2;

// ---------------------------------------------------------------------------------------------
// 수정 전 곡선(커밋 e90b5b0 의 createDriveCurve). 시험이 결함을 잡는지 확인하는 용도로만 쓰며, 앱 코드가 아니다.
// ---------------------------------------------------------------------------------------------
function legacyDriveCurve(mode, drive, bias, samples = SAMPLES) {
  const curve = new Float32Array(samples);
  const amount = 1 + (drive / 100) * 60;
  const asymmetry = bias * 0.35;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    const shifted = x + asymmetry;
    let shaped = shifted;
    if (mode === 'overdrive') {
      shaped = Math.tanh(shifted * amount) / Math.tanh(amount);
    } else if (mode === 'crunch') {
      const soft = Math.tanh(shifted * amount * 0.55);
      const hard = Math.max(-0.72, Math.min(0.72, shifted * amount * 0.18)) / 0.72;
      shaped = soft * 0.62 + hard * 0.38;
    } else if (mode === 'distortion') {
      const threshold = Math.max(0.12, 0.78 - (drive / 100) * 0.55);
      shaped = Math.max(-threshold, Math.min(threshold, shifted * amount * (0.16 + (drive / 100) * 0.8))) / threshold;
    } else {
      const threshold = Math.max(0.05, 0.3 - (drive / 100) * 0.22);
      shaped = shifted >= threshold ? 1 : shifted <= -threshold ? -1 : shifted / threshold;
    }
    curve[i] = Math.max(-1, Math.min(1, shaped - asymmetry * 0.25));
  }
  return curve;
}
const legacyDistortionGain = (drive) => {
  const knob = drive / 100;
  return ((1 + knob * 60) * (0.16 + knob * 0.8)) / Math.max(0.12, 0.78 - knob * 0.55);
};

// ---------------------------------------------------------------------------------------------
// 측정 도구: 곡선을 WaveShaper 처럼(선형 보간) 사인에 적용하고, 맞물린 주기로 THD·RMS 를 잰다.
// ---------------------------------------------------------------------------------------------
const RATE = 48000;
const F0 = 240; // 한 주기 200 표본, 240 주기 = 48000 표본(정수 주기라 누설이 없다)
const FRAMES = 48000;

function shapeSine(curve, amplitudeDb) {
  const amplitude = 10 ** (amplitudeDb / 20);
  const last = curve.length - 1;
  const out = new Float64Array(FRAMES);
  for (let n = 0; n < FRAMES; n += 1) {
    const x = Math.max(-1, Math.min(1, amplitude * Math.sin((2 * Math.PI * F0 * n) / RATE)));
    const position = ((x + 1) / 2) * last;
    const index = Math.min(last - 1, Math.floor(position));
    const fraction = position - index;
    out[n] = curve[index] * (1 - fraction) + curve[index + 1] * fraction;
  }
  const mean = out.reduce((sum, value) => sum + value, 0) / FRAMES;
  for (let n = 0; n < FRAMES; n += 1) out[n] -= mean; // DC 블로커가 하는 일
  return out;
}

function harmonicAmplitude(signal, harmonic) {
  let re = 0;
  let im = 0;
  const step = (2 * Math.PI * F0 * harmonic) / RATE;
  for (let n = 0; n < signal.length; n += 1) {
    re += signal[n] * Math.cos(step * n);
    im += signal[n] * Math.sin(step * n);
  }
  return (2 * Math.hypot(re, im)) / signal.length;
}

/** 2~10 배음의 THD(%) — 오디오 프로브 P-13 과 같은 정의 */
function thdPercent(curve, amplitudeDb = -18) {
  const signal = shapeSine(curve, amplitudeDb);
  const fundamental = harmonicAmplitude(signal, 1);
  let sum = 0;
  for (let harmonic = 2; harmonic <= 10; harmonic += 1) sum += harmonicAmplitude(signal, harmonic) ** 2;
  return (100 * Math.sqrt(sum)) / fundamental;
}

function rmsDb(curve, amplitudeDb = -18) {
  const signal = shapeSine(curve, amplitudeDb);
  let sum = 0;
  for (const value of signal) sum += value * value;
  return 20 * Math.log10(Math.sqrt(sum / signal.length) + 1e-12);
}

const KNOBS = Array.from({ length: 11 }, (_, index) => index * 10);

// ---------------------------------------------------------------------------------------------
// 1) 바이어스 래퍼
// ---------------------------------------------------------------------------------------------
{
  const shape = (u) => Math.tanh(u);
  for (const bias of [-0.3, -0.1, 0, 0.1, 0.3]) {
    const wrapped = withBias(shape, 20, bias);
    assert.equal(wrapped(0), 0, `withBias 는 입력 0 에서 정확히 0 이어야 한다(bias ${bias})`);
    // 이득을 곱한 '뒤' 에 더한다: x = 0.01, 이득 20 이면 u = 0.2 + bias
    assert.equal(wrapped(0.01), Math.tanh(0.2 + bias) - Math.tanh(bias));
    // 포화 구간에서도 두 쪽이 서로 다른 높이로 갈릴 뿐 사라지지 않는다
    assert.ok(Math.abs(wrapped(1) - wrapped(-1)) > 1.9, `꼭대기-꼭대기가 2 에 가깝다(bias ${bias})`);
  }
  const symmetric = withBias(shape, 20, 0);
  assert.equal(symmetric(0.2), -symmetric(-0.2), '바이어스 0 이면 홀함수다');
  const biased = withBias(shape, 20, 0.2);
  assert.ok(Math.abs(biased(0.2) + biased(-0.2)) > 0.1, '바이어스가 있으면 비대칭(짝수 배음)이 생긴다');
}

// ---------------------------------------------------------------------------------------------
// 2) 모든 모드·이득·바이어스에서 입력 0 → 출력 0, 유한, 단조, 크기 한도
// ---------------------------------------------------------------------------------------------
let curveCount = 0;
for (const mode of MODES) {
  for (const drive of DRIVES) {
    for (const bias of BIASES) {
      const curve = createDriveCurve(mode, drive, bias);
      curveCount += 1;
      const label = `${mode} drive ${drive} bias ${bias}`;
      assert.equal(curve.length, SAMPLES, `${label}: 기본 표본 수는 홀수 ${SAMPLES}`);
      assert.equal(curve[MID], 0, `${label}: 입력 0 의 출력이 정확히 0 이어야 한다(DC 없음)`);
      let finite = true;
      let largest = 0;
      let decreases = 0;
      for (let i = 0; i < curve.length; i += 1) {
        if (!Number.isFinite(curve[i])) finite = false;
        largest = Math.max(largest, Math.abs(curve[i]));
        if (i > 0 && curve[i] < curve[i - 1] - 1e-6) decreases += 1;
      }
      assert.ok(finite, `${label}: 유한한 값만`);
      assert.ok(largest <= 1.31, `${label}: 크기 ${largest} 가 1 + tanh(0.3) 안쪽이어야 한다`);
      assert.equal(decreases, 0, `${label}: 곡선은 줄어들지 않는다(단조)`);
    }
  }
}

// 수정 전 곡선은 입력 0 에서 0 이 아니다(바이어스가 있을 때) — 이 시험이 그 결함을 잡는다
{
  const legacy = legacyDriveCurve('overdrive', 42, 0.08);
  assert.ok(Math.abs(legacy[MID]) > 0.05, `수정 전 곡선의 0점 값 ${legacy[MID]} 은 0 이 아니었다`);
}

// ---------------------------------------------------------------------------------------------
// 3) Bias 한도 ±0.3 — 한도 밖은 한도로, NaN 은 0 으로
// ---------------------------------------------------------------------------------------------
assert.equal(DRIVE_BIAS_LIMIT, 0.3);
for (const mode of MODES) {
  for (const drive of [0, 42, 100]) {
    const high = createDriveCurve(mode, drive, 0.3);
    const low = createDriveCurve(mode, drive, -0.3);
    const none = createDriveCurve(mode, drive, 0);
    for (const outside of [0.31, 1, 5]) {
      assert.deepEqual(createDriveCurve(mode, drive, outside), high, `${mode} ${drive}: bias ${outside} 는 0.3 과 같다`);
      assert.deepEqual(createDriveCurve(mode, drive, -outside), low, `${mode} ${drive}: bias ${-outside} 는 −0.3 과 같다`);
    }
    for (const broken of [Number.NaN, Infinity, -Infinity]) {
      assert.deepEqual(createDriveCurve(mode, drive, broken), none, `${mode} ${drive}: 숫자가 아닌 바이어스(${broken})는 0`);
    }
    assert.deepEqual(createDriveCurve(mode, drive, 0.3), high);
  }
}

// 노브(drive)가 숫자가 아니거나 범위 밖이어도 유한한 곡선
for (const mode of MODES) {
  for (const drive of [Number.NaN, -20, 400]) {
    const curve = createDriveCurve(mode, drive, 0.08);
    assert.ok(curve.every(Number.isFinite), `${mode}: drive ${drive} 도 유한한 곡선이어야 한다`);
    assert.equal(curve[MID], 0);
  }
}

// 스키마와 저장값 자르기: 화면 범위 ±0.3, 저장된 ±1 은 한도로
{
  const definition = params.getParamDef('drive', 'bias');
  assert.equal(definition.min, -0.3);
  assert.equal(definition.max, 0.3);
  assert.equal(definition.step, 0.01);
  assert.equal(definition.default, 0.08);
  assert.equal(params.formatParamValue(definition, -0.3), '-0.30');
  assert.equal(params.clampParamsToSchema('drive', { bias: 1, drive: 40 }).bias, 0.3);
  assert.equal(params.clampParamsToSchema('drive', { bias: -1, drive: 40 }).bias, -0.3);
  assert.equal(params.clampParamsToSchema('drive', { bias: -0.12 }).bias, -0.12);
  const untouched = { bias: 0.08, drive: 42 };
  assert.equal(params.clampParamsToSchema('drive', untouched), untouched, '범위 안이면 같은 객체를 돌려준다');
}

// ---------------------------------------------------------------------------------------------
// 4) 신호가 사라지지 않는다 — 바이어스 한도 전 범위(그리고 잘리기 전의 ±1)에서 RMS ≥ −30 dBFS
// ---------------------------------------------------------------------------------------------
const SILENCE_FLOOR_DB = -30;
for (const mode of MODES) {
  for (const drive of [0, 42, 100]) {
    const reference = rmsDb(createDriveCurve(mode, drive, 0), -18);
    for (const bias of [-1, -0.3, -0.15, 0, 0.08, 0.15, 0.3, 1]) {
      const level = rmsDb(createDriveCurve(mode, drive, bias), -18);
      // 이득이 낮은 노브 0% 는 원래 조용하므로 바이어스 0 일 때보다 6 dB 넘게 줄지 않는지만 본다. 나머지는 설계서 기준 −30 dBFS.
      const floor = drive === 0 ? reference - 6 : SILENCE_FLOOR_DB;
      assert.ok(level >= floor, `${mode} drive ${drive} bias ${bias}: RMS ${level.toFixed(1)} dBFS 가 ${floor.toFixed(1)} 이상이어야 한다`);
    }
  }
}
// 수정 전 곡선: 바이어스 ±1 에서 소리가 사라졌다(−106 ~ −240 dBFS). 이 시험이 그것을 잡는다
{
  const vanished = [];
  for (const mode of MODES) {
    const level = rmsDb(legacyDriveCurve(mode, 100, 1), -18);
    if (level < SILENCE_FLOOR_DB) vanished.push(`${mode} ${level.toFixed(0)} dBFS`);
  }
  assert.equal(vanished.length, MODES.length, `수정 전 곡선은 바이어스 1 에서 네 모드 모두 무음이었다: ${vanished.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// 5) 바이어스 0 에서 Overdrive·Crunch·Fuzz 는 수정 전과 같다
// ---------------------------------------------------------------------------------------------
for (const mode of ['overdrive', 'crunch', 'fuzz']) {
  for (const drive of DRIVES) {
    const now = createDriveCurve(mode, drive, 0);
    const before = legacyDriveCurve(mode, drive, 0);
    let worst = 0;
    for (let i = 0; i < SAMPLES; i += 1) worst = Math.max(worst, Math.abs(now[i] - before[i]));
    assert.ok(worst < 1e-6, `${mode} drive ${drive}: 바이어스 0 곡선이 이전과 다르다(${worst})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 6) Distortion 이득 — 로그 간격, 끝값, 프리셋이 쓰는 68% 이상에서 이전과 +10% 안쪽
// ---------------------------------------------------------------------------------------------
assert.equal(DISTORTION_GAIN_MIN, 6.5);
assert.equal(DISTORTION_GAIN_MAX, 255);
assert.ok(Math.abs(distortionGain(0) - 6.5) < 1e-9);
assert.ok(Math.abs(distortionGain(100) - 255) < 1e-9);
assert.equal(distortionGain(-10), distortionGain(0));
assert.equal(distortionGain(250), distortionGain(100));
assert.equal(distortionGain(Number.NaN), distortionGain(0));
{
  const ratio = distortionGain(10) / distortionGain(0);
  for (let knob = 10; knob < 100; knob += 10) {
    assert.ok(Math.abs(distortionGain(knob + 10) / distortionGain(knob) - ratio) < 1e-9, `노브 ${knob}→${knob + 10} 이득 비가 같아야 한다(로그 간격)`);
    assert.ok(distortionGain(knob + 10) > distortionGain(knob));
  }
  for (const knob of [68, 70, 76, 80, 82, 90, 100]) {
    const change = distortionGain(knob) / legacyDistortionGain(knob);
    assert.ok(change > 0.95 && change < 1.1, `노브 ${knob}: 이전 이득과 +10% 안쪽(Distortion 프리셋은 68~82%라 소리가 거의 그대로), 지금 ${change.toFixed(3)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 7) THD-노브 곡선(오디오 프로브 P-13 의 Node 판): Distortion 은 단조 증가하고 30% 부터 Overdrive 이상이다
// ---------------------------------------------------------------------------------------------
{
  const distortion = KNOBS.map((knob) => thdPercent(createDriveCurve('distortion', knob, 0.08)));
  const overdrive = KNOBS.map((knob) => thdPercent(createDriveCurve('overdrive', knob, 0.08)));
  distortion.forEach((value, index) => {
    if (index > 0) assert.ok(value >= distortion[index - 1] - 0.05, `Distortion THD 가 노브 ${KNOBS[index]}% 에서 줄었다`);
  });
  overdrive.forEach((value, index) => {
    if (index > 0) assert.ok(value >= overdrive[index - 1] - 0.05, `Overdrive THD 가 노브 ${KNOBS[index]}% 에서 줄었다`);
  });
  assert.ok(distortion[0] < 2, `노브 0% 는 거의 깨끗하게 시작한다: ${distortion[0].toFixed(2)}%`);
  assert.ok(distortion[1] > 3, `노브 10% 에서 이미 왜곡이 들린다: ${distortion[1].toFixed(2)}%`);
  for (let index = 1; index < KNOBS.length; index += 1) {
    assert.ok(
      distortion[index] >= overdrive[index],
      `노브 ${KNOBS[index]}%: Distortion ${distortion[index].toFixed(1)}% 가 Overdrive ${overdrive[index].toFixed(1)}% 이상이어야 한다`,
    );
  }
  assert.ok(distortion[3] - overdrive[3] >= 3, `노브 30%: Distortion 이 Overdrive 보다 3%p 이상 더 왜곡한다(지금 ${(distortion[3] - overdrive[3]).toFixed(1)}%p)`);

  // 수정 전 Distortion: 노브 0~20% 에서 THD 0, 30% 에서도 Overdrive 에 못 미쳤다(R3-5) — 이 시험이 그것을 잡는다
  const legacy = KNOBS.map((knob) => thdPercent(legacyDriveCurve('distortion', knob, 0.08)));
  const legacyOverdrive = KNOBS.map((knob) => thdPercent(legacyDriveCurve('overdrive', knob, 0.08)));
  assert.ok(legacy[0] < 0.5 && legacy[1] < 0.5 && legacy[2] < 0.5, `수정 전 Distortion 은 노브 0~20% 에서 왜곡이 없었다: ${legacy.slice(0, 3).map((v) => v.toFixed(1)).join(', ')}`);
  assert.ok(legacy[3] < legacyOverdrive[3], `수정 전 Distortion 은 30% 에서 Overdrive(${legacyOverdrive[3].toFixed(1)}%)보다 깨끗했다(${legacy[3].toFixed(1)}%)`);
}

// Distortion 의 THD 는 바이어스 한도 전 범위에서도 단조롭고 사라지지 않는다
for (const bias of [-0.3, 0, 0.3]) {
  const distortion = KNOBS.map((knob) => thdPercent(createDriveCurve('distortion', knob, bias)));
  distortion.forEach((value, index) => {
    if (index > 0) assert.ok(value >= distortion[index - 1] - 0.05, `bias ${bias}: Distortion THD 가 노브 ${KNOBS[index]}% 에서 줄었다`);
  });
  assert.ok(distortion[10] > 35, `bias ${bias}: 노브 100% THD ${distortion[10].toFixed(1)}%`);
}

console.log(`Drive 왜곡 곡선 시험 통과: 곡선 ${curveCount}개의 0점 값 0·단조, 바이어스 한도 ±0.3, Distortion 이득·THD, 수정 전 곡선의 결함 재현`);
