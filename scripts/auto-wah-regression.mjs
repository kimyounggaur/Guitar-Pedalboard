import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createEngineHarness } from './lib/engine-harness.mjs';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// S4.7: 예전에는 AutoWahEffect.ts·envelope-follower-processor.ts·AudioEngine.ts 를 글자로 읽어 29개 정규식으로 확인했다.
// 지금은 진짜 이펙터·진짜 워클릿 소스·진짜 AudioEngine 을 가짜 오디오(scripts/lib/fake-audio.mjs) 위에서 돌려
// 그래프 모양, 파라미터 예약 방식, 노드 생성 수, 메시지, 해제 주소를 직접 묻는다.
const harness = await createEngineHarness({
  extraExports: [
    "{ envelopeFollowerProcessorSource } from './audio/worklets/envelope-follower-processor.ts'",
    `{
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
    } from './audio/nodes/AutoWahEffect.ts'`,
  ],
});
const { fake, engine } = harness;
const {
  envelopeFollowerProcessorSource: workletSource,
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
} = harness.exports;

// 설계값(300 Hz → 2.5 kHz)에서 따로 계산한 기대값. 소스의 상수를 그대로 비교하면 부호·배율이 같이 틀려도 통과하므로 독립적으로 둔다.
const EXPECTED_MAX_DETUNE_CENTS = 1200 * Math.log2(2500 / 300);
assert.ok(
  Math.abs(EXPECTED_MAX_DETUNE_CENTS - 3670.6) < 0.5,
  `설계값 계산 확인(약 3670.6센트): ${EXPECTED_MAX_DETUNE_CENTS}`,
);

/**
 * 워클릿 소스를 새 vm 컨텍스트에서 돌려 프로세서를 만든다. 컨텍스트 안의 생성자·배열 메서드는 세어서
 * `allocations()` 로 보여 준다 — 오디오 렌더 루프(process)가 매 블록 메모리를 새로 잡지 않는지 실행으로 확인한다.
 */
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

  const sandbox = {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    sampleRate,
    registerProcessor(name, constructor) {
      assert.equal(name, 'envelope-follower-processor');
      Processor = constructor;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `(() => {
      const counters = (globalThis.__allocations = { constructs: 0, calls: 0 });
      for (const name of ['Array', 'Object', 'Map', 'Set', 'Float32Array', 'Float64Array', 'Int16Array', 'Uint8Array', 'ArrayBuffer']) {
        globalThis[name] = new Proxy(globalThis[name], {
          construct(target, args) { counters.constructs += 1; return Reflect.construct(target, args); },
        });
      }
      for (const name of ['map', 'filter', 'reduce', 'slice', 'concat', 'flat', 'flatMap', 'splice']) {
        const original = Array.prototype[name];
        Array.prototype[name] = function counted(...args) { counters.calls += 1; return original.apply(this, args); };
      }
      const from = Array.from;
      Array.from = (...args) => { counters.calls += 1; return from(...args); };
    })();`,
    sandbox,
  );
  vm.runInContext(workletSource, sandbox, { filename: 'envelope-follower-processor.js' });
  assert.ok(Processor, 'Envelope follower 프로세서가 등록되지 않았습니다.');
  const processor = new Processor();
  processor.allocations = () => ({ ...sandbox.__allocations });
  processor.resetAllocations = () => {
    sandbox.__allocations.constructs = 0;
    sandbox.__allocations.calls = 0;
  };
  return processor;
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

// 워클릿은 오디오 스레드에서 돈다. 메인 스레드로는 dispose 응답 한 번 말고는 아무것도 보내지 않아야 한다(예전 정규식: postMessage 1회).
const quietProcessor = createWorkletProcessor(48_000);
for (let block = 0; block < 200; block += 1) {
  const level = block % 2 === 0 ? 0.9 : 0;
  render(quietProcessor, [new Float32Array(128).fill(level), new Float32Array(128).fill(-level)], 55);
}
quietProcessor.process([[]], [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]], {
  sensitivity: new Float32Array([55]),
});
assert.equal(quietProcessor.port.messages.length, 0, 'Envelope/control 값을 메인 스레드 메시지로 게시합니다.');
quietProcessor.port.onmessage({ data: { type: 'unknown' } });
assert.equal(quietProcessor.port.messages.length, 0, 'dispose 가 아닌 메시지에 응답했습니다.');
quietProcessor.port.onmessage({ data: { type: 'dispose' } });
// vm 안에서 만든 객체라 deepEqual 은 prototype 이 달라 실패한다. JSON 으로 비교한다.
assert.equal(JSON.stringify(quietProcessor.port.messages), '[{"type":"disposed"}]');

