import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const [effectSource, engineSource, pedalSource, faderSource, cardSource, iconSource, styleSource] =
  await Promise.all([
    readFile(new URL('../src/audio/nodes/GraphicEQEffect.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/audio/AudioEngine.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/effects/GraphicEQPedal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/VerticalFader.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PedalCard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PedalIcon.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/pedals.css', import.meta.url), 'utf8'),
  ]);

assert.match(
  effectSource,
  /GRAPHIC_EQ_FREQUENCIES = \[100, 200, 400, 800, 1600, 3200, 6400\] as const/,
);
assert.match(effectSource, /export const GRAPHIC_EQ_Q = 1\.4;/);
assert.match(effectSource, /type: 'peaking'/);
assert.match(effectSource, /Q: GRAPHIC_EQ_Q/);
assert.doesNotMatch(effectSource, /\.value\s*=/, 'AudioParam 직접 대입이 있습니다.');
assert.match(effectSource, /this\.effectInput\.connect\(this\.filters\[0\]\)/);
assert.match(effectSource, /this\.filters\[index\]\.connect\(this\.filters\[index \+ 1\]\)/);
assert.match(effectSource, /this\.filters\[this\.filters\.length - 1\]\.connect\(this\.effectOutput\)/);

const updateStart = effectSource.indexOf('override update(');
const disposeStart = effectSource.indexOf('override dispose(');
assert.ok(updateStart >= 0 && disposeStart > updateStart, 'update/dispose 구현을 찾을 수 없습니다.');
const updateSource = effectSource.slice(updateStart, disposeStart);
assert.doesNotMatch(updateSource, /new\s+(?:Gain|BiquadFilter)Node/, 'update 중 노드를 재생성합니다.');
assert.match(updateSource, /smoothParam\(filter\.gain, params\[GRAPHIC_EQ_BAND_KEYS\[index\]\], this\.context\)/);
assert.match(effectSource, /if \(this\.disposed\) return;/);
assert.match(effectSource, /this\.filters\.forEach\(\(filter\) => filter\.disconnect\(\)\)/);

