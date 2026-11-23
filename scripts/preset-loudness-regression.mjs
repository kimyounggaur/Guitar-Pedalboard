// S1.4c 프리셋 음량 정렬 — 소리 밖의 약속을 지킨다.
//   · 기준과 공식(loudnessSpec.ts): 목표·예외·한도·반올림·표시
//   · 기준 신호 REF-PC 가 옮겨 간 뒤에도 비트 단위로 같다(해시) — 팩토리 trim 이 이 신호로 계산됐다
//   · src/presets/factoryTrims.json 이 지금 기준 상수·프리셋 목록과 맞는다(상수만 바꾸고 npm run trims 를 잊으면 여기서 걸린다)
//   · 스토어: 작업 중인 보정값의 저장·복원, 프리셋 저장·내보내기·가져오기, A/B 슬롯, 실행 취소
//   · 엔진: 보정값을 30 ms 램프로 trim 노드에 건넨다
// 소리 자체(보정을 적용한 출력이 −20 ± 2 dBFS 인지, 리미터 감소량, 클린↔드라이브 전환)는 오디오 프로브 P-05 가 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// ---------------------------------------------------------------------------------------------
// 가짜 브라우저 저장소. 쓰기 기록을 남겨 어떤 JSON 이 저장됐는지 본다.
// ---------------------------------------------------------------------------------------------
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
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export * as spec from './audio/offline/loudnessSpec.ts';",
      "export * as reference from './audio/offline/referenceSignal.ts';",
      "export * as signals from './audio/testing/signals.ts';",
      "export { SCHEMA_VERSION, clonePedals, initialPedals, migrateStoredState, usePedalStore } from './store/pedalStore.ts';",
      "export { applyPresetPedals, defaultPresets, parsePresetJson, usePresetStore } from './store/presetStore.ts';",
      "export { useHistoryStore } from './store/historyStore.ts';",
      "export { useAudioStore } from './store/audioStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'preset-loudness-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const {
  AudioEngine, spec, reference, signals,
  SCHEMA_VERSION, clonePedals, initialPedals, migrateStoredState, usePedalStore,
  applyPresetPedals, defaultPresets, parsePresetJson, usePresetStore,
  useHistoryStore,
} = await import(`data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`);

const engine = AudioEngine.getInstance();
const originalRebuildChain = engine.rebuildChain;
engine.rebuildChain = () => {};

const PEDAL_KEY = 'guitar-pedalboard:pedals';
const lastPedalWrite = () => JSON.parse(storageWrites.filter(({ key }) => key === PEDAL_KEY).at(-1).value);
const pedalStore = () => usePedalStore.getState();
const presetStore = () => usePresetStore.getState();
const history = () => useHistoryStore.getState();

