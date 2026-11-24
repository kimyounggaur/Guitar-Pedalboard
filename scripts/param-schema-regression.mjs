// S2.2 파라미터 스키마(설계서 4.9) — 화면 밖의 약속을 지킨다.
//   · 스키마의 키·기본값·선택지가 앱의 기본 페달(initialPedals)과 하나도 어긋나지 않는다(저장 키는 바꾸지 않는다)
//   · 정의가 말이 된다(min < max, 기본값이 범위 안, 눈금 위, 알려진 예외만 눈금 밖)
//   · 표시 형식(format)이 화면에 그려지는 문자열과 같다(대표 값 — 모든 조절기의 화면 일치는 e2e 가 본다)
//   · M3: 범위를 벗어난 저장값을 불러올 때 범위 안으로 맞춘다(Reverb Decay 7.5 → 6.0). 입력은 바꾸지 않고 몇 번을 적용해도 같다
//   · 공장 프리셋 40개의 모든 숫자가 스키마 범위 안이고, 고르는 값은 선택지 안이다
//   · Fuzz Gate(D15)의 값 → 문턱 대응, Delay 시간 계산(엔진과 화면이 같은 함수)
//   · 불러오기 경로: 저장된 작업 상태·사용자 프리셋·가져온 프리셋 파일·픽스처 05 가 같은 규칙을 지난다
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const storageWrites = [];
const storageValues = new Map();
globalThis.window = {
  dispatchEvent() {},
  localStorage: {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem(key, value) {
      storageWrites.push({ key, value });
      storageValues.set(key, value);
    },
    removeItem: (key) => storageValues.delete(key),
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

const harnessBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { clampParamsToSchema, clampToParamDef, effectSchemas, findChoiceDef, findParamDef, formatParamValue, getParamDef } from './audio/params/index.ts';",
      "export { FUZZ_GATE_MAX_THRESHOLD_DB, FUZZ_GATE_MIN_THRESHOLD_DB, fuzzGateThresholdDb } from './audio/params/definitions/fuzz.ts';",
      "export { REVERB_DECAY_MAX, REVERB_DECAY_MIN } from './audio/params/definitions/reverb.ts';",
      "export { delayFollowsSync, delaySyncedLabel, delayTimeSeconds } from './audio/params/definitions/delay.ts';",
      "export { clampPedalsToSchema } from './presets/normalize.ts';",
      "export { STORAGE_KEYS } from './persistence/index.ts';",
      "export { clonePedals, initialPedals, migratePedalCollection, usePedalStore } from './store/pedalStore.ts';",
      "export { defaultPresets, parsePresetJson, usePresetStore } from './store/presetStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'param-schema-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const {
  clampParamsToSchema, clampToParamDef, effectSchemas, findChoiceDef, findParamDef, formatParamValue, getParamDef,
  FUZZ_GATE_MAX_THRESHOLD_DB, FUZZ_GATE_MIN_THRESHOLD_DB, fuzzGateThresholdDb,
  REVERB_DECAY_MAX, REVERB_DECAY_MIN,
  delayFollowsSync, delaySyncedLabel, delayTimeSeconds,
  clampPedalsToSchema, STORAGE_KEYS, clonePedals, initialPedals, migratePedalCollection, usePedalStore, defaultPresets, parsePresetJson, usePresetStore,
} = await import(`data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`);

let checks = 0;
const ok = (condition, message) => {
  checks += 1;
  assert.ok(condition, message);
};
const equal = (actual, expected, message) => {
  checks += 1;
  assert.equal(actual, expected, message);
};
const deepEqual = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};
const byId = (pedals, id) => {
  const found = pedals.find((pedal) => pedal.id === id);
  assert.ok(found, `페달 ${id} 가 없습니다.`);
  return found;
};
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

