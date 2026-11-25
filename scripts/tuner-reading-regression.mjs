// 튜너가 들린 주파수를 어느 줄·어느 옥타브로 읽고 어떤 문구로 보여 주는지 확인한다(설계서 S2.12 / E-16).
// 주파수 판정(워클렛)은 tuner-regression 이 보고, 여기서는 '판정된 주파수 → 읽기 → 화면 문구'를 모든 튜닝에서 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

async function load(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { GUITAR_TUNING_OPTIONS, STRING_CHECK_CENTS, TUNING_PRESETS, getPitchReading } = await load(
  '../src/audio/utils/tunings.ts',
);
const { describeTuner } = await load('../src/audio/utils/tunerDisplay.ts');

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function hz(note, reference = 440) {
  const match = /^([A-G]#?)(-?\d+)$/.exec(note);
  assert.ok(match, `음 이름이 아닙니다: ${note}`);
  const midi = (Number(match[2]) + 1) * 12 + NOTE_NAMES.indexOf(match[1]);
  return reference * 2 ** ((midi - 69) / 12);
}
function detune(frequency, cents) {
  return frequency * 2 ** (cents / 1200);
}
function near(actual, expected, message, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);
}
function show(frequency, preset, reference = 440) {
  return describeTuner(getPitchReading(frequency, preset, reference), true);
}

// ── 설계서 수용 기준 ─────────────────────────────────────────────
{
  // D2 → 예전엔 'D3 · 정확함'(옥타브를 접어 D3 로 읽음). 이제는 6번 줄 E2 보다 200센트 낮은 음.
  const reading = getPitchReading(hz('D2'), 'standard');
  assert.equal(reading.stringNumber, 6);
  assert.equal(reading.targetNote, 'E2');
  assert.equal(reading.note, 'D2');
  near(reading.cents, -200, 'D2 는 6번 줄보다 200센트 낮다');
  assert.equal(reading.octavesAbove, undefined);
  assert.equal(reading.checkString, undefined);
  const display = describeTuner(reading, true);
  assert.equal(display.stringLabel, '6번 줄(E2)');
  assert.equal(display.statusText, '200센트 낮음');
  assert.equal(display.note, 'D2');
  assert.equal(display.status, 'far');
}

{
  // C3 → 기타 모드 '4번 줄(D3) · 200센트 낮음', 크로매틱 모드 'C3'.
  const guitar = show(hz('C3'), 'standard');
  assert.equal(guitar.stringLabel, '4번 줄(D3)');
  assert.equal(guitar.statusText, '200센트 낮음');
  assert.equal(guitar.note, 'C3');
  const chromatic = getPitchReading(hz('C3'), 'chromatic');
  assert.equal(chromatic.note, 'C3');
  assert.equal(chromatic.stringNumber, undefined);
  assert.equal(chromatic.targetNote, undefined);
  near(chromatic.cents, 0, '크로매틱 C3');
  const chromaticDisplay = describeTuner(chromatic, true);
  assert.equal(chromaticDisplay.note, 'C3');
  assert.equal(chromaticDisplay.stringLabel, null, '크로매틱에는 줄 번호가 없다');
  assert.equal(chromaticDisplay.statusText, '정확함');
}

{
  // B1(61.74Hz, 7현 기타의 낮은 B): 크로매틱에서 ±2센트 안으로 읽힌다. 기타 모드에서는 가장 가까운 6번 줄 E2 보다 500센트 낮다.
  for (const cents of [-2, -1, 0, 1, 2]) {
    const reading = getPitchReading(detune(hz('B1'), cents), 'chromatic');
    assert.equal(reading.note, 'B1');
    near(reading.cents, cents, `B1 ${cents}센트`);
  }
  const guitar = getPitchReading(hz('B1'), 'standard');
  assert.equal(guitar.stringNumber, 6);
  near(guitar.cents, -500, 'B1 은 E2 보다 500센트 낮다');
  assert.equal(guitar.checkString, undefined, '500센트는 줄을 확인하라고 할 만큼 멀지 않다');
}

{
  // 6번 줄을 조율하는데 E3 가 들어오면 '한 옥타브 높음' 안내(줄은 6번 줄 E2 로 읽는다).
  const reading = getPitchReading(hz('E3'), 'standard');
  assert.equal(reading.stringNumber, 6);
  assert.equal(reading.targetNote, 'E2');
  assert.equal(reading.octavesAbove, 1);
  assert.equal(reading.note, 'E3');
  near(reading.cents, 0, 'E3 의 옥타브 안내 센트는 E2 의 한 옥타브 위와의 차이');
  const display = describeTuner(reading, true);
  assert.equal(display.statusText, '6번 줄(E2)보다 한 옥타브 높습니다');
  assert.equal(display.stringLabel, '6번 줄(E2)');
  assert.equal(display.status, 'far');

  // 센트는 '한 옥타브 위 E2'와의 차이로 이어진다.
  for (const cents of [-40, -10, 10, 40]) {
    const flat = getPitchReading(detune(hz('E3'), cents), 'standard');
    assert.equal(flat.octavesAbove, 1, `E3 ${cents}센트`);
    near(flat.cents, cents, `E3 ${cents}센트의 센트 값`);
  }
}

// ── 표준 튜닝의 줄 판독 ───────────────────────────────────────────
for (const [index, target] of TUNING_PRESETS.standard.targets.entries()) {
  const reading = getPitchReading(hz(target.note), 'standard');
  assert.equal(reading.stringNumber, 6 - index, `${target.note}`);
  assert.equal(reading.targetNote, target.note);
  assert.equal(reading.octavesAbove, undefined);
  near(reading.cents, 0, `${target.note} 개방현`);
  assert.equal(describeTuner(reading, true).statusText, '정확함');
}

{
  // 한 옥타브 위 음은 가장 낮은 '위로 가장 적게 올라간' 줄로 안내한다.
  const cases = [
    ['E4', 1, 'E4', 0], // 개방 1번 줄
    ['E5', 1, 'E4', 1], // E2 보다는 세 옥타브지만 1번 줄 E4 의 한 옥타브가 더 가깝다
    ['A3', 5, 'A2', 1],
    ['D4', 4, 'D3', 1],
    ['G4', 3, 'G3', 1],
    ['E6', 1, 'E4', 2],
  ];
  for (const [note, string, targetNote, octaves] of cases) {
    const reading = getPitchReading(hz(note), 'standard');
    assert.equal(reading.stringNumber, string, note);
    assert.equal(reading.targetNote, targetNote, note);
    assert.equal(reading.octavesAbove ?? 0, octaves, note);
  }
  const twoOctaves = show(hz('E6'), 'standard');
  assert.equal(twoOctaves.statusText, '1번 줄(E4)보다 두 옥타브 높습니다');
}

{
  // 옥타브 안내의 경계: ±50센트 안이면 안내, 바깥이면 그냥 가장 가까운 줄로 읽는다.
  for (const cents of [-49, 49]) {
    assert.equal(getPitchReading(detune(hz('E3'), cents), 'standard').octavesAbove, 1, `E3 ${cents}`);
  }
  // E3 는 D3 보다 200센트 높고 G3 보다 300센트 낮아서, 51센트 낮으면 D3(149), 51센트 높으면 G3(249)가 가장 가깝다.
  for (const [cents, nearest] of [[-51, 'D3'], [51, 'G3']]) {
    const reading = getPitchReading(detune(hz('E3'), cents), 'standard');
    assert.equal(reading.octavesAbove, undefined, `E3 ${cents}`);
    assert.equal(reading.targetNote, nearest, `E3 ${cents}`);
  }
}

{
  // 아래쪽은 안내하지 않는다: 6번 줄을 낮춘 D2 는 제 줄의 낮춘 튜닝일 수 있다. 드롭 D 에서는 D2 가 그냥 '정확함'.
  const standard = getPitchReading(hz('D2'), 'standard');
  assert.equal(standard.octavesAbove, undefined);
  const dropD = getPitchReading(hz('D2'), 'drop-d');
  assert.equal(dropD.stringNumber, 6);
  assert.equal(dropD.targetNote, 'D2');
  near(dropD.cents, 0, 'Drop D 의 D2');
  assert.equal(describeTuner(dropD, true).statusText, '정확함');
  // E2 를 드롭 D 에 들이대면 D2 보다 200센트 높다.
  const e2 = show(hz('E2'), 'drop-d');
  assert.equal(e2.stringLabel, '6번 줄(D2)');
  assert.equal(e2.statusText, '200센트 높음');
}

// ── 모든 기타 튜닝의 개방현 ───────────────────────────────────────
for (const { id, targets } of GUITAR_TUNING_OPTIONS) {
  for (const [index, target] of targets.entries()) {
    for (const cents of [-12, 0, 12]) {
      const reading = getPitchReading(detune(hz(target.note), cents), id);
      assert.equal(reading.stringNumber, 6 - index, `${id} ${target.note}`);
      assert.equal(reading.targetNote, target.note, `${id} ${target.note}`);
      assert.equal(reading.octavesAbove, undefined, `${id} ${target.note} ${cents}`);
      near(reading.cents, cents, `${id} ${target.note} ${cents}센트`);
    }
  }
}

assert.deepEqual(
  GUITAR_TUNING_OPTIONS.map((preset) => preset.id),
  ['standard', 'drop-d', 'half-step-down', 'open-g'],
  '기타 튜닝 목록에는 크로매틱이 없다(모드 전환 버튼으로 고른다)',
);
assert.equal(TUNING_PRESETS.chromatic.id, 'chromatic', '크로매틱은 내부 프리셋으로 남는다');

// ── 기준음 ───────────────────────────────────────────────────────
for (const reference of [415, 432, 442, 466]) {
  const strings = TUNING_PRESETS.standard.targets.map((target) => hz(target.note, reference));
  strings.forEach((frequency, index) => {
    const reading = getPitchReading(frequency, 'standard', reference);
    assert.equal(reading.stringNumber, 6 - index, `${reference}Hz 기준 ${index}`);
    near(reading.cents, 0, `${reference}Hz 기준 개방현`);
  });
  const e3 = getPitchReading(hz('E3', reference), 'standard', reference);
  assert.equal(e3.octavesAbove, 1, `${reference}Hz 기준 E3`);
  const d2 = getPitchReading(hz('D2', reference), 'standard', reference);
  near(d2.cents, -200, `${reference}Hz 기준 D2`);
}

// 허용 범위(400~480Hz) 밖이거나 숫자가 아닌 기준음은 440 으로 본다.
for (const bad of [399, 481, 300, 500, Number.NaN, Number.POSITIVE_INFINITY]) {
  const chromatic = getPitchReading(440, 'chromatic', bad);
  assert.equal(chromatic.note, 'A4', `기준음 ${bad}`);
  near(chromatic.cents, 0, `기준음 ${bad} 은 440 으로 본다`);
  const standard = getPitchReading(82.4068892282175, 'standard', bad);
  assert.equal(standard.stringNumber, 6, `기준음 ${bad}`);
  near(standard.cents, 0, `기준음 ${bad} 의 줄 판독`, 1e-6);
}
for (const edge of [400, 480]) {
  near(getPitchReading(edge, 'chromatic', edge).cents, 0, `기준음 ${edge} 은 그대로 쓴다`);
}

// ── 줄 번호를 확인하세요: 가장 가까운 줄과도 600센트보다 멀다 ───────
{
  assert.equal(STRING_CHECK_CENTS, 600);
  const reading = getPitchReading(hz('C5'), 'standard');
  assert.equal(reading.checkString, true);
  assert.equal(reading.stringNumber, undefined);
  assert.equal(reading.targetNote, undefined);
  assert.equal(reading.note, 'C5');
  const display = describeTuner(reading, true);
  assert.equal(display.statusText, '줄 번호를 확인하세요');
  assert.equal(display.stringLabel, null);
  assert.equal(display.centsText, '-- ¢', '줄이 정해지지 않으면 센트도 보이지 않는다');
  assert.equal(display.needlePercent, 50);
  assert.equal(display.boundedCents, 0);
  assert.equal(display.status, 'far');
  assert.equal(display.note, 'C5');

  // 경계: 가장 가까운 줄에서 600센트 이내는 줄로 읽고, 넘으면 확인을 요청한다.
  const inside = getPitchReading(detune(hz('E4'), 599), 'standard');
  assert.equal(inside.checkString, undefined);
  assert.equal(inside.stringNumber, 1);
  const outside = getPitchReading(detune(hz('E4'), 601), 'standard');
  assert.equal(outside.checkString, true);
  assert.equal(getPitchReading(40, 'standard').checkString, true, '40Hz 는 6번 줄보다 1200센트 낮다');
  // 크로매틱에서는 줄을 따지지 않는다.
  assert.equal(getPitchReading(hz('C5'), 'chromatic').checkString, undefined);
}

// ── 크로매틱: 음 이름 + 옥타브 + 센트 ─────────────────────────────
{
  const cases = [
    ['E2', 'E2'], ['A4', 'A4'], ['C#3', 'C#3'], ['B1', 'B1'], ['D#6', 'D#6'], ['G2', 'G2'],
  ];
  for (const [note, expected] of cases) {
    const reading = getPitchReading(hz(note), 'chromatic');
    assert.equal(reading.note, expected);
    near(reading.cents, 0, `크로매틱 ${note}`);
    assert.equal(reading.stringNumber, undefined);
    assert.equal(reading.octavesAbove, undefined);
    assert.equal(reading.checkString, undefined);
  }
  assert.equal(show(hz('E2'), 'standard').frequencyText, '82.4 Hz', '주파수는 소수점 한 자리');
  assert.equal(show(1234.5678, 'chromatic').frequencyText, '1234.6 Hz');
  const sharp = show(detune(hz('A4'), 20), 'chromatic');
  assert.equal(sharp.note, 'A4');
  assert.equal(sharp.statusText, '20센트 높음');
  assert.equal(sharp.centsText, '+20 ¢');
  assert.equal(sharp.stringLabel, null);
  // 440Hz 가 기준 442 에서는 약 7.85센트 낮은 A4
  const reference442 = getPitchReading(440, 'chromatic', 442);
  assert.equal(reference442.note, 'A4');
  assert.ok(reference442.cents < -7 && reference442.cents > -8.5);
  // 반음 경계에서는 가까운 쪽 음으로
  assert.equal(getPitchReading(detune(hz('C4'), 49), 'chromatic').note, 'C4');
  assert.equal(getPitchReading(detune(hz('C4'), 51), 'chromatic').note, 'C#4');
}

// ── 값이 없을 때 ─────────────────────────────────────────────────
for (const bad of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
  for (const preset of ['standard', 'chromatic']) {
    const reading = getPitchReading(bad, preset);
    assert.equal(reading.frequency, null, String(bad));
    assert.equal(reading.note, null);
    assert.equal(reading.cents, 0);
  }
}

// ── 화면 문구 ────────────────────────────────────────────────────
{
  const empty = { frequency: null, note: null, cents: 0 };
  const off = describeTuner(empty, false);
  assert.equal(off.statusText, '튜너 꺼짐');
  assert.equal(off.note, '--');
  assert.equal(off.centsText, '-- ¢');
  assert.equal(off.frequencyText, '주파수 --');
  assert.equal(off.status, 'idle');
  assert.equal(off.needlePercent, 50);
  const waiting = describeTuner(empty, true);
  assert.equal(waiting.statusText, '신호 대기');
  assert.equal(waiting.status, 'idle');
  // 튜너가 꺼져 있으면 남은 읽기값이 있어도 보여 주지 않는다.
  const stale = describeTuner(getPitchReading(hz('E2'), 'standard'), false);
  assert.equal(stale.hasPitch, false);
  assert.equal(stale.statusText, '튜너 꺼짐');

  const a2 = hz('A2');
  const cases = [
    [0, '정확함', 'in-tune', '0 ¢'],
    [4.9, '정확함', 'in-tune', '+5 ¢'],
    [-4.9, '정확함', 'in-tune', '-5 ¢'],
    [6, '6센트 높음', 'near', '+6 ¢'],
    [-6, '6센트 낮음', 'near', '-6 ¢'],
    [15, '15센트 높음', 'near', '+15 ¢'],
    [-16, '16센트 낮음', 'far', '-16 ¢'],
    [30, '30센트 높음', 'far', '+30 ¢'],
  ];
  for (const [cents, text, status, centsText] of cases) {
    const display = show(detune(a2, cents), 'standard');
    assert.equal(display.statusText, text, `${cents}센트`);
    assert.equal(display.status, status, `${cents}센트`);
    assert.equal(display.centsText, centsText, `${cents}센트`);
    assert.equal(display.stringLabel, '5번 줄(A2)');
    assert.equal(display.note, 'A2');
  }
  const high = show(detune(a2, 80), 'standard');
  assert.equal(high.needlePercent, 100, '막대는 +50센트에서 멈춘다');
  assert.equal(high.boundedCents, 50);
  const low = show(detune(a2, -80), 'standard');
  assert.equal(low.needlePercent, 0, '막대는 -50센트에서 멈춘다');
  assert.equal(low.boundedCents, -50);
  near(show(detune(a2, 20), 'standard').needlePercent, 70, '막대 위치', 1e-6);

  // 옥타브 낱말
  const base = { frequency: 100, note: 'E2', cents: 0, targetNote: 'E2', stringNumber: 6 };
  const words = { 1: '한 옥타브', 2: '두 옥타브', 3: '세 옥타브', 4: '네 옥타브', 5: '5 옥타브' };
  for (const [octaves, word] of Object.entries(words)) {
    assert.equal(
      describeTuner({ ...base, octavesAbove: Number(octaves) }, true).statusText,
      `6번 줄(E2)보다 ${word} 높습니다`,
    );
  }
}

// ── 화면 연결(소스) ───────────────────────────────────────────────
{
  const meter = await readFile(new URL('../src/components/Meter.tsx', import.meta.url), 'utf8');
  for (const needle of [
    'describeTuner(pitch, isTunerActive)',
    'GUITAR_TUNING_OPTIONS.map',
    'role="group" aria-label="튜너 방식"',
    "aria-pressed={!isChromatic}",
    "aria-pressed={isChromatic}",
    "setTuningPreset('chromatic')",
    'setTuningPreset(lastGuitarPresetRef.current)',
    'disabled={isChromatic}',
    'hidden={isChromatic}',
  ]) {
    assert.ok(meter.includes(needle), `Meter.tsx 에 ${needle} 가 있어야 합니다.`);
  }
  assert.ok(!meter.includes('octaveMismatch'), '예전 octaveMismatch 표시는 남아 있으면 안 됩니다.');
  assert.ok(!meter.includes('목표 {'), '예전 "· 목표" 문구는 남아 있으면 안 됩니다.');
  assert.ok(!meter.includes('TUNING_PRESET_OPTIONS'), '튜닝 선택에 크로매틱이 다시 끼어들면 안 됩니다.');

  const store = await readFile(new URL('../src/store/audioStore.ts', import.meta.url), 'utf8');
  assert.ok(store.includes('left.octavesAbove === right.octavesAbove'), 'isSamePitch 는 옥타브 안내를 비교해야 합니다.');
  assert.ok(store.includes('left.checkString === right.checkString'), 'isSamePitch 는 줄 확인 표시를 비교해야 합니다.');
}

console.log('Tuner reading regression passed: 표준·Drop D·Half Step·Open G 개방현, D2/C3/B1/E3/C5, 옥타브 안내 경계, 600센트 경계, 크로매틱, 기준음, 화면 문구.');
