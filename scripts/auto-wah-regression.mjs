import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import vm from 'node:vm';
import { build } from 'esbuild';

const effectSource = await readFile(
  new URL('../src/audio/nodes/AutoWahEffect.ts', import.meta.url),
  'utf8',
);
const workletModule = await readFile(
  new URL('../src/audio/worklets/envelope-follower-processor.ts', import.meta.url),
  'utf8',
);
const audioEngineSource = await readFile(
  new URL('../src/audio/AudioEngine.ts', import.meta.url),
  'utf8',
);

assert.match(effectSource, /new AudioWorkletNode\(context, 'envelope-follower-processor'/);
assert.match(effectSource, /numberOfOutputs: 2/);
assert.match(effectSource, /outputChannelCount: \[2, 1\]/);
assert.match(effectSource, /this\.follower\.connect\(this\.filter, 0, 0\)/);
assert.match(effectSource, /this\.follower\.connect\(this\.controlDepth, 1, 0\)/);
assert.match(effectSource, /this\.controlDepth\.connect\(this\.filter\.detune\)/);
assert.match(effectSource, /this\.filter\.connect\(this\.effectOutput\)/);
assert.doesNotMatch(effectSource, /\.value\s*=/, 'AudioParam 직접 대입이 있습니다.');

const updateStart = effectSource.indexOf('override update(');
const disposeStart = effectSource.indexOf('override dispose(');
assert.ok(updateStart >= 0 && disposeStart > updateStart, 'update/dispose 구현을 찾을 수 없습니다.');
const updateSource = effectSource.slice(updateStart, disposeStart);
assert.doesNotMatch(
  updateSource,
  /new\s+(?:AudioWorklet|Gain|BiquadFilter)Node/,
  'update 중 오디오 노드를 재생성합니다.',
);
assert.match(updateSource, /smoothParam\(this\.sensitivityParam/);
assert.match(updateSource, /smoothParam\([\s\S]*this\.filter\.frequency/);
assert.match(updateSource, /smoothParam\([\s\S]*this\.filter\.detune/);
assert.match(updateSource, /smoothParam\(this\.filter\.Q/);
assert.match(updateSource, /smoothParam\([\s\S]*this\.controlDepth\.gain/);
assert.match(effectSource, /this\.follower\.port\.postMessage\(\{ type: 'dispose' \}\)/);
assert.match(effectSource, /event\.data\?\.type === 'disposed'/);
assert.match(effectSource, /globalThis\.setTimeout\(/);
assert.match(effectSource, /if \(this\.disposed\) return;/);

assert.match(
  audioEngineSource,
  /import \{ AutoWahEffect \} from '.\/nodes\/AutoWahEffect';/,
);
assert.match(
  audioEngineSource,
  /import \{ envelopeFollowerProcessorSource \} from '.\/worklets\/envelope-follower-processor';/,
);
assert.match(
  audioEngineSource,
  /this\.createWorkletUrl\(envelopeFollowerProcessorSource\)/,
);
assert.match(audioEngineSource, /case 'autoWah':[\s\S]*return new AutoWahEffect\(this\.context, pedal\);/);
assert.match(audioEngineSource, /this\.workletUrls\.push\(url\)/);
assert.match(audioEngineSource, /this\.workletUrls\.forEach\(\(url\) => URL\.revokeObjectURL\(url\)\)/);

const workletMatch = workletModule.match(
  /export const envelopeFollowerProcessorSource = String\.raw`([\s\S]*)`;\s*$/,
);
assert.ok(workletMatch, 'Envelope follower 워클렛 소스를 찾을 수 없습니다.');
const workletSource = workletMatch[1];
assert.match(workletSource, /const ATTACK_SECONDS = 0\.005;/);
assert.match(workletSource, /const RELEASE_SECONDS = 0\.12;/);
assert.match(workletSource, /registerProcessor\('envelope-follower-processor'/);
assert.match(workletSource, /this\.port\.postMessage\(\{ type: 'disposed' \}\)/);
assert.equal(
  [...workletSource.matchAll(/port\.postMessage/g)].length,
  1,
  'Envelope/control 값을 메인 스레드 메시지로 게시합니다.',
);
const processSource = workletSource.slice(
  workletSource.indexOf('process(inputs, outputs, parameters)'),
  workletSource.indexOf("registerProcessor('envelope-follower-processor'"),
);
assert.doesNotMatch(
  processSource,
  /new\s+|Array\.from|\.(?:map|filter|reduce)\(/,
  '오디오 렌더 루프에서 메모리를 할당합니다.',
);

function createWorkletProcessor(sampleRate) {
  let Processor = null;

  class MockPort {
    constructor() {
      this.onmessage = null;
      this.messages = [];
    }

    postMessage(message) {
      this.messages.push(message);
    }
  }

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = new MockPort();
    }
  }

  vm.runInNewContext(
    workletSource,
    {
      AudioWorkletProcessor: MockAudioWorkletProcessor,
      sampleRate,
      registerProcessor(name, constructor) {
        assert.equal(name, 'envelope-follower-processor');
        Processor = constructor;
      },
    },
    { filename: 'envelope-follower-processor.js' },
  );
  assert.ok(Processor, 'Envelope follower 프로세서가 등록되지 않았습니다.');
  return new Processor();
}

function render(processor, channels, sensitivity = 0) {
  const frameCount = channels[0]?.length ?? 128;
  const audioOutput = [new Float32Array(frameCount), new Float32Array(frameCount)];
  const controlOutput = [new Float32Array(frameCount)];
  const alive = processor.process(
    [channels],
    [audioOutput, controlOutput],
    { sensitivity: new Float32Array([sensitivity]) },
  );
  return { alive, audioOutput, controlOutput };
}

for (const sampleRate of [44_100, 48_000, 96_000, 192_000]) {
  const attackProcessor = createWorkletProcessor(sampleRate);
  const attackFrames = Math.round(sampleRate * 0.005);
  const attackInput = new Float32Array(attackFrames).fill(1);
  const attack = render(attackProcessor, [attackInput], 0);
  const expectedAttack = 1 - Math.exp(-attackFrames / (sampleRate * 0.005));
  assert.ok(
    Math.abs(attack.controlOutput[0].at(-1) - expectedAttack) < 1e-5,
    `${sampleRate}Hz 5ms attack`,
  );

  const releaseProcessor = createWorkletProcessor(sampleRate);
  releaseProcessor.envelope = 1;
  const releaseFrames = Math.round(sampleRate * 0.12);
  const release = render(releaseProcessor, [new Float32Array(releaseFrames)], 0);
  const expectedRelease = Math.exp(-releaseFrames / (sampleRate * 0.12));
  assert.ok(
    Math.abs(release.controlOutput[0].at(-1) - expectedRelease) < 1e-5,
    `${sampleRate}Hz 120ms release`,
  );
}

const stereoProcessor = createWorkletProcessor(48_000);
const left = new Float32Array([0.25]);
const right = new Float32Array([-0.8]);
const stereo = render(stereoProcessor, [left, right], 0);
const attackCoefficient = Math.exp(-1 / (48_000 * 0.005));
assert.ok(
  Math.abs(stereo.controlOutput[0][0] - 0.8 * (1 - attackCoefficient)) < 1e-7,
  '스테레오 strongest-channel peak를 사용하지 않습니다.',
);
assert.equal(stereo.audioOutput[0][0], left[0], '왼쪽 passthrough');
assert.equal(stereo.audioOutput[1][0], right[0], '오른쪽 passthrough');

const clampProcessor = createWorkletProcessor(48_000);
clampProcessor.envelope = 1;
const clamped = render(clampProcessor, [new Float32Array([1])], 100);
assert.equal(clamped.controlOutput[0][0], 1, 'Envelope control 상한 clamp');
const nanControl = render(
  createWorkletProcessor(48_000),
  [new Float32Array([Number.NaN])],
  Number.NaN,
);
assert.ok(
  Number.isFinite(nanControl.controlOutput[0][0]) && nanControl.controlOutput[0][0] >= 0,
  'Envelope control NaN 차단',
);

const disposedProcessor = createWorkletProcessor(48_000);
disposedProcessor.port.onmessage({ data: { type: 'dispose' } });
assert.equal(disposedProcessor.port.messages.length, 1);
assert.equal(disposedProcessor.port.messages[0].type, 'disposed');
assert.equal(
  render(disposedProcessor, [new Float32Array(128)], 55).alive,
  false,
  'dispose 이후 프로세서가 종료되지 않았습니다.',
);

const effectBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/AutoWahEffect.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectBundle.outputFiles[0].text).toString('base64')}`;
const {
  AUTO_WAH_MAX_DETUNE_CENTS,
  AUTO_WAH_MAX_FREQUENCY,
  AUTO_WAH_MAX_Q,
  AUTO_WAH_MIN_FREQUENCY,
  AUTO_WAH_MIN_Q,
  AutoWahEffect,
  getAutoWahAutoMaximumFrequency,
  getAutoWahDetuneRange,
  getAutoWahManualFrequency,
  getAutoWahResonanceQ,
  getAutoWahSensitivityScale,
  normalizeAutoWahParams,
} = await import(effectUrl);

const defaultParams = {
  mix: 100,
  level: 100,
  sensitivity: 55,
  range: 60,
  resonance: 45,
  mode: 'auto',
  manual: 50,
};
assert.deepEqual(
  normalizeAutoWahParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    sensitivity: Number.NaN,
    range: Number.NEGATIVE_INFINITY,
    resonance: Number.NaN,
    mode: 'invalid',
    manual: Number.POSITIVE_INFINITY,
  }),
  defaultParams,
);
assert.deepEqual(
  normalizeAutoWahParams({
    ...defaultParams,
    mix: -10,
    level: 500,
    sensitivity: 500,
    range: -10,
    resonance: 500,
    mode: 'manual',
    manual: 500,
  }),
  {
    mix: 0,
    level: 200,
    sensitivity: 100,
    range: 0,
    resonance: 100,
    mode: 'manual',
    manual: 100,
  },
);

assert.equal(getAutoWahManualFrequency(0), AUTO_WAH_MIN_FREQUENCY);
assert.ok(
  Math.abs(
    getAutoWahManualFrequency(50) -
      Math.sqrt(AUTO_WAH_MIN_FREQUENCY * AUTO_WAH_MAX_FREQUENCY),
  ) < 1e-10,
);
assert.equal(getAutoWahManualFrequency(100), AUTO_WAH_MAX_FREQUENCY);
assert.equal(getAutoWahDetuneRange(0), 0);
assert.equal(getAutoWahDetuneRange(100), AUTO_WAH_MAX_DETUNE_CENTS);
assert.equal(getAutoWahAutoMaximumFrequency(0), AUTO_WAH_MIN_FREQUENCY);
assert.ok(Math.abs(getAutoWahAutoMaximumFrequency(100) - AUTO_WAH_MAX_FREQUENCY) < 1e-10);
assert.equal(getAutoWahResonanceQ(0), AUTO_WAH_MIN_Q);
assert.equal(getAutoWahResonanceQ(100), AUTO_WAH_MAX_Q);
assert.equal(getAutoWahSensitivityScale(0), 1);
assert.equal(getAutoWahSensitivityScale(100), 8);
for (const value of [Number.NaN, -1000, 0, 25, 50, 75, 100, 1000]) {
  const manualFrequency = getAutoWahManualFrequency(value);
  const autoMaximum = getAutoWahAutoMaximumFrequency(value);
  const q = getAutoWahResonanceQ(value);
  assert.ok(
    manualFrequency >= AUTO_WAH_MIN_FREQUENCY && manualFrequency <= AUTO_WAH_MAX_FREQUENCY,
    `${value}: manual frequency bound`,
  );
  assert.ok(
    autoMaximum >= AUTO_WAH_MIN_FREQUENCY && autoMaximum <= AUTO_WAH_MAX_FREQUENCY,
    `${value}: auto frequency bound`,
  );
  assert.ok(q >= AUTO_WAH_MIN_Q && q <= AUTO_WAH_MAX_Q, `${value}: Q bound`);
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
    this.disconnectCount = 0;
  }

  connect(destination, output = 0, input = 0) {
    this.connections.push({ destination, output, input });
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
    this.detune = new MockAudioParam(options.detune ?? 0);
    this.Q = new MockAudioParam(options.Q ?? 1);
    this.gain = new MockAudioParam(options.gain ?? 0);
  }
}

class MockMessagePort {
  constructor() {
    this.onmessage = null;
    this.messages = [];
    this.closeCount = 0;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  close() {
    this.closeCount += 1;
  }
}

class MockAudioWorkletNode extends MockAudioNode {
  constructor(_context, name, options = {}) {
    super();
    this.name = name;
    this.options = options;
    this.parameters = new Map([
      ['sensitivity', new MockAudioParam(options.parameterData?.sensitivity ?? 55)],
    ]);
    this.port = new MockMessagePort();
  }
}

Object.assign(globalThis, {
  AudioWorkletNode: MockAudioWorkletNode,
  BiquadFilterNode: MockBiquadFilterNode,
  GainNode: MockGainNode,
});

const context = {
  currentTime: 0.25,
  sampleRate: 48_000,
  createGain: () => new MockGainNode(),
};
const pedal = {
  id: 'auto-wah',
  type: 'autoWah',
  name: 'Auto Wah',
  enabled: true,
  bypassed: false,
  color: '#6fa83f',
  params: defaultParams,
};
const effect = new AutoWahEffect(context, pedal);
const originalFollower = effect.follower;
const originalFilter = effect.filter;
const originalControlDepth = effect.controlDepth;

assert.equal(effect.follower.name, 'envelope-follower-processor');
assert.equal(effect.follower.options.numberOfOutputs, 2);
assert.deepEqual(effect.follower.options.outputChannelCount, [2, 1]);
assert.equal(effect.filter.type, 'bandpass');
assert.ok(
  effect.effectInput.connections.some(({ destination }) => destination === effect.follower),
  'effectInput → follower 연결',
);
assert.ok(
  effect.follower.connections.some(
    ({ destination, output, input }) => destination === effect.filter && output === 0 && input === 0,
  ),
  'follower output0 → filter 연결',
);
assert.ok(
  effect.follower.connections.some(
    ({ destination, output, input }) =>
      destination === effect.controlDepth && output === 1 && input === 0,
  ),
  'follower output1 → control depth 연결',
);
assert.ok(
  effect.controlDepth.connections.some(({ destination }) => destination === effect.filter.detune),
  'control depth → detune 연결',
);
assert.ok(
  effect.filter.connections.some(({ destination }) => destination === effect.effectOutput),
  'filter → effectOutput 연결',
);
assert.equal(effect.filter.frequency.value, AUTO_WAH_MIN_FREQUENCY);
assert.equal(effect.filter.detune.value, 0);
assert.equal(effect.controlDepth.gain.value, getAutoWahDetuneRange(60));
assert.equal(effect.filter.Q.value, getAutoWahResonanceQ(45));
assert.equal(effect.sensitivityParam.value, 55);

effect.update({
  ...pedal,
  params: {
    ...defaultParams,
    sensitivity: 88,
    range: 100,
    resonance: 100,
    mode: 'manual',
    manual: 75,
  },
});
assert.equal(effect.follower, originalFollower, 'mode 변경 중 follower가 재생성되었습니다.');
assert.equal(effect.filter, originalFilter, 'mode 변경 중 filter가 재생성되었습니다.');
assert.equal(effect.controlDepth, originalControlDepth, 'mode 변경 중 control 노드가 재생성되었습니다.');
assert.equal(effect.sensitivityParam.value, 88);
assert.equal(effect.filter.frequency.value, AUTO_WAH_MIN_FREQUENCY);
assert.equal(effect.filter.detune.value, getAutoWahDetuneRange(75));
assert.equal(effect.filter.Q.value, AUTO_WAH_MAX_Q);
assert.equal(effect.controlDepth.gain.value, 0, 'manual mode envelope 변조가 남았습니다.');

effect.update({
  ...pedal,
  params: {
    ...defaultParams,
    sensitivity: Number.NaN,
    range: Number.POSITIVE_INFINITY,
    resonance: Number.NEGATIVE_INFINITY,
    mode: 'invalid',
    manual: Number.NaN,
  },
});
assert.ok(
  [
    effect.sensitivityParam.value,
    effect.filter.frequency.value,
    effect.filter.detune.value,
    effect.filter.Q.value,
    effect.controlDepth.gain.value,
  ].every(Number.isFinite),
  'Effect AudioParam에 NaN/Infinity가 전달되었습니다.',
);

effect.dispose();
effect.dispose();
assert.deepEqual(effect.follower.port.messages, [{ type: 'dispose' }]);
assert.equal(effect.follower.port.closeCount, 0, 'dispose ACK 전에 port를 닫았습니다.');
const acknowledgeDispose = effect.follower.port.onmessage;
assert.equal(typeof acknowledgeDispose, 'function');
acknowledgeDispose({ data: { type: 'disposed' } });
assert.equal(effect.follower.port.closeCount, 1, 'dispose ACK 후 port가 닫히지 않았습니다.');
assert.equal(effect.follower.port.onmessage, null);
assert.equal(effect.follower.disconnectCount, 1);
assert.equal(effect.filter.disconnectCount, 1);
assert.equal(effect.controlDepth.disconnectCount, 1);

const fallbackEffect = new AutoWahEffect(context, pedal);
fallbackEffect.dispose();
assert.equal(fallbackEffect.follower.port.closeCount, 0, 'fallback 전에 port를 닫았습니다.');
await wait(70);
assert.equal(fallbackEffect.follower.port.closeCount, 1, 'dispose fallback이 port를 닫지 않았습니다.');

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
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationBundle.outputFiles[0].text).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log(
  'Auto Wah regression passed: schema v9, 5/120ms envelope, strongest stereo peak, bounded exponential frequency/Q, topology, factory bypass and lifecycle.',
);