// ---------------------------------------------------------------------------------------------
// 1. 저장 키 목록(저장 형식 11) — 이 목록이 바뀌면 저장 형식 버전과 마이그레이션을 같이 고쳐야 한다
// ---------------------------------------------------------------------------------------------
const STORED_KEYS_V11 = {
  noiseGate: ['mix', 'level', 'thresholdDb', 'reductionDb', 'attackMs', 'holdMs', 'releaseMs', 'hysteresisDb'],
  compressor: ['mix', 'level', 'threshold', 'ratio', 'attack', 'release', 'knee', 'sustain'],
  autoWah: ['mix', 'level', 'sensitivity', 'range', 'resonance', 'mode', 'manual'],
  drive: ['mix', 'level', 'mode', 'drive', 'tone', 'bias'],
  crunch: ['mix', 'level', 'volume', 'gain', 'tone', 'presence', 'lowCut', 'mode'],
  fuzz: ['mix', 'level', 'fuzz', 'tone', 'mode', 'bias', 'gate', 'lowCut'],
  graphicEQ: ['mix', 'level', 'band100', 'band200', 'band400', 'band800', 'band1600', 'band3200', 'band6400'],
  eq: ['mix', 'level', 'lowCut', 'bassGain', 'midFreq', 'midGain', 'midQ', 'trebleGain', 'presenceGain'],
  cab: ['mix', 'level', 'model', 'micPosition', 'distance', 'lowCut', 'highCut', 'presence'],
  chorus: ['mix', 'level', 'rate', 'depth', 'voices', 'spread', 'tone'],
  flanger: ['mix', 'level', 'rate', 'depth', 'feedback', 'manual'],
  phaser: ['mix', 'level', 'rate', 'depth', 'stages', 'feedback'],
  tremolo: ['mix', 'level', 'rate', 'depth', 'shape', 'sync', 'bpm', 'division'],
  delay: ['mix', 'level', 'mode', 'timeMs', 'feedback', 'tone', 'sync', 'bpm', 'division', 'trails'],
  reverb: ['mix', 'level', 'mode', 'decay', 'preDelay', 'lowCut', 'highCut', 'trails'],
};

equal(initialPedals.length, 15, '페달은 15개');
deepEqual(Object.keys(effectSchemas).sort(), Object.keys(STORED_KEYS_V11).sort(), '스키마가 15개 이펙트 전부를 갖는다');
deepEqual(initialPedals.map((pedal) => pedal.type).sort(), Object.keys(effectSchemas).sort(), '스키마 이펙트 = 기본 페달 종류');

// ---------------------------------------------------------------------------------------------
// 2. 스키마 ↔ 기본 페달: 키·기본값·선택지가 일치
// ---------------------------------------------------------------------------------------------
const ALLOWED_UNITS = new Set(['dB', 'Hz', 'ms', 's', '%', ':1', '']);
const ALLOWED_TAPERS = new Set(['linear', 'log', 'audio']);
/** step 눈금 위에 놓이지 않는 기본값. 저장된 값과 소리를 바꾸지 않으려고 그대로 둔 것이다(기록 L-82). */
const KNOWN_OFF_GRID_DEFAULTS = new Set(['eq.trebleGain']);
const onGrid = (def) => {
  const steps = (def.default - def.min) / def.step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
};

