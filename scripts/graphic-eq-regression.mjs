import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { createEngineHarness } from './lib/engine-harness.mjs';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// S4.7: 이펙터·엔진 쪽 단언은 가짜 오디오 위에서 진짜 GraphicEQEffect·AudioEngine 을 돌려 확인한다(아래 '이펙터 동작').
// 화면(JSX·CSS) 쪽 단언은 아래 UI 절에서 따로 확인한다.
const [pedalSource, faderSource, cardSource, iconSource, styleSource] = await Promise.all([
  readFile(new URL('../src/components/effects/GraphicEQPedal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/VerticalFader.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PedalCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PedalIcon.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/pedals.css', import.meta.url), 'utf8'),
]);

assert.match(pedalSource, /min=\{-12\}/);
assert.match(pedalSource, /max=\{12\}/);
assert.match(pedalSource, /step=\{0\.5\}/);
assert.match(pedalSource, /ariaValueText=\{`\$\{frequency\} 헤르츠, \$\{shownValue\}`\}/);
assert.doesNotMatch(pedalSource, /SliderControl/, '기존 SliderControl을 재사용했습니다.');
assert.match(faderSource, /type="range"/);
assert.match(faderSource, /aria-orientation="vertical"/);
assert.match(faderSource, /aria-valuetext=\{`\$\{accessibleName\} \$\{ariaValueText\}`\}/);
assert.match(faderSource, /onChange=\{\(event\) => onChange\(Number\(event\.currentTarget\.value\)\)\}/);
assert.doesNotMatch(faderSource, /tabIndex=\{-1\}/, '키보드 접근이 차단되었습니다.');
assert.match(cardSource, /'graphicEQ'/);
assert.match(cardSource, /pedal-card-graphic-eq/);
assert.match(cardSource, /<GraphicEQPedal/);
assert.match(iconSource, /case 'graphicEQ':/);
assert.match(styleSource, /\.pedal-card-graphic-eq/);
assert.match(styleSource, /\.graphic-eq7-fader-bank/);
assert.match(styleSource, /\.vertical-fader-rail input:focus-visible/);
// F-1: 레일 안의 range 입력만 투명 오버레이로 만든다. 같은 칸의 숫자 입력(input.knob-number-input)이 화면을 덮으면 안 된다.
assert.doesNotMatch(styleSource, /\.vertical-fader input\s*[,{]/, '`.vertical-fader input` 규칙이 숫자 입력까지 투명 오버레이로 만듭니다(F-1).');
assert.match(styleSource, /\.vertical-fader\s*\{\s*position:\s*relative;/, '.vertical-fader 가 숫자 입력의 기준 상자가 아닙니다(F-1).');
assert.match(
  styleSource,
  /\.vertical-fader > \.knob-number-input\s*\{[^}]*position:\s*absolute;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/,
  '그래픽 EQ 숫자 입력이 포인터를 받지 않는 칸 안의 요소여야 합니다(F-1).',
);

// 이펙터 동작: 진짜 GraphicEQEffect·AudioEngine 을 가짜 오디오 위에서 돌린다.
const harness = await createEngineHarness({
  extraExports: [
    `{
      GRAPHIC_EQ_BAND_KEYS,
      GRAPHIC_EQ_FREQUENCIES,
      GRAPHIC_EQ_Q,
      GraphicEQEffect,
      normalizeGraphicEQParams,
    } from './audio/nodes/GraphicEQEffect.ts'`,
  ],
});
const { fake, engine, context } = harness;
const { GRAPHIC_EQ_BAND_KEYS, GRAPHIC_EQ_FREQUENCIES, GRAPHIC_EQ_Q, GraphicEQEffect, normalizeGraphicEQParams } =
  harness.exports;

const defaultParams = {
  mix: 100,
  level: 100,
  band100: 0,
  band200: 0,
  band400: 0,
  band800: 0,
  band1600: 0,
  band3200: 0,
  band6400: 0,
};

const EXPECTED_FREQUENCIES = [100, 200, 400, 800, 1600, 3200, 6400];
assert.deepEqual([...GRAPHIC_EQ_FREQUENCIES], EXPECTED_FREQUENCIES);
assert.deepEqual([...GRAPHIC_EQ_BAND_KEYS], [
  'band100',
  'band200',
  'band400',
  'band800',
  'band1600',
  'band3200',
  'band6400',
]);
assert.equal(GRAPHIC_EQ_Q, 1.4);
assert.deepEqual(
  normalizeGraphicEQParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    band100: Number.NaN,
    band200: Number.POSITIVE_INFINITY,
    band400: Number.NEGATIVE_INFINITY,
    band800: Number.NaN,
    band1600: Number.POSITIVE_INFINITY,
    band3200: Number.NEGATIVE_INFINITY,
    band6400: Number.NaN,
  }),
  defaultParams,
);
assert.deepEqual(
  normalizeGraphicEQParams({
    mix: -1,
    level: 300,
    band100: -100,
    band200: 100,
    band400: -100,
    band800: 100,
    band1600: -100,
    band3200: 100,
    band6400: -100,
  }),
  {
    mix: 0,
    level: 200,
    band100: -12,
    band200: 12,
    band400: -12,
    band800: 12,
    band1600: -12,
    band3200: 12,
    band6400: -12,
  },
);