assert.match(engineSource, /import \{ GraphicEQEffect \} from '.\/nodes\/GraphicEQEffect';/);
assert.match(engineSource, /case 'graphicEQ':[\s\S]*return new GraphicEQEffect\(this\.context, pedal\);/);
assert.equal([...pedalSource.matchAll(/\{ key: 'band(?:100|200|400|800|1600|3200|6400)'/g)].length, 7);
assert.equal([...pedalSource.matchAll(/<VerticalFader/g)].length, 1, '밴드 map은 VerticalFader 하나만 렌더해야 합니다.');
assert.match(pedalSource, /min=\{-12\}/);
assert.match(pedalSource, /max=\{12\}/);
assert.match(pedalSource, /step=\{0\.5\}/);
assert.match(pedalSource, /ariaValueText=\{`\$\{frequency\} 헤르츠, \$\{shownValue\}`\}/);
assert.doesNotMatch(pedalSource, /SliderControl/, '기존 SliderControl을 재사용했습니다.');
assert.match(faderSource, /type="range"/);
assert.match(faderSource, /aria-orientation="vertical"/);
assert.match(faderSource, /aria-valuetext=\{`\$\{label\} \$\{ariaValueText\}`\}/);
assert.match(faderSource, /onChange=\{\(event\) => onChange\(Number\(event\.currentTarget\.value\)\)\}/);
assert.doesNotMatch(faderSource, /tabIndex=\{-1\}/, '키보드 접근이 차단되었습니다.');
assert.match(cardSource, /'graphicEQ'/);
assert.match(cardSource, /pedal-card-graphic-eq/);
assert.match(cardSource, /<GraphicEQPedal/);
assert.match(iconSource, /case 'graphicEQ':/);
assert.match(styleSource, /\.pedal-card-graphic-eq/);
assert.match(styleSource, /\.graphic-eq7-fader-bank/);
assert.match(styleSource, /\.vertical-fader input:focus-visible/);

const effectBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/GraphicEQEffect.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectBundle.outputFiles[0].text).toString('base64')}`;

class MockAudioParam {
  constructor(value) {
    this.value = value;
    this.targetCount = 0;
  }

  cancelScheduledValues() {}

  cancelAndHoldAtTime() {}

  setValueAtTime(value) {
    this.value = value;
  }

  setTargetAtTime(value) {
    this.value = value;
    this.targetCount += 1;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }
}

class MockAudioNode {
  constructor() {
    this.connections = [];
    this.disconnectCount = 0;
  }

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnectCount += 1;
    this.connections = [];
  }
}

class MockGainNode extends MockAudioNode {
  constructor(_context, options = {}) {
    super();
    this.gain = new MockAudioParam(options.gain ?? 1);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(_context, options = {}) {
    super();
    this.type = options.type ?? 'lowpass';
    this.frequency = new MockAudioParam(options.frequency ?? 350);
    this.Q = new MockAudioParam(options.Q ?? 1);
    this.gain = new MockAudioParam(options.gain ?? 0);
  }
}

Object.assign(globalThis, {
  GainNode: MockGainNode,
  BiquadFilterNode: MockBiquadFilterNode,
});

const {
  GRAPHIC_EQ_BAND_KEYS,
  GRAPHIC_EQ_FREQUENCIES,
  GRAPHIC_EQ_Q,
  GraphicEQEffect,
  normalizeGraphicEQParams,
} = await import(effectUrl);

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

assert.deepEqual(GRAPHIC_EQ_FREQUENCIES, [100, 200, 400, 800, 1600, 3200, 6400]);
assert.deepEqual(GRAPHIC_EQ_BAND_KEYS, [
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

const context = {
  currentTime: 0.25,
  createGain: () => new MockGainNode(),
};
const pedal = {
  id: 'graphic-eq',
  type: 'graphicEQ',
  name: 'Graphic EQ',
  enabled: true,
  bypassed: false,
  color: '#4a5b7a',
  params: defaultParams,
};
const effect = new GraphicEQEffect(context, pedal);
const originalFilters = [...effect.filters];

assert.equal(effect.filters.length, 7, 'BiquadFilterNode가 정확히 7개가 아닙니다.');
effect.filters.forEach((filter, index) => {
  assert.equal(filter.type, 'peaking', `${index}: peaking 타입`);
  assert.equal(filter.frequency.value, GRAPHIC_EQ_FREQUENCIES[index], `${index}: 주파수 순서`);
  assert.equal(filter.Q.value, GRAPHIC_EQ_Q, `${index}: 고정 Q`);
  assert.equal(filter.gain.value, 0, `${index}: 기본 gain`);
  assert.ok(filter.gain.targetCount >= 1, `${index}: 초기 gain smoothParam`);
});
assert.ok(effect.effectInput.connections.includes(effect.filters[0]), 'effectInput → 첫 밴드');
for (let index = 0; index < effect.filters.length - 1; index += 1) {
  assert.ok(
    effect.filters[index].connections.includes(effect.filters[index + 1]),
    `${index}: 직렬 밴드 연결`,
  );
}
assert.ok(effect.filters.at(-1).connections.includes(effect.effectOutput), '마지막 밴드 → effectOutput');

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
assert.deepEqual(
  effect.filters.map((filter) => filter.gain.value),
  [-12, 12, -9, 7, 0, 0, 4.5],
);
assert.ok(effect.filters.every((filter) => filter.gain.targetCount >= 2), 'gain smoothing 누락');
assert.ok(effect.filters.every((filter) => Number.isFinite(filter.gain.value)), 'gain NaN 차단');

effect.dispose();
effect.dispose();
assert.ok(effect.filters.every((filter) => filter.disconnectCount === 1), '필터 dispose 불완전');

const migrationBundle = await build({
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