const allDefs = [];
for (const pedal of initialPedals) {
  const schema = effectSchemas[pedal.type];
  ok(schema, `${pedal.type} 스키마가 있다`);
  equal(schema.type, pedal.type, `${pedal.type}: 스키마 type`);

  const paramKeys = schema.params.map((def) => def.key);
  const choiceKeys = schema.choices.map((def) => def.key);
  const schemaKeys = [...paramKeys, ...choiceKeys];
  equal(new Set(schemaKeys).size, schemaKeys.length, `${pedal.type}: 정의 키가 겹치지 않는다`);
  deepEqual([...schemaKeys].sort(), [...STORED_KEYS_V11[pedal.type]].sort(), `${pedal.type}: 스키마 키 = 저장 키(저장 키는 바꾸지 않는다)`);
  deepEqual([...Object.keys(pedal.params)].sort(), [...STORED_KEYS_V11[pedal.type]].sort(), `${pedal.type}: 기본 페달 키 = 저장 키`);

  for (const def of schema.params) {
    allDefs.push([pedal.type, def]);
    const where = `${pedal.type}.${def.key}`;
    equal(typeof pedal.params[def.key], 'number', `${where}: 기본 페달 값이 숫자`);
    equal(def.default, pedal.params[def.key], `${where}: 기본값 = 앱 기본값`);
    ok(def.min < def.max, `${where}: min < max`);
    ok(def.step > 0 && Number.isFinite(def.step), `${where}: step > 0`);
    ok(def.default >= def.min && def.default <= def.max, `${where}: 기본값이 범위 안`);
    ok(onGrid(def) || KNOWN_OFF_GRID_DEFAULTS.has(where), `${where}: 기본값이 step 눈금 위(예외는 목록에 있는 것뿐)`);
    ok(ALLOWED_UNITS.has(def.unit), `${where}: 단위 ${def.unit}`);
    ok(ALLOWED_TAPERS.has(def.taper), `${where}: 곡선 ${def.taper}`);
    equal(def.taper, 'linear', `${where}: 지금 화면의 노브는 모두 선형이다(S3.1·S4.4 가 바꾼다)`);
    ok(def.label.length > 0 && def.name.length > 0, `${where}: 이름과 전체 이름이 있다`);
    equal(typeof formatParamValue(def, def.default), 'string', `${where}: 표시 문자열`);
    for (const sample of [def.min, def.default, def.max]) {
      const text = formatParamValue(def, sample);
      ok(text.length > 0 && !/NaN|undefined|Infinity/.test(text), `${where}: ${sample} 의 표시 '${text}'`);
    }
    if (def.sliderScale !== undefined) ok(def.sliderScale > 0, `${where}: sliderScale > 0`);
  }
  for (const def of schema.choices) {
    const where = `${pedal.type}.${def.key}`;
    equal(def.default, pedal.params[def.key], `${where}: 선택 기본값 = 앱 기본값`);
    if (def.kind === 'boolean') {
      equal(typeof def.default, 'boolean', `${where}: 불리언 기본값`);
      ok(def.options === undefined, `${where}: 불리언에는 선택지가 없다`);
    } else {
      ok(Array.isArray(def.options) && def.options.length >= 1, `${where}: 선택지가 있다`);
      ok(def.options.some((option) => option.value === def.default), `${where}: 기본값이 선택지 안`);
      equal(new Set(def.options.map((option) => option.value)).size, def.options.length, `${where}: 선택지 값이 겹치지 않는다`);
    }
  }

  // 화면 이름이 겹치지 않는다(같은 페달 안에서 슬라이더 이름이 둘이면 사용자도 시험도 구분하지 못한다).
  const visibleLabels = schema.params.filter((def) => !def.hidden).map((def) => def.label);
  equal(new Set(visibleLabels).size, visibleLabels.length, `${pedal.type}: 보이는 조절기의 이름이 겹치지 않는다`);

  // 기본 Mix
  const mix = getParamDef(pedal.type, 'mix');
  equal(schema.defaultMix, mix.default, `${pedal.type}: defaultMix = mix 기본값`);
  equal(schema.defaultMix, pedal.params.mix, `${pedal.type}: defaultMix = 앱 기본 Mix`);
}
equal(allDefs.length, 100, '숫자 조절기 정의는 모두 100개(저장 키 120개 중 선택 값 20개를 뺀 것)');
deepEqual(
  allDefs.filter(([, def]) => def.hidden).map(([type, def]) => `${type}.${def.key}`),
  ['delay.level'],
  '화면에 조절기가 없는 숫자 값은 Delay level 하나',
);
deepEqual(
  Object.values(effectSchemas).flatMap((schema) => schema.choices.filter((def) => def.hidden).map((def) => `${schema.type}.${def.key}`)),
  ['crunch.mode'],
  '화면에 조절기가 없는 선택 값은 Crunch mode 하나',
);