try {
  // -------------------------------------------------------------------------------------------
  // 1. 기준과 공식
  // -------------------------------------------------------------------------------------------
  assert.equal(spec.PRESET_TRIM_LIMIT_DB, 24, 'GS-2: trim 은 ±24 dB 안');
  assert.equal(spec.targetRmsDbfsFor(undefined), spec.PRESET_TARGET_RMS_DBFS, '모르는 프리셋은 표준 목표');
  assert.equal(spec.targetRmsDbfsFor('user-preset'), spec.PRESET_TARGET_RMS_DBFS);
  for (const [id, offset] of Object.entries(spec.PRESET_TARGET_OFFSETS_DB)) {
    assert.ok(defaultPresets.some((preset) => preset.id === id), `D6 예외 프리셋 ${id} 가 팩토리 목록에 없습니다.`);
    assert.equal(spec.targetRmsDbfsFor(id), spec.PRESET_TARGET_RMS_DBFS + offset);
  }
  assert.equal(spec.targetRmsDbfsFor('factory-headphone-safe-start'), spec.PRESET_TARGET_RMS_DBFS - 6, 'D6 예외(REFACTOR_LOG L-38)');

  assert.equal(spec.clampTrimDb(undefined), 0, 'M6: 없으면 0');
  assert.equal(spec.clampTrimDb(null), 0);
  assert.equal(spec.clampTrimDb('3'), 0, '숫자가 아니면 0');
  assert.equal(spec.clampTrimDb(Number.NaN), 0);
  assert.equal(spec.clampTrimDb(Number.POSITIVE_INFINITY), 0);
  assert.equal(spec.clampTrimDb(3.14), 3.14);
  assert.equal(spec.clampTrimDb(99), 24);
  assert.equal(spec.clampTrimDb(-99), -24);

  assert.equal(spec.roundTrimDb(3.14), 3.1);
  assert.equal(spec.roundTrimDb(-2.26), -2.3);
  assert.ok(Object.is(spec.roundTrimDb(-0.04), 0), '-0 이 저장되지 않는다');

  assert.equal(spec.trimDbFor(-30), 10, '목표 −20 에 −30 이면 +10 dB');
  assert.equal(spec.trimDbFor(-9.2), -10.8);
  assert.equal(spec.trimDbFor(-30, -26), 4, '예외 목표를 줄 수 있다');
  assert.equal(spec.trimDbFor(-70), 24, '한도에 걸린다');
  assert.equal(spec.trimDbFor(-85), 0, '소리가 없으면 보정하지 않는다');
  assert.equal(spec.trimDbFor(Number.NaN), 0);
  assert.equal(spec.trimDbFor(Number.NEGATIVE_INFINITY), 0);

  // GS-7: 보정한 피크가 0 dBFS(천장 −1 + 허용 감소량 1)를 넘지 않게 거기서 멈춘다.
  assert.equal(spec.PRESET_MAX_LIMITER_REDUCTION_DB, 1);
  assert.equal(spec.headroomTrimLimitDb(-4.5), 4.5, '피크 −4.5 dBFS 는 4.5 dB 까지 올리면 0 dBFS 에 닿는다');
  assert.equal(spec.headroomTrimLimitDb(3), -3, '피크가 0 dBFS 를 넘으면 줄여야 한다');
  assert.equal(spec.trimDbFor(-27.09, -20, -4.52), 4.5, '평균 목표(+7.1)보다 피크 여유(4.52 → 0.1 단위로 내림 4.5)가 먼저 막는다');
  assert.equal(spec.trimDbFor(-33.45, -20, -12.73), 12.7, '피크 여유 12.73 → 12.7');
  assert.equal(spec.trimDbFor(-30, -20, -40), 10, '피크 여유가 넉넉하면 평균 목표 그대로');
  assert.equal(spec.trimDbFor(-10, -20, 4.77), -10, '평균을 줄이는 쪽이 더 크면 그대로(피크도 이미 충분히 내려간다)');
  assert.equal(spec.trimDbFor(-20, -20, 3), -3, '평균은 맞아도 피크가 0 dBFS 를 넘으면 줄인다');
  assert.equal(spec.trimDbFor(-30, -20, Number.NaN), 10, '피크를 모르면 평균만 맞춘다');
  assert.equal(spec.trimDbFor(-85, -20, -40), 0, '소리가 없으면 피크가 있어도 0');
  assert.ok(Math.abs(spec.achievableTargetDbfs(-27.09, -4.52) - -22.57) < 1e-9, '도달 가능한 목표 = 평균 + 피크 여유');
  assert.equal(spec.achievableTargetDbfs(-30, -40), -20, '여유가 넉넉하면 표준 목표');
  assert.equal(spec.achievableTargetDbfs(-30, Number.NaN, -26), -26);
  assert.equal(spec.isHeadroomLimited(-27.09, -4.52), true);
  assert.equal(spec.isHeadroomLimited(-10.78, 4.77), false, '줄이는 쪽은 피크 제한이 아니다');
  assert.equal(spec.isHeadroomLimited(-30, -40), false);
  // 어떤 측정값이 와도 보정한 피크가 한도(0 dBFS)를 넘지 않는다(±24 dB 한도에 걸리지 않는 범위에서).
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2000; i += 1) {
    const rms = -60 + random() * 55;
    const peak = rms + 8 + random() * 22;
    const trim = spec.trimDbFor(rms, -20, peak);
    if (Math.abs(trim) < spec.PRESET_TRIM_LIMIT_DB) {
      assert.ok(spec.limiterReductionDb(peak + trim) <= spec.PRESET_MAX_LIMITER_REDUCTION_DB + 1e-9, `rms ${rms} peak ${peak} trim ${trim}`);
      assert.ok(rms + trim <= -20 + 0.05 + 1e-9, '평균이 목표를 넘지 않는다');
    }
  }

  assert.equal(spec.limiterReductionDb(-3), 0, '천장 아래면 감소 없음');
  assert.equal(spec.limiterReductionDb(-1), 0);
  assert.ok(Math.abs(spec.limiterReductionDb(-0.2) - 0.8) < 1e-12, '천장(−1)을 0.8 dB 넘으면 0.8 dB');

  assert.equal(spec.formatTrimDb(3.44), '+3.4 dB');
  assert.equal(spec.formatTrimDb(-2), '−2.0 dB');
  assert.equal(spec.formatTrimDb(0), '0.0 dB');
  assert.equal(spec.formatTrimDb(-0.04), '0.0 dB', '반올림하면 0 인 값은 부호 없이');
  assert.equal(spec.formatTrimDb(99), '+24.0 dB');

  // 측정 함수: 사인파 RMS 는 피크보다 3.01 dB 낮다. 채널을 합칠 때는 전력 평균이다.
  const sine = new Float32Array(48000);
  for (let i = 0; i < sine.length; i += 1) sine[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
  assert.ok(Math.abs(spec.peakDbfs([sine]) - 20 * Math.log10(0.5)) < 1e-6);
  assert.ok(Math.abs(spec.stereoRmsDbfs([sine, sine]) - (20 * Math.log10(0.5) - 3.0103)) < 1e-3);
  assert.ok(Math.abs(spec.stereoRmsDbfs([sine, new Float32Array(sine.length)]) - (spec.stereoRmsDbfs([sine]) - 3.0103)) < 1e-3, '한쪽이 무음이면 전력이 절반');
  assert.equal(spec.stereoRmsDbfs([new Float32Array(100)]), -200, '무음은 바닥값');

  // -------------------------------------------------------------------------------------------
  // 2. 기준 신호 REF-PC: 옮겨 간 뒤에도 비트 단위로 같다. 팩토리 trim 이 이 신호로 계산됐다.
  // -------------------------------------------------------------------------------------------
  const hashOf = (samples) => createHash('sha256').update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)).digest('hex').slice(0, 16);
  const expectedHashes = [
    [44100, 8, 'a4615c5d4770e7b7'],
    [48000, 8, '6bb2d28fc9ff3065'],
    [48000, 2, 'b193fe276583e110'],
    [44100, 4, '0c91e0b87488fbc8'],
  ];
  for (const [rate, seconds, hash] of expectedHashes) {
    assert.equal(hashOf(reference.refPc(rate, seconds)), hash, `REF-PC(${rate} Hz, ${seconds}초)가 바뀌었습니다. 신호를 바꾸면 팩토리 trim 을 다시 계산해야 합니다(npm run trims).`);
    assert.equal(hashOf(signals.refPc(rate, seconds)), hash, '오디오 프로브가 쓰는 REF-PC 도 같은 신호여야 한다');
  }
  assert.ok(Math.abs(spec.peakDbfs([reference.refPc(48000)]) - reference.REF_PC_PEAK_DB) < 0.01, 'REF-PC 입력 피크 −12 dBFS');

  // -------------------------------------------------------------------------------------------
  // 3. 팩토리 trim 파일이 지금 기준과 맞는다
  // -------------------------------------------------------------------------------------------
  const trimsFile = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../src/presets/factoryTrims.json', import.meta.url), 'utf8'));
  const regenerate = 'npm run trims 로 factoryTrims.json 을 다시 만들어 커밋하세요.';
  assert.equal(trimsFile.targetRmsDbfs, spec.PRESET_TARGET_RMS_DBFS, `목표 음량이 바뀌었습니다. ${regenerate}`);
  assert.equal(trimsFile.toleranceDb, spec.PRESET_TARGET_TOLERANCE_DB);
  assert.deepEqual(trimsFile.offsetsDb, spec.PRESET_TARGET_OFFSETS_DB, `D6 예외가 바뀌었습니다. ${regenerate}`);
  assert.equal(trimsFile.maxLimiterReductionDb, spec.PRESET_MAX_LIMITER_REDUCTION_DB, `리미터 허용 감소량이 바뀌었습니다. ${regenerate}`);
  const factoryIds = defaultPresets.map((preset) => preset.id);
  assert.equal(factoryIds.length, 40);
  assert.deepEqual(Object.keys(trimsFile.trims).sort(), [...factoryIds].sort(), `팩토리 프리셋 목록과 trim 목록이 다릅니다. ${regenerate}`);
  assert.ok(Array.isArray(trimsFile.peakLimited), 'peakLimited 목록이 있어야 합니다.');
  for (const id of trimsFile.peakLimited) assert.ok(factoryIds.includes(id), `peakLimited 의 ${id} 가 팩토리 프리셋이 아닙니다.`);
  assert.equal(new Set(trimsFile.peakLimited).size, trimsFile.peakLimited.length, 'peakLimited 에 같은 프리셋이 두 번 있습니다.');
  for (const [id, trim] of Object.entries(trimsFile.trims)) {
    assert.equal(typeof trim, 'number', id);
    assert.ok(Math.abs(trim) <= spec.PRESET_TRIM_LIMIT_DB, `${id}: ±24 dB 를 넘는 trim`);
    assert.equal(spec.roundTrimDb(trim), trim, `${id}: 0.1 dB 단위가 아닌 trim`);
  }
  for (const preset of defaultPresets) {
    assert.equal(preset.trimDb, trimsFile.trims[preset.id], `${preset.id}: 팩토리 프리셋의 trimDb 가 파일과 다릅니다.`);
  }

  // -------------------------------------------------------------------------------------------
  // 4. 작업 중인 보정값(pedalStore): 저장·복원·0 이면 필드 없음·이상한 값은 0
  // -------------------------------------------------------------------------------------------
  assert.equal(pedalStore().presetTrimDb, 0, '처음에는 보정 없음');

  pedalStore().setPresetTrimDb(3.44);
  assert.equal(pedalStore().presetTrimDb, 3.4, '0.1 dB 단위로 정리');
  assert.equal(lastPedalWrite().presetTrimDb, 3.4, '페달 저장본에 같이 저장된다');
  assert.equal(lastPedalWrite().version, SCHEMA_VERSION, '선택 필드라 스키마 버전은 그대로');
  assert.equal(lastPedalWrite().pedals.length, initialPedals.length);

  pedalStore().setPresetTrimDb(99);
  assert.equal(pedalStore().presetTrimDb, 24);
  pedalStore().setPresetTrimDb(-99);
  assert.equal(pedalStore().presetTrimDb, -24);
  pedalStore().setPresetTrimDb(Number.NaN);
  assert.equal(pedalStore().presetTrimDb, 0);
  assert.ok(!('presetTrimDb' in lastPedalWrite()), '보정이 0 이면 필드를 쓰지 않는다(이전 버전과 같은 모양)');

  // 불러오기: 저장된 값이 돌아온다
  pedalStore().setPresetTrimDb(2.5);
  usePedalStore.setState({ presetTrimDb: 9 });
  pedalStore().loadPedalsFromStorage();
  assert.equal(pedalStore().presetTrimDb, 2.5, '다시 열면 마지막 보정값이 돌아온다');

  // 이전 버전이 쓴 저장본(필드 없음)과 이상한 값
  for (const [label, payload, expected] of [
    ['필드 없음(이전 버전)', { version: SCHEMA_VERSION, pedals: [] }, 0],
    ['문자열', { version: SCHEMA_VERSION, pedals: [], presetTrimDb: '5' }, 0],
    ['null', { version: SCHEMA_VERSION, pedals: [], presetTrimDb: null }, 0],
    ['한도 초과', { version: SCHEMA_VERSION, pedals: [], presetTrimDb: 99 }, 24],
    ['정상', { version: SCHEMA_VERSION, pedals: [], presetTrimDb: -6.5 }, -6.5],
    ['옛 배열 형식', [], 0],
  ]) {
    storageValues.set(PEDAL_KEY, JSON.stringify(payload));
    usePedalStore.setState({ presetTrimDb: 9 });
    pedalStore().loadPedalsFromStorage();
    assert.equal(pedalStore().presetTrimDb, expected, `저장본 ${label}`);
  }

  // 마이그레이션은 페달만 다시 만든다. 보정값은 이어 붙는다.
  assert.equal(migrateStoredState({ version: 3, pedals: [], presetTrimDb: 2 }).presetTrimDb, 2, '옛 버전 저장본의 보정값 유지');
  assert.ok(!('presetTrimDb' in migrateStoredState({ version: SCHEMA_VERSION, pedals: [] })));
  assert.ok(!('presetTrimDb' in migrateStoredState({ version: 3, pedals: [] })));

  // setPedals: 보정을 주면 같이 바꾸고, 안 주면 그대로 둔다(탭 템포·실행 취소 같은 호출이 보정을 지우지 않는다)
  pedalStore().setPresetTrimDb(4);
  pedalStore().setPedals(clonePedals(initialPedals));
  assert.equal(pedalStore().presetTrimDb, 4);
  pedalStore().setPedals(clonePedals(initialPedals), -5);
  assert.equal(pedalStore().presetTrimDb, -5);
  assert.equal(lastPedalWrite().presetTrimDb, -5);

  // 노브를 돌려 늦게 저장되는 경우에도 보정이 같이 저장된다
  pedalStore().updatePedalParam('delay', 'bpm', 133);
  await delay(400);
  assert.equal(lastPedalWrite().presetTrimDb, -5, '지연 저장에도 보정값이 들어간다');
  assert.equal(lastPedalWrite().pedals.find((pedal) => pedal.id === 'delay').params.bpm, 133);

  // 기본 보드로 되돌리면 보정도 0
  pedalStore().resetPedalOrder();
  assert.equal(pedalStore().presetTrimDb, 0);
  assert.ok(!('presetTrimDb' in lastPedalWrite()));

  // -------------------------------------------------------------------------------------------
  // 5. 프리셋(presetStore): 팩토리·저장·내보내기·가져오기·불러오기
  // -------------------------------------------------------------------------------------------
  const factory = defaultPresets.find((preset) => preset.id === 'factory-texas-push');
  const quiet = defaultPresets.find((preset) => preset.id === 'factory-funk-comp');
  assert.ok(factory.trimDb < 0, '크게 나는 드라이브 프리셋은 줄인다');
  assert.ok(quiet.trimDb > 0, '작게 나는 클린 프리셋은 키운다');

  applyPresetPedals(factory.pedals, factory.trimDb);
  assert.equal(pedalStore().presetTrimDb, factory.trimDb, '프리셋을 불러오면 보정이 따라온다');
  applyPresetPedals(quiet.pedals, quiet.trimDb);
  assert.equal(pedalStore().presetTrimDb, quiet.trimDb);
  applyPresetPedals(quiet.pedals);
  assert.equal(pedalStore().presetTrimDb, 0, '보정이 없는 프리셋을 불러오면 앞 프리셋의 보정이 남지 않는다');

  // 저장: 지금 보정을 함께 저장한다. 0 이면 필드가 없다.
  pedalStore().setPresetTrimDb(3.2);
  presetStore().savePreset('보정 있는 프리셋', pedalStore().pedals);
  const saved = presetStore().presets.find((preset) => preset.name === '보정 있는 프리셋');
  assert.equal(saved.trimDb, 3.2);
  pedalStore().setPresetTrimDb(0);
  presetStore().savePreset('보정 없는 프리셋', pedalStore().pedals);
  assert.ok(!('trimDb' in presetStore().presets.find((preset) => preset.name === '보정 없는 프리셋')), '0 이면 필드를 두지 않는다');
  presetStore().savePreset('직접 지정', pedalStore().pedals, -4);
  assert.equal(presetStore().presets.find((preset) => preset.name === '직접 지정').trimDb, -4, '세 번째 인자가 우선');

  // 내보내기·가져오기
  const exported = JSON.parse(presetStore().exportPresets());
  assert.equal(exported.presets.find((preset) => preset.name === '보정 있는 프리셋').trimDb, 3.2);
  assert.ok(!('trimDb' in exported.presets.find((preset) => preset.name === '보정 없는 프리셋')));
  const base = { id: 'x', name: 'n', updatedAt: 1, pedals: [] };
  const parsed = (trimDb) => parsePresetJson(JSON.stringify({ version: SCHEMA_VERSION, presets: [{ ...base, ...(trimDb === undefined ? {} : { trimDb }) }] }))[0];
  assert.ok(!('trimDb' in parsed(undefined)), '이전 버전이 내보낸 파일(필드 없음)은 보정 없음');
  assert.equal(parsed(5).trimDb, 5);
  assert.equal(parsed(99).trimDb, 24, '한도 초과는 24 로');
  assert.ok(!('trimDb' in parsed('5')), '숫자가 아니면 필드를 두지 않는다');
  assert.ok(!('trimDb' in parsed(null)));
  assert.ok(!('trimDb' in parsed(0)), '0 은 필드 없음과 같다');

  // 다시 읽어도 유지
  presetStore().reloadPresets();
  assert.equal(presetStore().presets.find((preset) => preset.name === '보정 있는 프리셋').trimDb, 3.2);

  // -------------------------------------------------------------------------------------------
  // 6. A/B 슬롯: 페달과 보정이 한 쌍으로 따라다닌다
  // -------------------------------------------------------------------------------------------
  usePresetStore.setState({ slotA: null, slotB: null, slotATrimDb: 0, slotBTrimDb: 0, activeSlot: 'A' });
  applyPresetPedals(factory.pedals, factory.trimDb);
  presetStore().captureCurrentToSlot('A');
  applyPresetPedals(quiet.pedals, quiet.trimDb);
  presetStore().captureCurrentToSlot('B');
  assert.equal(presetStore().slotATrimDb, factory.trimDb);
  assert.equal(presetStore().slotBTrimDb, quiet.trimDb);
  assert.equal(presetStore().activateSlot('A'), true);
  assert.equal(pedalStore().presetTrimDb, factory.trimDb, 'A 슬롯을 켜면 A 의 보정이 온다');
  assert.equal(presetStore().activateSlot('B'), true);
  assert.equal(pedalStore().presetTrimDb, quiet.trimDb, 'B 슬롯을 켜면 B 의 보정이 온다');
  const abExport = JSON.parse(presetStore().exportPresets());
  assert.ok(!JSON.stringify(abExport).includes('slotATrimDb'), '슬롯 값은 내보내지 않는다(세션 한정)');

  // -------------------------------------------------------------------------------------------
  // 7. 실행 취소·다시 실행: 페달과 보정을 함께 되돌린다
  // -------------------------------------------------------------------------------------------
  applyPresetPedals(quiet.pedals, quiet.trimDb);
  history().clear();
  applyPresetPedals(factory.pedals, factory.trimDb);
  assert.equal(history().past.length, 1, '프리셋 불러오기는 한 단계');
  history().undo();
  assert.equal(pedalStore().presetTrimDb, quiet.trimDb, '되돌리면 앞 프리셋의 보정으로 돌아온다');
  assert.deepEqual(pedalStore().pedals, clonePedals(quiet.pedals));
  history().redo();
  assert.equal(pedalStore().presetTrimDb, factory.trimDb, '다시 실행하면 새 프리셋의 보정으로 간다');
  assert.deepEqual(pedalStore().pedals, clonePedals(factory.pedals));

  // 보정만 바꾼 편집('음량 맞추기')도 한 단계다
  history().clear();
  const before = pedalStore().presetTrimDb;
  pedalStore().setPresetTrimDb(before + 2);
  assert.equal(history().past.length, 1, '보정만 바뀌어도 기록한다');
  history().undo();
  assert.equal(pedalStore().presetTrimDb, before);
  history().redo();
  assert.equal(pedalStore().presetTrimDb, spec.roundTrimDb(before + 2));

  // 같은 노브를 계속 돌리면 한 단계(보정이 그대로일 때만)
  history().clear();
  pedalStore().updatePedalParam('delay', 'bpm', 111);
  pedalStore().updatePedalParam('delay', 'bpm', 112);
  assert.equal(history().past.length, 1);

  // -------------------------------------------------------------------------------------------
  // 8. 엔진: 보정값을 trim 노드에 램프로 건넨다
  // -------------------------------------------------------------------------------------------
  assert.doesNotThrow(() => engine.setPresetTrimDb(6), '오디오가 없으면 아무 일도 하지 않는다');
  const events = [];
  const gain = {
    value: 1,
    cancelAndHoldAtTime: (time) => events.push(['hold', time]),
    linearRampToValueAtTime: (value, time) => events.push(['ramp', value, time]),
  };
  const savedContext = engine.context;
  const savedOutputStage = engine.outputStage;
  engine.context = { currentTime: 2, state: 'running' };
  engine.outputStage = { presetTrim: { gain }, input: { gain: {} }, output: {}, dispose() {} };
  try {
    engine.setPresetTrimDb(6);
    assert.deepEqual(events[0], ['hold', 2]);
    assert.equal(events[1][0], 'ramp');
    assert.ok(Math.abs(events[1][1] - 10 ** (6 / 20)) < 1e-12, '+6 dB 는 이득 1.995');
    assert.ok(Math.abs(events[1][2] - (2 + spec.PRESET_TRIM_RAMP_SECONDS)) < 1e-12, '30 ms 램프');
    engine.setPresetTrimDb(99);
    assert.ok(Math.abs(events.at(-1)[1] - 10 ** (24 / 20)) < 1e-12, '한도 +24 dB');
    engine.setPresetTrimDb(Number.NaN);
    assert.equal(events.at(-1)[1], 1, '숫자가 아니면 0 dB');
    const count = events.length;
    engine.context.state = 'closed';
    engine.setPresetTrimDb(3);
    assert.equal(events.length, count, '닫힌 컨텍스트에는 건드리지 않는다');
  } finally {
    engine.context = savedContext;
    engine.outputStage = savedOutputStage;
  }
  engine.setPresetTrimProvider(() => -3);
  assert.equal(engine.getPresetTrimDb(), -3, '그래프를 만들 때 읽을 값 공급자');
  engine.setPresetTrimProvider(() => 0);
} finally {
  engine.rebuildChain = originalRebuildChain;
}

console.log('Preset loudness regression passed: spec formulas, REF-PC hash pinning, factoryTrims.json consistency, trim persistence (save/restore/migrate/legacy), preset save/export/import, A/B slots, undo/redo and engine ramp.');