// 입력이 끊긴 구간(페달 꺼짐)에서는 envelope 를 한 번 비우고 살아 있어야 한다. false 를 돌려주면 Chromium 은 다시 부르지 않는다(S4.2).
const restProcessor = createWorkletProcessor(48_000);
render(restProcessor, [new Float32Array(128).fill(1)], 100);
assert.ok(restProcessor.envelope > 0.3, '입력이 있으면 envelope 가 올라갑니다.');
const disconnected = restProcessor.process(
  [[]],
  [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]],
  { sensitivity: new Float32Array([55]) },
);
assert.equal(disconnected, true, '입력이 끊겼을 때 프로세서가 종료되었습니다.');
assert.equal(restProcessor.envelope, 0, '입력이 끊겼는데 envelope 가 남았습니다.');
const reconnected = render(restProcessor, [new Float32Array(128).fill(1)], 100);
assert.equal(reconnected.alive, true);
assert.ok(reconnected.controlOutput[0].at(-1) > 0.3, '입력이 다시 연결된 뒤 envelope 가 올라가지 않습니다.');

// 렌더 루프 할당: 블록을 수천 번 돌려도 새 배열·타입드어레이·객체를 만들거나 map/filter/reduce/Array.from 을 부르지 않아야 한다.
const allocationProcessor = createWorkletProcessor(48_000);
allocationProcessor.resetAllocations();
const allocationInput = [new Float32Array(128).fill(0.4), new Float32Array(128).fill(-0.7)];
const allocationOutput = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
const kRate = { sensitivity: new Float32Array([55]) };
const aRate = { sensitivity: new Float32Array(128).fill(30) };
for (let block = 0; block < 2000; block += 1) {
  allocationProcessor.process([allocationInput], allocationOutput, block % 2 === 0 ? kRate : aRate);
  if (block % 500 === 499) allocationProcessor.process([[]], allocationOutput, kRate);
}
assert.deepEqual(
  allocationProcessor.allocations(),
  { constructs: 0, calls: 0 },
  '오디오 렌더 루프에서 메모리를 할당합니다.',
);

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

const pedal = {
  id: 'auto-wah',
  type: 'autoWah',
  name: 'Auto Wah',
  active: true,
  color: '#6fa83f',
  params: defaultParams,
};
const { context } = harness;
const effectParams = (effect) => ({
  sensitivity: effect.sensitivityParam,
  frequency: effect.filter.frequency,
  detune: effect.filter.detune,
  q: effect.filter.Q,
  depth: effect.controlDepth.gain,
});
const targetCount = (param) => param.automation.filter(({ kind }) => kind === 'target').length;

const effect = new AutoWahEffect(context, pedal);
const originalFollower = effect.follower;
const originalFilter = effect.filter;
const originalControlDepth = effect.controlDepth;

// 그래프 모양: 입력 → 팔로워(출력 0 = 오디오, 출력 1 = 제어) → 밴드패스, 제어 → 깊이 게인 → detune, 필터 → 출력.
assert.equal(effect.follower.processorName, 'envelope-follower-processor');
assert.equal(effect.follower.options.numberOfInputs, 1);
assert.equal(effect.follower.options.numberOfOutputs, 2);
assert.deepEqual(effect.follower.options.outputChannelCount, [2, 1]);
assert.equal(effect.filter.type, 'bandpass');
assert.ok(effect.effectInput.connectsTo(effect.follower), 'effectInput → follower 연결');
assert.ok(
  effect.follower.connectsTo(effect.filter, { output: 0, input: 0 }),
  'follower output0 → filter 연결',
);
assert.ok(
  effect.follower.connectsTo(effect.controlDepth, { output: 1, input: 0 }),
  'follower output1 → control depth 연결',
);
assert.ok(
  !effect.follower.connectsTo(effect.controlDepth, { output: 0 }) &&
    !effect.follower.connectsTo(effect.filter, { output: 1 }),
  '출력 번호가 바뀌어 오디오와 제어가 섞였습니다.',
);
assert.ok(effect.controlDepth.connectsTo(effect.filter.detune), 'control depth → detune 연결');
assert.ok(effect.filter.connectsTo(effect.effectOutput), 'filter → effectOutput 연결');
assert.ok(fake.pathExists(effect.effectInput, effect.effectOutput), '입력에서 출력까지 길이 끊겼습니다.');