// ---------------------------------------------------------------------------------------------
// 3. 표시 형식 — 화면 글자와 같아야 하는 대표 값
// ---------------------------------------------------------------------------------------------
const shown = (type, key, value) => formatParamValue(getParamDef(type, key), value);
const FORMAT_CASES = [
  ['noiseGate', 'thresholdDb', -54, '-54 dB'],
  ['noiseGate', 'releaseMs', 180, '180 ms'],
  ['noiseGate', 'hysteresisDb', 4, '4 dB'],
  ['noiseGate', 'hysteresisDb', 0.5, '0.5 dB'],
  ['noiseGate', 'reductionDb', -80, '-80 dB'],
  ['noiseGate', 'attackMs', 6, '6 ms'],
  ['noiseGate', 'holdMs', 70, '70 ms'],
  ['compressor', 'attack', 0.006, '6 ms'],
  ['compressor', 'release', 0.18, '180 ms'],
  ['compressor', 'ratio', 4, '4.0:1'],
  ['compressor', 'knee', 18, '18 dB'],
  ['compressor', 'threshold', -24, '-24 dB'],
  ['compressor', 'sustain', 35, '35%'],
  ['drive', 'bias', 0.08, '0.08'],
  ['drive', 'bias', -1, '-1.00'],
  ['crunch', 'lowCut', 80, '80 Hz'],
  ['graphicEQ', 'band100', 0, '0 dB'],
  ['graphicEQ', 'band1600', 3, '+3 dB'],
  ['graphicEQ', 'band6400', -2.5, '-2.5 dB'],
  ['eq', 'lowCut', 70, '70Hz'],
  ['eq', 'bassGain', 1.5, '1.5dB'],
  ['eq', 'trebleGain', 1.8, '1.8dB'],
  ['eq', 'midQ', 0.9, 'Q 0.9'],
  ['cab', 'presence', 1.5, '+1.5 dB'],
  ['cab', 'presence', -2, '-2.0 dB'],
  ['cab', 'highCut', 5400, '5.4 kHz'],
  ['chorus', 'rate', 0.8, '0.8 Hz'],
  ['flanger', 'rate', 0.25, '0.25 Hz'],
  ['flanger', 'feedback', 60, '+60%'],
  ['flanger', 'feedback', -20, '-20%'],
  ['flanger', 'feedback', 0, '0%'],
  ['flanger', 'manual', 2, '2.0 ms'],
  ['tremolo', 'rate', 5, '5.0 Hz'],
  ['tremolo', 'bpm', 120, '120'],
  ['delay', 'mix', 30, '30%'],
  ['delay', 'timeMs', 280, '280 ms'],
  ['delay', 'feedback', 0.34, '34%'],
  ['delay', 'feedback', 0.95, '95%'],
  ['reverb', 'decay', 1.8, '1.8s'],
  ['reverb', 'highCut', 7200, '7.2k'],
  ['reverb', 'preDelay', 24, '24 ms'],
  ['reverb', 'lowCut', 120, '120 Hz'],
  ['fuzz', 'lowCut', 70, '70 Hz'],
];
for (const [type, key, value, expected] of FORMAT_CASES) equal(shown(type, key, value), expected, `${type}.${key}=${value} 의 표시`);
// 단위 기본 표시(format 이 없는 정의가 생겨도 값 + 단위로 읽힌다)
equal(formatParamValue({ ...getParamDef('delay', 'timeMs'), format: undefined }, 280), '280ms', 'format 이 없으면 값 + 단위');

// ---------------------------------------------------------------------------------------------
// 4. Fuzz Gate(D15): 0 = 끔, 1~100 → 문턱 −80 ~ −30 dBFS
// ---------------------------------------------------------------------------------------------
equal(fuzzGateThresholdDb(0), null, 'Gate 0 은 끔');
equal(fuzzGateThresholdDb(0.4), null, '0.4 도 끔(눈금에 없는 값은 반올림해 0)');
equal(fuzzGateThresholdDb(-3), null, '음수는 끔');
equal(fuzzGateThresholdDb(Number.NaN), null, 'NaN 은 끔');
equal(fuzzGateThresholdDb(1), FUZZ_GATE_MIN_THRESHOLD_DB, 'Gate 1 → −80 dBFS');
equal(fuzzGateThresholdDb(100), FUZZ_GATE_MAX_THRESHOLD_DB, 'Gate 100 → −30 dBFS');
equal(fuzzGateThresholdDb(500), FUZZ_GATE_MAX_THRESHOLD_DB, '100 을 넘으면 100 으로');
ok(Math.abs(fuzzGateThresholdDb(50) - (-80 + (49 / 99) * 50)) < 1e-9, 'Gate 50 → 약 −55.25 dBFS');
{
  let previous = -Infinity;
  for (let gate = 1; gate <= 100; gate += 1) {
    const threshold = fuzzGateThresholdDb(gate);
    ok(threshold > previous, `Gate ${gate}: 문턱이 단조 증가`);
    previous = threshold;
  }
}
equal(shown('fuzz', 'gate', 0), '끔', 'Gate 0 의 표시');
equal(shown('fuzz', 'gate', 1), '-80 dB', 'Gate 1 의 표시');
equal(shown('fuzz', 'gate', 50), '-55 dB', 'Gate 50 의 표시');
equal(shown('fuzz', 'gate', 100), '-30 dB', 'Gate 100 의 표시');