context.currentTime = 0.25;
const pedal = {
  id: 'graphic-eq',
  type: 'graphicEQ',
  name: 'Graphic EQ',
  active: true,
  color: '#4a5b7a',
  params: defaultParams,
};
const effect = new GraphicEQEffect(context, pedal);
const originalFilters = [...effect.filters];

// 밴드 일곱 개: 설계값(100·200·400·800·1600·3200·6400 Hz, Q 1.4)을 소스 상수가 아니라 따로 적은 값과 비교한다.
assert.equal(effect.filters.length, 7, 'BiquadFilterNode가 정확히 7개가 아닙니다.');
effect.filters.forEach((filter, index) => {
  assert.equal(filter.type, 'peaking', `${index}: peaking 타입`);
  assert.equal(filter.frequency.value, EXPECTED_FREQUENCIES[index], `${index}: 주파수 순서`);
  assert.equal(filter.frequency.initialValue, EXPECTED_FREQUENCIES[index], `${index}: 만들 때 주파수`);
  assert.equal(filter.Q.value, 1.4, `${index}: 고정 Q`);
  assert.equal(filter.gain.value, 0, `${index}: 기본 gain`);
  assert.equal(filter.gain.automation.at(-1).kind, 'target', `${index}: 초기 gain smoothParam`);
  // AudioParam 직접 대입 금지(클릭 소리): 주파수·Q·gain 은 `.value =` 를 받은 적이 없다.
  for (const param of [filter.frequency, filter.Q, filter.gain]) {
    assert.equal(param.directAssignments, 0, `${index}: ${param.name} AudioParam 직접 대입`);
  }
});
// 직렬 연결: 입력 → 100 → 200 → … → 6400 → 출력. 건너뛰는 길이 없다.
assert.ok(effect.effectInput.connectsTo(effect.filters[0]), 'effectInput → 첫 밴드');
for (let index = 0; index < effect.filters.length - 1; index += 1) {
  assert.ok(effect.filters[index].connectsTo(effect.filters[index + 1]), `${index}: 직렬 밴드 연결`);
  assert.equal(effect.filters[index].edges.length, 1, `${index}: 밴드는 다음 밴드로만 간다`);
}
assert.ok(effect.filters.at(-1).connectsTo(effect.effectOutput), '마지막 밴드 → effectOutput');
assert.ok(fake.pathExists(effect.effectInput, effect.effectOutput));

const nodesBeforeUpdate = fake.nodeCount;
const targetsBefore = effect.filters.map((filter) => filter.gain.automation.filter(({ kind }) => kind === 'target').length);
effect.update({
  ...pedal,
  params: {
    ...defaultParams,
    band100: -100,
    band200: 100,
    band400: -9,
    band800: 7,
    band1600: Number.NaN,
    band3200: Number.POSITIVE_INFINITY,
    band6400: 4.5,
  },
});
assert.deepEqual(effect.filters, originalFilters, 'update 중 필터가 재생성되었습니다.');
assert.equal(fake.nodeCount, nodesBeforeUpdate, 'update 중 노드를 재생성합니다.');
assert.deepEqual(
  effect.filters.map((filter) => filter.gain.value),
  [-12, 12, -9, 7, 0, 0, 4.5],
);
effect.filters.forEach((filter, index) => {
  const targets = filter.gain.automation.filter(({ kind }) => kind === 'target').length;
  assert.equal(targets, targetsBefore[index] + 1, `${index}: update 한 번에 gain 예약이 한 번이어야 합니다.`);
  assert.equal(filter.gain.directAssignments, 0, `${index}: update 가 gain 에 직접 대입했습니다.`);
  assert.equal(filter.frequency.value, EXPECTED_FREQUENCIES[index], `${index}: update 가 주파수를 바꿨습니다.`);
  assert.equal(filter.Q.value, 1.4, `${index}: update 가 Q 를 바꿨습니다.`);
});
assert.ok(effect.filters.every((filter) => Number.isFinite(filter.gain.value)), 'gain NaN 차단');

effect.dispose();
effect.dispose();
assert.ok(effect.filters.every((filter) => filter.disconnectCalls === 1), '필터 dispose 불완전');

// 엔진: 'graphicEQ' 페달은 GraphicEQEffect 로 만들어진다.
const engineEffect = engine.createEffect(pedal);
assert.ok(engineEffect instanceof GraphicEQEffect, "엔진이 'graphicEQ' 페달에 다른 이펙터를 만들었습니다.");
assert.equal(engineEffect.filters.length, 7);
engineEffect.dispose();
harness.restore();

const migrationBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [fileURLToPath(new URL('../src/store/__migration_check.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationBundle.outputFiles[0].text).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log(
  'Graphic EQ regression passed: schema v10, seven fixed peaking bands, Q/gain bounds, smoothing, UI accessibility, factory bypass and lifecycle.',
);
