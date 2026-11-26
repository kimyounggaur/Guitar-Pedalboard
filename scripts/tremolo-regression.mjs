import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';
import { installFakeAudio } from './lib/fake-audio.mjs';

const effectBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/TremoloEffect.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const effectCode = effectBundle.outputFiles[0].text;
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectCode).toString('base64')}`;
const {
  getTremoloGainBounds,
  getTremoloRate,
  normalizeTremoloParams,
  TremoloEffect,
  TREMOLO_DIVISION_BEATS,
  TREMOLO_LFO_BANK_SIZE,
  TREMOLO_SHAPES,
  TREMOLO_SQUARE_SLEW_FREQUENCY,
  TREMOLO_SQUARE_SLEW_SECONDS,
} = await import(effectUrl);

const defaultParams = {
  mix: 100,
  level: 100,
  rate: 5,
  depth: 50,
  shape: 'sine',
  sync: false,
  bpm: 120,
  division: '1/8',
};

assert.deepEqual(TREMOLO_SHAPES, ['sine', 'triangle', 'square']);
assert.equal(TREMOLO_LFO_BANK_SIZE, 3);
assert.equal(TREMOLO_LFO_BANK_SIZE, TREMOLO_SHAPES.length, 'LFO 묶음 수는 모양 수와 같아야 한다');
assert.equal(TREMOLO_SQUARE_SLEW_SECONDS, 0.001);
assert.ok(Math.abs(TREMOLO_SQUARE_SLEW_FREQUENCY - 1 / (Math.PI * 2 * 0.001)) < 1e-12);
assert.deepEqual(TREMOLO_DIVISION_BEATS, {
  '1/4': 1,
  '1/8': 0.5,
  'dotted1/8': 0.75,
  '1/16': 0.25,
});

assert.deepEqual(
  normalizeTremoloParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    shape: 'invalid',
    sync: 'invalid',
    bpm: Number.NaN,
    division: '__proto__',
  }),
  defaultParams,
);
assert.deepEqual(
  normalizeTremoloParams({
    ...defaultParams,
    mix: -10,
    level: 500,
    rate: 100,
    depth: 500,
    shape: 'square',
    sync: true,
    bpm: 1000,
    division: '1/16',
  }),
  {
    mix: 0,
    level: 200,
    rate: 20,
    depth: 100,
    shape: 'square',
    sync: true,
    bpm: 240,
    division: '1/16',
  },
);

assert.equal(getTremoloRate({ ...defaultParams, rate: 7.25 }), 7.25);
assert.equal(getTremoloRate({ ...defaultParams, sync: true, division: '1/4' }), 2);
assert.equal(getTremoloRate({ ...defaultParams, sync: true, division: '1/8' }), 4);
assert.ok(
  Math.abs(
    getTremoloRate({ ...defaultParams, sync: true, division: 'dotted1/8' }) - 8 / 3,
  ) < 1e-12,
);
assert.equal(getTremoloRate({ ...defaultParams, sync: true, division: '1/16' }), 8);
assert.equal(
  getTremoloRate({ ...defaultParams, sync: true, bpm: 1000, division: '1/16' }),
  16,
);

assert.deepEqual(getTremoloGainBounds(0), {
  minimum: 1,
  maximum: 1,
  center: 1,
  modulationDepth: 0,
});
assert.deepEqual(getTremoloGainBounds(50), {
  minimum: 0.5,
  maximum: 1,
  center: 0.75,
  modulationDepth: 0.25,
});
assert.deepEqual(getTremoloGainBounds(100), {
  minimum: 0,
  maximum: 1,
  center: 0.5,
  modulationDepth: 0.5,
});
for (const depth of [Number.NaN, -1000, 0, 25, 50, 100, 1000]) {
  const bounds = getTremoloGainBounds(depth);
  assert.ok(bounds.minimum >= 0, `${depth}: minimum gain`);
  assert.ok(bounds.maximum <= 1, `${depth}: maximum gain`);
  assert.ok(bounds.center - bounds.modulationDepth >= 0, `${depth}: lower modulation bound`);
  assert.ok(bounds.center + bounds.modulationDepth <= 1, `${depth}: upper modulation bound`);
}

// 진짜 TremoloEffect 를 가짜 오디오 노드 위에서 돌린다(S4.7: 소스 글자 검사 대신 노드 그래프와 파라미터 기록을 본다).
const fake = installFakeAudio();
const context = fake.createContext({ currentTime: 0.25 });
const pedal = {
  id: 'tremolo',
  type: 'tremolo',
  name: 'Tremolo',
  active: true,
  color: '#c98a3f',
  params: defaultParams,
};
const effect = new TremoloEffect(context, pedal);
const originalBanks = effect.lfoBanks;
const originalOscillators = originalBanks.map((bank) => bank.oscillator);

assert.deepEqual(originalBanks.map((bank) => bank.shape), ['sine', 'triangle', 'square']);
assert.deepEqual(originalBanks.map((bank) => bank.oscillator.type), [
  'sine',
  'triangle',
  'square',
]);
assert.ok(originalOscillators.every((oscillator) => oscillator.startTimes[0] === 0.25));
assert.equal(effect.amplitude.gain.value, 0.75);
assert.deepEqual(originalBanks.map((bank) => bank.modulationGain.gain.value), [0.25, 0, 0]);

const squareBank = originalBanks.find((bank) => bank.shape === 'square');
assert.ok(squareBank.slewFilter, 'square slew filter가 없습니다.');
assert.equal(squareBank.slewFilter.type, 'lowpass');
assert.equal(squareBank.slewFilter.Q.value, 0.5);
assert.equal(squareBank.slewFilter.frequency.value, TREMOLO_SQUARE_SLEW_FREQUENCY);
// 사각파는 오실레이터 → 슬루 필터 → 변조 게인 → 진폭 게인의 gain 파라미터(진폭 변조), 나머지는 슬루 필터 없이 바로 변조 게인으로 간다.
assert.ok(squareBank.oscillator.connectsTo(squareBank.slewFilter));
assert.ok(!squareBank.oscillator.connectsTo(squareBank.modulationGain), '사각파가 슬루 필터를 건너뛰었다');
assert.ok(squareBank.slewFilter.connectsTo(squareBank.modulationGain));
assert.ok(squareBank.modulationGain.connectsTo(effect.amplitude.gain));
for (const bank of originalBanks.filter((entry) => entry.shape !== 'square')) {
  assert.ok(bank.oscillator.connectsTo(bank.modulationGain), `${bank.shape}: 오실레이터 → 변조 게인`);
  assert.ok(bank.modulationGain.connectsTo(effect.amplitude.gain), `${bank.shape}: 변조 게인 → 진폭 게인의 gain`);
  assert.equal(bank.slewFilter, null, `${bank.shape}: 슬루 필터 없음`);
}
// 입력 → 진폭 게인 → 출력 길이 이어져 있다(진폭 게인이 소리 길 위에 있다).
assert.ok(fake.pathExists(effect.effectInput, effect.amplitude), '입력 → 진폭 게인');
assert.ok(fake.pathExists(effect.amplitude, effect.effectOutput), '진폭 게인 → 출력');
const nodesAfterBuild = fake.nodeCount;
// 직접 대입은 BaseEffect 가 연결 전에 초기값을 놓을 때뿐이다(그 뒤로는 늘면 안 된다).
const directAssignmentsAfterBuild = fake.directAssignments();

effect.update({
  ...pedal,
  params: {
    ...defaultParams,
    depth: 100,
    shape: 'triangle',
    sync: true,
    division: '1/16',
  },
});
assert.equal(fake.nodeCount, nodesAfterBuild, 'update 중 오디오 노드를 새로 만들었다');
assert.equal(effect.lfoBanks, originalBanks, 'shape 변경 중 LFO bank가 교체되었습니다.');
assert.ok(
  effect.lfoBanks.every((bank, index) => bank.oscillator === originalOscillators[index]),
  'shape 변경 중 oscillator가 재생성되었습니다.',
);
assert.ok(effect.lfoBanks.every((bank) => bank.oscillator.frequency.value === 8));
assert.equal(effect.amplitude.gain.value, 0.5);
assert.deepEqual(effect.lfoBanks.map((bank) => bank.modulationGain.gain.value), [0, 0.5, 0]);

// update 는 파라미터를 `.value =` 로 곧바로 쓰지 않고 예약 메서드로 부드럽게 옮긴다(곧바로 쓰면 클릭 소리가 난다).
for (const param of [effect.amplitude.gain, ...effect.lfoBanks.flatMap((bank) => [bank.oscillator.frequency, bank.modulationGain.gain])]) {
  assert.equal(param.directAssignments, 0, '파라미터에 직접 대입했다');
  assert.equal(param.automation.at(-1).kind, 'target', 'update 의 마지막 쓰기는 setTargetAtTime 이어야 한다');
}
assert.equal(fake.directAssignments(), directAssignmentsAfterBuild, 'update 가 파라미터에 직접 대입했다');

effect.update({
  ...pedal,
  params: { ...defaultParams, depth: 80, shape: 'square' },
});
assert.equal(effect.amplitude.gain.value, 0.6);
assert.deepEqual(effect.lfoBanks.map((bank) => bank.modulationGain.gain.value), [0, 0, 0.4]);

effect.dispose();
const disconnectCountsAfterFirstDispose = fake.created().map((node) => node.disconnectCalls);
effect.dispose();
assert.deepEqual(
  fake.created().map((node) => node.disconnectCalls),
  disconnectCountsAfterFirstDispose,
  '두 번째 dispose 가 노드를 또 끊었다',
);
assert.ok(effect.amplitude.disconnectedAll);
assert.ok(
  effect.lfoBanks.every(
    (bank) =>
      bank.oscillator.stopTimes.length === 1 &&
      bank.oscillator.disconnectedAll &&
      bank.modulationGain.disconnectedAll &&
      (!bank.slewFilter || bank.slewFilter.disconnectedAll),
  ),
);
assert.equal(fake.directAssignments(), directAssignmentsAfterBuild, '시험 내내 직접 대입이 늘면 안 된다');

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

console.log(
  'Tremolo regression passed: schema v8, sync divisions, bounded gain, square slew, fixed shape banks and lifecycle.',
);