// ---------------------------------------------------------------------------------------------
// 5. Delay 시간 — 엔진과 화면이 같은 함수. Slapback 은 Sync 를 무시한다
// ---------------------------------------------------------------------------------------------
const delayBase = { mode: 'digital', timeMs: 280, sync: false, bpm: 120, division: '1/4' };
equal(delayTimeSeconds(delayBase), 0.28, 'Sync 끔: D.Time 그대로');
equal(delayTimeSeconds({ ...delayBase, timeMs: 5 }), 0.02, '20 ms 미만은 20 ms');
equal(delayTimeSeconds({ ...delayBase, timeMs: 5000 }), 2, '2 초 초과는 2 초');
equal(delayTimeSeconds({ ...delayBase, sync: true }), 0.5, '120 BPM 의 1/4 = 500 ms');
equal(delayTimeSeconds({ ...delayBase, sync: true, division: '1/8' }), 0.25, '120 BPM 의 1/8 = 250 ms');
equal(delayTimeSeconds({ ...delayBase, sync: true, division: '1/16' }), 0.125, '120 BPM 의 1/16 = 125 ms');
equal(delayTimeSeconds({ ...delayBase, sync: true, bpm: 90, division: 'dotted1/8' }), 0.5, '90 BPM 의 점 8분 = 500 ms');
equal(delayTimeSeconds({ ...delayBase, sync: true, bpm: 10 }), 1.5, 'BPM 은 40 ~ 240 으로 자른다(40 BPM 의 1/4 = 1.5 초)');
equal(delayTimeSeconds({ ...delayBase, mode: 'slapback', timeMs: 500 }), 0.14, 'Slapback 은 140 ms 까지');
equal(delayTimeSeconds({ ...delayBase, mode: 'slapback', timeMs: 90, sync: true }), 0.09, 'Slapback 은 Sync 를 무시하고 D.Time 을 쓴다');
equal(delayFollowsSync({ mode: 'digital', sync: true }), true, 'Sync 가 켜지면 시간을 정한다');
equal(delayFollowsSync({ mode: 'digital', sync: false }), false, 'Sync 가 꺼지면 아니다');
equal(delayFollowsSync({ mode: 'slapback', sync: true }), false, 'Slapback 에서는 Sync 가 시간을 정하지 않는다');
equal(delaySyncedLabel({ ...delayBase, sync: true }), '1/4 · 500 ms', '동기된 값의 표시');
equal(delaySyncedLabel({ ...delayBase, sync: true, bpm: 90, division: 'dotted1/8' }), 'Dotted 1/8 · 500 ms', '점 8분의 표시');
const timeDef = getParamDef('delay', 'timeMs');
equal(timeDef.disabledWhen({ mode: 'tape', sync: true }), true, 'D.Time: Sync 켜짐 → 막음');
equal(timeDef.disabledWhen({ mode: 'tape', sync: false }), false, 'D.Time: Sync 꺼짐 → 조작 가능');
equal(timeDef.disabledWhen({ mode: 'slapback', sync: true }), false, 'D.Time: Slapback 은 Sync 가 켜져도 조작 가능');
equal(timeDef.disabledWhen({}), false, 'D.Time: 값이 없으면 막지 않는다');
for (const def of Object.values(effectSchemas).flatMap((schema) => schema.params)) {
  if (def.key === 'timeMs') continue;
  equal(def.disabledWhen, undefined, `${def.label}: disabledWhen 은 D.Time 에만 있다(Tremolo Rate 는 아직 막지 않는다 — 기록 L-85)`);
}

