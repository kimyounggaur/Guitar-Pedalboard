import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const effectSource = await readFile(
  new URL('../src/audio/nodes/PhaserEffect.ts', import.meta.url),
  'utf8',
);

assert.match(effectSource, /export const PHASER_MIN_FREQUENCY = 200;/);
assert.match(effectSource, /export const PHASER_MAX_FREQUENCY = 2000;/);
assert.match(effectSource, /export const PHASER_MAX_FEEDBACK = 0\.9;/);
assert.match(effectSource, /export const PHASER_STAGE_OPTIONS = \[4, 6, 8, 12\] as const;/);
assert.match(effectSource, /type: 'allpass'/);
assert.match(effectSource, /this\.modulationDepth\.connect\(filter\.detune\);/);
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
assert.match(updateSource, /smoothParam\(this\.oscillator\.frequency/);
assert.match(updateSource, /smoothParam\(this\.modulationDepth\.gain/);
assert.match(updateSource, /smoothParam\(bank\.outputGain\.gain/);
assert.match(updateSource, /smoothParam\(bank\.feedbackGain\.gain/);
assert.match(updateSource, /this\.setMakeup\(getPhaserWetMakeup\(feedback\)\);/);

assert.match(effectSource, /feedbackGain\.connect\(feedbackDelay\);/);
assert.match(effectSource, /feedbackDelay\.connect\(filters\[0\]\);/);
assert.match(effectSource, /this\.oscillator\.start\(\);/);
assert.match(effectSource, /this\.oscillator\.stop\(\);/);
assert.match(effectSource, /if \(this\.disposed\) return;/);
assert.match(effectSource, /filter\.disconnect\(\)/);
assert.match(effectSource, /bank\.feedbackDelay\.disconnect\(\);/);

const effectBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/PhaserEffect.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const effectCode = effectBundle.outputFiles[0].text;
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectCode).toString('base64')}`;
const {
  getPhaserSweep,
  getPhaserWetMakeup,
  normalizePhaserParams,
  PhaserEffect,
  PHASER_CENTER_FREQUENCY,
  PHASER_MAX_FEEDBACK,
  PHASER_MAX_FREQUENCY,
  PHASER_MIN_FREQUENCY,
  PHASER_STAGE_OPTIONS,
} = await import(effectUrl);

assert.deepEqual(PHASER_STAGE_OPTIONS, [4, 6, 8, 12]);
assert.deepEqual(
  normalizePhaserParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    stages: Number.NaN,
    feedback: Number.NaN,
  }),
  { mix: 45, level: 100, rate: 0.5, depth: 70, stages: 6, feedback: 40 },
);
assert.deepEqual(
  normalizePhaserParams({
    mix: -1,
    level: 300,
    rate: 20,
    depth: 200,
    stages: 99,
    feedback: 1000,
  }),
  { mix: 0, level: 200, rate: 8, depth: 100, stages: 12, feedback: 90 },
);

const zeroSweep = getPhaserSweep(0);
const halfSweep = getPhaserSweep(50);
const fullSweep = getPhaserSweep(100);
assert.ok(Math.abs(zeroSweep.minimumFrequency - PHASER_CENTER_FREQUENCY) < 1e-9);
assert.ok(Math.abs(zeroSweep.maximumFrequency - PHASER_CENTER_FREQUENCY) < 1e-9);
assert.ok(Math.abs(fullSweep.minimumFrequency - PHASER_MIN_FREQUENCY) < 1e-9);
assert.ok(Math.abs(fullSweep.maximumFrequency - PHASER_MAX_FREQUENCY) < 1e-9);
assert.ok(halfSweep.minimumFrequency < PHASER_CENTER_FREQUENCY);
assert.ok(halfSweep.maximumFrequency > PHASER_CENTER_FREQUENCY);
assert.ok(
  Math.abs(
    fullSweep.minimumFrequency * fullSweep.maximumFrequency -
      PHASER_CENTER_FREQUENCY * PHASER_CENTER_FREQUENCY,
  ) < 1e-6,
  '지수 sweep의 기하 평균 중심이 유지되지 않습니다.',
);

assert.equal(PHASER_MAX_FEEDBACK, 0.9);
assert.equal(getPhaserWetMakeup(0), 1);
assert.equal(getPhaserWetMakeup(-10), 1);
assert.equal(getPhaserWetMakeup(10), getPhaserWetMakeup(PHASER_MAX_FEEDBACK));
assert.ok(getPhaserWetMakeup(PHASER_MAX_FEEDBACK) >= 0.3);
assert.ok(getPhaserWetMakeup(PHASER_MAX_FEEDBACK) < 0.5);

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
    this.detune = new MockAudioParam(options.detune ?? 0);
    this.Q = new MockAudioParam(options.Q ?? 1);
  }
}

class MockDelayNode extends MockAudioNode {
  constructor(_context, options = {}) {
    super();
    this.delayTime = new MockAudioParam(options.delayTime ?? 0);
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor(_context, options = {}) {
    super();
    this.type = options.type ?? 'sine';
    this.frequency = new MockAudioParam(options.frequency ?? 440);
    this.startCount = 0;
    this.stopCount = 0;
  }

  start() {
    this.startCount += 1;
  }

  stop() {
    this.stopCount += 1;
  }
}

Object.assign(globalThis, {
  GainNode: MockGainNode,
  BiquadFilterNode: MockBiquadFilterNode,
  DelayNode: MockDelayNode,
  OscillatorNode: MockOscillatorNode,
});

const context = {
  currentTime: 0,
  sampleRate: 48_000,
  createGain: () => new MockGainNode(),
};
const pedal = {
  id: 'phaser',
  type: 'phaser',
  name: 'Phaser',
  enabled: true,
  bypassed: false,
  color: '#8b5fbf',
  params: { mix: 45, level: 100, rate: 0.5, depth: 70, stages: 6, feedback: 40 },
};
const effect = new PhaserEffect(context, pedal);
const originalBanks = effect.banks;
const originalFilters = originalBanks.map((bank) => bank.filters);
assert.deepEqual(originalBanks.map((bank) => bank.stages), [4, 6, 8, 12]);
assert.deepEqual(originalFilters.map((filters) => filters.length), [4, 6, 8, 12]);
assert.equal(originalFilters.flat().length, 30);
assert.ok(originalFilters.flat().every((filter) => filter.type === 'allpass'));
assert.equal(effect.oscillator.startCount, 1);

originalBanks.forEach((bank) => {
  const lastFilter = bank.filters.at(-1);
  assert.ok(lastFilter.connections.includes(bank.outputGain));
  assert.ok(lastFilter.connections.includes(bank.feedbackGain));
  assert.ok(bank.feedbackGain.connections.includes(bank.feedbackDelay));
  assert.ok(bank.feedbackDelay.connections.includes(bank.filters[0]));
});

effect.update({
  ...pedal,
  params: { ...pedal.params, depth: 100, stages: 12, feedback: 1000 },
});
assert.equal(effect.banks, originalBanks, 'stage 변경 중 bank 배열이 교체되었습니다.');
assert.ok(
  effect.banks.every((bank, index) => bank.filters === originalFilters[index]),
  'stage 변경 중 filter 노드가 재생성되었습니다.',
);
assert.deepEqual(
  effect.banks.map((bank) => bank.outputGain.gain.value),
  [0, 0, 0, 1],
);
assert.ok(effect.banks.every((bank) => bank.feedbackGain.gain.value === 0.9));
assert.equal(effect.modulationDepth.gain.value, fullSweep.detuneCents);
assert.equal(effect.makeupGain.gain.value, getPhaserWetMakeup(0.9));

effect.dispose();
effect.dispose();
assert.equal(effect.oscillator.stopCount, 1);
assert.ok(effect.oscillator.disconnected);
assert.ok(effect.modulationDepth.disconnected);
assert.ok(
  effect.banks.every(
    (bank) =>
      bank.outputGain.disconnected &&
      bank.feedbackGain.disconnected &&
      bank.feedbackDelay.disconnected &&
      bank.filters.every((filter) => filter.disconnected),
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
  'Phaser regression passed: schema v7, 4 fixed stage banks, exponential sweep, feedback/makeup and lifecycle.',
);