// 첫 값과 예약된 값: 노드를 만들 때 옵션으로 준 값도, update 가 예약한 값도 같은 부호·크기여야 한다(부호가 뒤집히면 필터가 거꾸로 훑는다).
assert.equal(effect.filter.frequency.value, AUTO_WAH_MIN_FREQUENCY);
assert.equal(effect.filter.detune.initialValue, 0, 'auto 모드 detune 시작값');
assert.equal(effect.filter.detune.value, 0);
assert.ok(
  Math.abs(effect.controlDepth.gain.initialValue - EXPECTED_MAX_DETUNE_CENTS * 0.6) < 1e-6,
  'control depth 시작값은 range 60 % 만큼의 양수 센트여야 합니다.',
);
assert.ok(
  Math.abs(effect.controlDepth.gain.value - EXPECTED_MAX_DETUNE_CENTS * 0.6) < 1e-6,
  'control depth 예약값은 range 60 % 만큼의 양수 센트여야 합니다.',
);
assert.ok(effect.controlDepth.gain.value > 0, 'auto 모드 envelope 변조는 위쪽(양수)으로 훑어야 합니다.');
assert.equal(effect.controlDepth.gain.value, getAutoWahDetuneRange(60));
assert.equal(effect.filter.Q.value, getAutoWahResonanceQ(45));
assert.equal(effect.filter.Q.initialValue, getAutoWahResonanceQ(45));
assert.equal(effect.sensitivityParam.value, 55);
assert.equal(effect.follower.parameterData.sensitivity, 55);

// AudioParam 직접 대입 금지: 이펙터가 만든 다섯 파라미터는 `.value =` 를 한 번도 받지 않고, 모두 cancel → target 예약으로 바뀐다.
for (const [name, param] of Object.entries(effectParams(effect))) {
  assert.equal(param.directAssignments, 0, `${name}: AudioParam 직접 대입이 있습니다.`);
  assert.equal(param.automation.at(-1).kind, 'target', `${name}: setTargetAtTime 으로 예약해야 합니다.`);
  assert.equal(param.automation.at(-2).kind, 'cancel', `${name}: 예약 전에 이전 예약을 지워야 합니다.`);
}

const nodesBeforeUpdate = fake.nodeCount;
const targetsBeforeUpdate = Object.fromEntries(
  Object.entries(effectParams(effect)).map(([name, param]) => [name, targetCount(param)]),
);
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
assert.equal(fake.nodeCount, nodesBeforeUpdate, 'update 중 오디오 노드를 재생성합니다.');
for (const [name, param] of Object.entries(effectParams(effect))) {
  assert.equal(param.directAssignments, 0, `${name}: update 가 AudioParam 에 직접 대입했습니다.`);
  assert.equal(
    targetCount(param),
    targetsBeforeUpdate[name] + 1,
    `${name}: update 한 번에 예약이 정확히 한 번이어야 합니다.`,
  );
}
assert.equal(effect.sensitivityParam.value, 88);
assert.equal(effect.filter.frequency.value, AUTO_WAH_MIN_FREQUENCY);
assert.ok(
  Math.abs(effect.filter.detune.value - EXPECTED_MAX_DETUNE_CENTS * 0.75) < 1e-6,
  'manual 75 % 는 기준 주파수 위로 +75 % 센트여야 합니다.',
);
assert.ok(effect.filter.detune.value > 0, 'manual 모드 detune 이 아래쪽(음수)으로 갔습니다.');
assert.equal(effect.filter.detune.value, getAutoWahDetuneRange(75));
assert.equal(effect.filter.Q.value, AUTO_WAH_MAX_Q);
assert.equal(effect.controlDepth.gain.value, 0, 'manual mode envelope 변조가 남았습니다.');

// 다시 auto 로 돌리면 envelope 변조가 원래 부호·크기로 돌아온다.
effect.update({ ...pedal, params: { ...defaultParams, range: 30 } });
assert.ok(Math.abs(effect.controlDepth.gain.value - EXPECTED_MAX_DETUNE_CENTS * 0.3) < 1e-6);
assert.equal(effect.filter.detune.value, 0);
assert.equal(fake.nodeCount, nodesBeforeUpdate, '두 번째 update 중 노드를 재생성합니다.');

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
  Object.values(effectParams(effect))
    .map((param) => param.value)
    .every(Number.isFinite),
  'Effect AudioParam에 NaN/Infinity가 전달되었습니다.',
);
for (const param of Object.values(effectParams(effect))) {
  assert.ok(
    param.automation.every((entry) => entry.value === undefined || Number.isFinite(entry.value)),
    `${param.name}: NaN/Infinity 가 예약되었습니다.`,
  );
}