// ---------------------------------------------------------------------------------------------
// 6. M3 — 범위를 벗어난 저장값을 범위 안으로 맞춘다
// ---------------------------------------------------------------------------------------------
equal(REVERB_DECAY_MIN, 0.2, 'Reverb Decay 최솟값');
equal(REVERB_DECAY_MAX, 6, 'Reverb Decay 최댓값 6 초(D14)');
equal(getParamDef('reverb', 'decay').max, REVERB_DECAY_MAX, '스키마와 상수가 같다');
{
  const reverb = byId(initialPedals, 'reverb');
  const withDecay = (decay, extra = {}) => deepFreeze({ ...reverb.params, decay, ...extra });
  equal(clampParamsToSchema('reverb', withDecay(7.5)).decay, 6, '7.5 → 6.0');
  equal(clampParamsToSchema('reverb', withDecay(6.2)).decay, 6, '6.2 → 6.0');
  equal(clampParamsToSchema('reverb', withDecay(10)).decay, 6, '10 → 6.0');
  equal(clampParamsToSchema('reverb', withDecay(0)).decay, 0.2, '0 → 0.2');
  equal(clampParamsToSchema('reverb', withDecay(-4)).decay, 0.2, '음수 → 0.2');
  const inRange = withDecay(3.3);
  equal(clampParamsToSchema('reverb', inRange), inRange, '범위 안이면 같은 객체를 돌려준다');
  const changed = clampParamsToSchema('reverb', withDecay(7.5));
  deepEqual({ ...changed, decay: 0 }, { ...reverb.params, decay: 0 }, 'decay 밖의 값은 하나도 달라지지 않는다');
  deepEqual(clampParamsToSchema('reverb', changed), changed, '몇 번 적용해도 같다');
  equal(clampParamsToSchema('reverb', withDecay('7.5')).decay, '7.5', '문자열은 건드리지 않는다');
  equal(clampParamsToSchema('reverb', withDecay(Number.NaN)).decay, Number.NaN, 'NaN 은 건드리지 않는다');
  equal(clampParamsToSchema('reverb', withDecay(Number.POSITIVE_INFINITY)).decay, Number.POSITIVE_INFINITY, 'Infinity 는 건드리지 않는다');
  equal(clampParamsToSchema('reverb', withDecay(7.5, { futureField: 99 })).futureField, 99, '알 수 없는 키는 그대로(M7)');
  equal(clampParamsToSchema('reverb', withDecay(2, { mode: 'cathedral' })).mode, 'cathedral', '알 수 없는 선택값도 그대로(M7)');
  equal(clampParamsToSchema('reverb', withDecay(2, { mix: 250 })).mix, 100, '다른 숫자도 같은 규칙: Mix 250 → 100');
  equal(clampParamsToSchema('notAnEffect', { a: 1 }).a, 1, '모르는 이펙트 종류는 그대로');
  equal(clampToParamDef(getParamDef('reverb', 'decay'), Number.NaN), 1.8, 'clampToParamDef: 숫자가 아니면 기본값');
}
{
  const board = clonePedals(initialPedals).map((pedal) =>
    pedal.id === 'reverb' ? { ...pedal, params: { ...pedal.params, decay: 7.5 } } : pedal);
  const frozen = deepFreeze(board);
  const result = clampPedalsToSchema(frozen);
  equal(byId(result, 'reverb').params.decay, 6, '페달 목록: Reverb 7.5 → 6.0');
  equal(byId(frozen, 'reverb').params.decay, 7.5, '입력은 바꾸지 않는다');
  for (const pedal of result) {
    if (pedal.id !== 'reverb') equal(pedal, byId(frozen, pedal.id), `${pedal.id}: 바뀔 게 없으면 같은 객체`);
  }
  deepEqual(clampPedalsToSchema(result), result, '몇 번 적용해도 같다');
}

// ---------------------------------------------------------------------------------------------
// 7. 공장 프리셋 — 모든 숫자가 범위 안, 고르는 값은 선택지 안, 키는 스키마 안
// ---------------------------------------------------------------------------------------------
equal(defaultPresets.length, 40, '공장 프리셋 40개');
let presetNumbers = 0;
const longDecays = [];
const presetProblems = [];
for (const preset of defaultPresets) {
  for (const pedal of preset.pedals) {
    const schema = effectSchemas[pedal.type];
    const known = new Set([...schema.params.map((def) => def.key), ...schema.choices.map((def) => def.key)]);
    for (const [key, value] of Object.entries(pedal.params)) {
      const where = `${preset.name} · ${pedal.id}.${key}=${String(value)}`;
      checks += 1;
      if (!known.has(key)) {
        presetProblems.push(`${where}: 스키마에 없는 키`);
        continue;
      }
      const def = findParamDef(pedal.type, key);
      if (def) {
        presetNumbers += 1;
        if (typeof value !== 'number') presetProblems.push(`${where}: 숫자가 아님`);
        else if (!(value >= def.min && value <= def.max)) presetProblems.push(`${where}: 범위 ${def.min}~${def.max} 밖`);
      } else {
        const choiceDef = findChoiceDef(pedal.type, key);
        if (choiceDef.kind === 'boolean') {
          if (typeof value !== 'boolean') presetProblems.push(`${where}: 불리언이 아님`);
        } else if (!choiceDef.options.some((option) => option.value === value)) {
          presetProblems.push(`${where}: 선택지 밖`);
        }
      }
    }
    if (pedal.type === 'reverb' && pedal.params.decay >= 6) longDecays.push(`${preset.name}=${pedal.params.decay}`);
  }
}
deepEqual(presetProblems, [], '공장 프리셋의 모든 값이 스키마 범위·선택지 안(밖에 있는 값은 아래에 모두 나열된다)');
ok(presetNumbers > 1000, `공장 프리셋의 숫자 ${presetNumbers}개를 모두 확인했다`);
deepEqual(longDecays, ['Ambient Delay=6', 'Tape Swell=6'], 'Decay 6 초인 공장 프리셋은 이 둘뿐이고 6.0 이다(예전 6.2·7.5)');

