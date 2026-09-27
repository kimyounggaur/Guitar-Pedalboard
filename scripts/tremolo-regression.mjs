import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const effectSource = await readFile(
  new URL('../src/audio/nodes/TremoloEffect.ts', import.meta.url),
  'utf8',
);

assert.match(effectSource, /export const TREMOLO_LFO_BANK_SIZE = TREMOLO_SHAPES\.length;/);
assert.match(effectSource, /export const TREMOLO_SQUARE_SLEW_SECONDS = 0\.001;/);
assert.match(effectSource, /type: 'lowpass'/);
assert.match(effectSource, /frequency: TREMOLO_SQUARE_SLEW_FREQUENCY/);
assert.match(effectSource, /oscillator\.connect\(slewFilter\);/);
assert.match(effectSource, /slewFilter\.connect\(modulationGain\);/);
assert.match(effectSource, /modulationGain\.connect\(this\.amplitude\.gain\);/);
assert.doesNotMatch(effectSource, /\.value\s*=/, 'AudioParam 직접 대입이 있습니다.');

const updateStart = effectSource.indexOf('override update(');
const disposeStart = effectSource.indexOf('override dispose(');
assert.ok(updateStart >= 0 && disposeStart > updateStart, 'update/dispose 구현을 찾을 수 없습니다.');
const updateSource = effectSource.slice(updateStart, disposeStart);
assert.doesNotMatch(
  updateSource,
  /new\s+(?:Gain|Delay|Oscillator|StereoPanner|BiquadFilter)Node/,
  'update 중 오디오 노드를 재생성합니다.',
);
assert.match(updateSource, /smoothParam\(this\.amplitude\.gain/);
assert.match(updateSource, /smoothParam\(bank\.oscillator\.frequency/);
assert.match(updateSource, /smoothParam\([\s\S]*bank\.modulationGain\.gain/);
assert.match(effectSource, /const lfoStartTime = context\.currentTime;/);
assert.match(effectSource, /oscillator\.start\(lfoStartTime\);/);
assert.match(effectSource, /bank\.oscillator\.stop\(\);/);
assert.match(effectSource, /if \(this\.disposed\) return;/);

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

class MockAudioParam {
  constructor(value) {
    this.value = value;
  }

  cancelScheduledValues() {}

  cancelAndHoldAtTime() {}

  setValueAtTime(value) {
    this.value = value;
  }

  setTargetAtTime(value) {
    this.value = value;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }
}

class MockAudioNode {
  constructor() {
    this.connections = [];
    this.disconnected = false;
  }

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnected = true;
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
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor(_context, options = {}) {
    super();
    this.type = options.type ?? 'sine';
    this.frequency = new MockAudioParam(options.frequency ?? 440);
    this.startTimes = [];
    this.stopCount = 0;
  }

  start(time) {
    this.startTimes.push(time);
  }

  stop() {
    this.stopCount += 1;
  }
}

Object.assign(globalThis, {
  GainNode: MockGainNode,
  BiquadFilterNode: MockBiquadFilterNode,
  OscillatorNode: MockOscillatorNode,
});

const context = {
  currentTime: 0.25,
  sampleRate: 48_000,
  createGain: () => new MockGainNode(),
};
const pedal = {
  id: 'tremolo',
  type: 'tremolo',
  name: 'Tremolo',
  enabled: true,
  bypassed: false,
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
assert.ok(squareBank.oscillator.connections.includes(squareBank.slewFilter));
assert.ok(squareBank.slewFilter.connections.includes(squareBank.modulationGain));
assert.ok(squareBank.modulationGain.connections.includes(effect.amplitude.gain));
assert.ok(
  originalBanks
    .filter((bank) => bank.shape !== 'square')
    .every((bank) => bank.oscillator.connections.includes(bank.modulationGain)),
);

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
assert.equal(effect.lfoBanks, originalBanks, 'shape 변경 중 LFO bank가 교체되었습니다.');
assert.ok(
  effect.lfoBanks.every((bank, index) => bank.oscillator === originalOscillators[index]),
  'shape 변경 중 oscillator가 재생성되었습니다.',
);
assert.ok(effect.lfoBanks.every((bank) => bank.oscillator.frequency.value === 8));
assert.equal(effect.amplitude.gain.value, 0.5);
assert.deepEqual(effect.lfoBanks.map((bank) => bank.modulationGain.gain.value), [0, 0.5, 0]);

effect.update({
  ...pedal,
  params: { ...defaultParams, depth: 80, shape: 'square' },
});
assert.equal(effect.amplitude.gain.value, 0.6);
assert.deepEqual(effect.lfoBanks.map((bank) => bank.modulationGain.gain.value), [0, 0, 0.4]);

effect.dispose();
effect.dispose();
assert.ok(effect.amplitude.disconnected);
assert.ok(
  effect.lfoBanks.every(
    (bank) =>
      bank.oscillator.stopCount === 1 &&
      bank.oscillator.disconnected &&
      bank.modulationGain.disconnected &&
      (!bank.slewFilter || bank.slewFilter.disconnected),
  ),
);

const migrationBundle = await build({
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