// dispose: 두 번 불러도 정리는 한 번. 워클릿에 dispose 를 알리고, 응답(disposed)을 받거나 50 ms 가 지나면 포트를 닫는다.
const disposeCallsBefore = {
  follower: effect.follower.disconnectCalls,
  filter: effect.filter.disconnectCalls,
  controlDepth: effect.controlDepth.disconnectCalls,
};
effect.dispose();
effect.dispose();
assert.deepEqual(effect.follower.messages, [{ type: 'dispose' }]);
assert.equal(effect.follower.port.closeCount, 0, 'dispose ACK 전에 port를 닫았습니다.');
const acknowledgeDispose = effect.follower.port.onmessage;
assert.equal(typeof acknowledgeDispose, 'function');
acknowledgeDispose({ data: { type: 'something-else' } });
assert.equal(effect.follower.port.closeCount, 0, 'disposed 가 아닌 메시지로 port 를 닫았습니다.');
acknowledgeDispose({ data: { type: 'disposed' } });
assert.equal(effect.follower.port.closeCount, 1, 'dispose ACK 후 port가 닫히지 않았습니다.');
assert.equal(effect.follower.port.onmessage, null);
await wait(70);
assert.equal(effect.follower.port.closeCount, 1, 'ACK 로 닫은 뒤 대기 타이머가 포트를 또 닫았습니다.');
assert.equal(effect.follower.disconnectCalls, disposeCallsBefore.follower + 1);
assert.equal(effect.filter.disconnectCalls, disposeCallsBefore.filter + 1);
assert.equal(effect.controlDepth.disconnectCalls, disposeCallsBefore.controlDepth + 1);

const fallbackEffect = new AutoWahEffect(context, pedal);
fallbackEffect.dispose();
assert.equal(fallbackEffect.follower.port.closeCount, 0, 'fallback 전에 port를 닫았습니다.');
await wait(70);
assert.equal(fallbackEffect.follower.port.closeCount, 1, 'dispose fallback이 port를 닫지 않았습니다.');

// 생성 실패: 워클릿에 sensitivity 파라미터가 없으면 만든 노드를 모두 끊고 던진다.
const brokenContextNodes = fake.nodeCount;
const OriginalWorkletNode = globalThis.AudioWorkletNode;
globalThis.AudioWorkletNode = class NoParamWorkletNode extends OriginalWorkletNode {
  constructor(...args) {
    super(...args);
    this.parameters = { get: () => undefined };
  }
};
assert.throws(() => new AutoWahEffect(context, pedal), /sensitivity/);
const leakedNodes = fake.created().slice(brokenContextNodes);
globalThis.AudioWorkletNode = OriginalWorkletNode;
const leakedFollower = leakedNodes.find((node) => node.kind === 'AudioWorkletNode');
assert.ok(leakedFollower && leakedFollower.disconnectCalls >= 1, '생성 실패 시 follower 를 끊지 않았습니다.');

// 엔진: 'autoWah' 페달은 AutoWahEffect 로, 워클릿 모듈은 envelope follower 소스로 올리고, 세션이 끝나면 만든 주소를 모두 해제한다.
const engineEffect = engine.createEffect(pedal);
assert.ok(engineEffect instanceof AutoWahEffect, "엔진이 'autoWah' 페달에 다른 이펙터를 만들었습니다.");
assert.equal(engineEffect.follower.processorName, 'envelope-follower-processor');
engineEffect.dispose();

const workletBlobs = await harness.loadWorklets();
assert.equal(harness.workletModules.length, 9, '워클릿 모듈 9개(문자열 6 + 파일 3)를 올려야 합니다.');
const followerBlobs = workletBlobs.filter(({ text }) => text === workletSource);
assert.equal(followerBlobs.length, 1, 'envelope follower 소스가 모듈로 한 번 올라가야 합니다.');
assert.ok(
  harness.workletModules.includes(followerBlobs[0].url),
  'envelope follower Blob 주소를 addModule 에 넘겨야 합니다.',
);
assert.equal(
  new Set(workletBlobs.map(({ text }) => text)).size,
  workletBlobs.length,
  '서로 다른 워클릿 6개가 각각 올라가야 합니다.',
);
assert.equal(harness.revokedUrls.length, 0, '세션 중에 주소를 미리 해제했습니다.');
engine.releaseGraph();
assert.deepEqual(
  [...harness.revokedUrls].sort(),
  workletBlobs.map(({ url }) => url).sort(),
  '세션이 끝날 때 만든 Blob 주소를 모두 해제해야 합니다.',
);
harness.restore();

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
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationBundle.outputFiles[0].text).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log(
  'Auto Wah regression passed: schema v9, 5/120ms envelope, strongest stereo peak, bounded exponential frequency/Q, topology, factory bypass and lifecycle.',
);