// ---------------------------------------------------------------------------------------------
// 8. 불러오기 경로
// ---------------------------------------------------------------------------------------------
const fixturePath = new URL('../e2e/fixtures/storage-v1/05-reverb-decay-7.5.json', import.meta.url);
const fixtureText = await readFile(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureText);
const storedWorking = JSON.parse(fixture.storage[STORAGE_KEYS.pedals]);
equal(byId(storedWorking.pedals, 'reverb').params.decay, 7.5, '픽스처 05 의 저장값은 Decay 7.5');

for (const [key, value] of Object.entries(fixture.storage)) storageValues.set(key, value);
storageWrites.length = 0;
usePedalStore.getState().loadPedalsFromStorage();
{
  const loaded = usePedalStore.getState().pedals;
  equal(byId(loaded, 'reverb').params.decay, 6, '저장된 작업 상태: Reverb Decay 7.5 → 6.0');
  for (const stored of storedWorking.pedals) {
    for (const [name, value] of Object.entries(stored.params)) {
      if (stored.id === 'reverb' && name === 'decay') continue;
      equal(byId(loaded, stored.id).params[name], value, `작업 상태: ${stored.id}.${name} 은 저장된 그대로`);
    }
  }
  equal(storageWrites.filter(({ key }) => key === STORAGE_KEYS.pedals).length, 0, '불러오기만으로는 저장본을 다시 쓰지 않는다');
  equal(storageValues.get(STORAGE_KEYS.pedals), fixture.storage[STORAGE_KEYS.pedals], '저장본 원문 그대로');
  equal(await readFile(fixturePath, 'utf8'), fixtureText, '픽스처 파일은 읽기만 했다');
}
{
  // 이전 형식(버전 10)도 같은 길을 지난다.
  const pedals = migratePedalCollection(storedWorking.pedals.map((pedal) => ({ ...pedal })), 10);
  equal(byId(pedals, 'reverb').params.decay, 6, '형식 10 으로 읽어도 7.5 → 6.0');
}
{
  const reverbJson = (decay) => JSON.stringify({
    version: 11,
    presets: [{
      id: 'long-tail', name: 'Long Tail', updatedAt: 1,
      pedals: [{ id: 'reverb', enabled: true, bypassed: false, params: { ...byId(initialPedals, 'reverb').params, decay } }],
    }],
  });
  const [imported] = parsePresetJson(reverbJson(7.5));
  equal(byId(imported.pedals, 'reverb').params.decay, 6, '가져온 프리셋 파일: Decay 7.5 → 6.0');
  const [kept] = parsePresetJson(reverbJson(2.5));
  equal(byId(kept.pedals, 'reverb').params.decay, 2.5, '범위 안의 Decay 는 그대로');
  const [reimported] = parsePresetJson(JSON.stringify({
    version: 11,
    presets: [{ id: imported.id, name: imported.name, updatedAt: imported.updatedAt, pedals: imported.pedals }],
  }));
  deepEqual(reimported.pedals, imported.pedals, '내보냈다 다시 가져와도 같다(멱등)');
}
{
  // 저장소의 사용자 프리셋
  const userPresets = JSON.stringify({
    version: 11,
    presets: [{
      id: 'user-long', name: 'User Long', updatedAt: 5,
      pedals: [{ id: 'reverb', enabled: true, bypassed: false, params: { ...byId(initialPedals, 'reverb').params, decay: 9 } }],
    }],
  });
  storageValues.set(STORAGE_KEYS.presets, userPresets);
  usePresetStore.getState().reloadPresets();
  const found = usePresetStore.getState().presets.find((preset) => preset.id === 'user-long');
  ok(found, '사용자 프리셋을 읽었다');
  equal(byId(found.pedals, 'reverb').params.decay, 6, '사용자 프리셋: Decay 9 → 6.0');
}

console.log(`통과 ${checks}건 — S2.2 파라미터 스키마·M3 회귀 시험`);
