// 마스터 리미터(S1.4a, 설계서 GS-6) 시험.
//   · limiter.worklet.ts 를 실제 파일 그대로 읽어 오디오 스레드를 흉내 낸 vm 에서 돌린다(문자열 복사본이 아니다).
//   · OutputStage 는 가짜 컨텍스트로 연결 모양만 본다. 엔진 연결(스피커·미터·녹음)은 소스 단언 몇 개로 지킨다.
// 소리 자체(최악 조합 피크)는 오디오 렌더 프로브 P-03 이 잰다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';

const SAMPLE_RATE = 48000;
const LOOKAHEAD = Math.round(SAMPLE_RATE * 0.001); // 48 샘플
const CEILING = 10 ** (-1 / 20);
const CEILING_F32 = Math.fround(CEILING);

// ---------------------------------------------------------------------------------------------
// 워클릿 불러오기
// ---------------------------------------------------------------------------------------------
// 앱 빌드(Vite)가 하는 것처럼 limiterSpec.ts 까지 묶어 한 덩어리(IIFE)로 만든다.
const compiled = await build({
  entryPoints: ['src/audio/worklets/limiter.worklet.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  write: false,
});
const workletCode = compiled.outputFiles[0].text;
const registered = [];
function loadProcessor(sampleRate = SAMPLE_RATE) {
  let Processor;
  vm.runInNewContext(workletCode, {
    sampleRate,
    AudioWorkletProcessor: class {},
    registerProcessor(name, klass) {
      registered.push(name);
      Processor = klass;
    },
  });
  return Processor;
}
const Processor = loadProcessor();
assert.deepEqual(registered, ['limiter-processor'], '워클릿은 limiter-processor 하나만 등록한다');

/** 오디오 스레드가 하듯 한 번 부르고 출력 두 채널을 돌려 준다. right 가 없으면 모노 입력이다. */
function run(node, left, right) {
  const output = [new Float32Array(left.length), new Float32Array(left.length)];
  node.process([right ? [left, right] : [left]], [output]);
  return output;
}

/** 길이가 긴 신호를 128 샘플 퀀텀으로 나눠 흘려 보내고 이어 붙인 출력을 돌려 준다. */
function runInQuanta(node, left, right) {
  const out = [new Float32Array(left.length), new Float32Array(left.length)];
  for (let start = 0; start < left.length; start += 128) {
    const end = Math.min(left.length, start + 128);
    const block = run(node, left.subarray(start, end), right ? right.subarray(start, end) : undefined);
    out[0].set(block[0], start);
    out[1].set(block[1], start);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 1. 투명: 천장 아래 신호는 룩어헤드만큼 늦을 뿐 한 샘플도 바뀌지 않는다
// ---------------------------------------------------------------------------------------------
{
  const length = 1024;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    left[i] = 0.85 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    right[i] = -0.5 * Math.sin((2 * Math.PI * 330 * i) / SAMPLE_RATE);
  }
  const [outLeft, outRight] = runInQuanta(new Processor(), left, right);
  for (let i = 0; i < LOOKAHEAD; i += 1) {
    assert.equal(outLeft[i], 0, `처음 ${LOOKAHEAD} 샘플(룩어헤드)은 무음이다`);
    assert.equal(outRight[i], 0);
  }
  for (let i = LOOKAHEAD; i < length; i += 1) {
    assert.equal(outLeft[i], left[i - LOOKAHEAD], `왼쪽 ${i}번 샘플이 입력과 같아야 한다`);
    assert.equal(outRight[i], right[i - LOOKAHEAD], `오른쪽 ${i}번 샘플이 입력과 같아야 한다`);
  }
}

// 모노 입력은 양쪽 출력에 같은 소리로 나간다
{
  const mono = new Float32Array(512);
  for (let i = 0; i < mono.length; i += 1) mono[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
  const [outLeft, outRight] = runInQuanta(new Processor(), mono);
  assert.deepEqual(Array.from(outRight), Array.from(outLeft), '모노 입력은 두 출력이 같다');
  assert.equal(outLeft[LOOKAHEAD + 10], mono[10]);
}

// 입력이 연결되지 않은 순간(채널 0개)에도 무음을 내고 멈추지 않는다
{
  const node = new Processor();
  const output = [new Float32Array(128), new Float32Array(128)];
  assert.equal(node.process([[]], [output]), true);
  assert.equal(node.process([], [output]), true);
  assert.ok(output[0].every((value) => value === 0) && output[1].every((value) => value === 0));
}

// ---------------------------------------------------------------------------------------------
// 2. 천장: 어떤 입력도 −1 dBFS 를 넘지 못한다. 좌우는 같은 이득으로 묶인다
// ---------------------------------------------------------------------------------------------
{
  const left = new Float32Array(2048).fill(0.1);
  const right = new Float32Array(2048).fill(0.1);
  right[100] = 2;
  const [outLeft, outRight] = runInQuanta(new Processor(), left, right);
  // 오른쪽의 큰 피크는 나오는 순간 정확히 천장에 닿고, 왼쪽에는 같은 이득(천장 ÷ 2)이 걸린다.
  assert.ok(Math.abs(outRight[100 + LOOKAHEAD] - CEILING_F32) < 1e-7, '큰 피크는 천장에서 멈춘다');
  assert.ok(Math.abs(outLeft[100 + LOOKAHEAD] - 0.1 * (CEILING / 2)) < 1e-7, '왼쪽에도 같은 이득이 걸린다');
  assert.ok(Math.max(...outRight) <= CEILING_F32 && Math.min(...outRight) >= -CEILING_F32);
}

// 내부 수치 오차가 있어도 천장을 넘지 않는다(마지막 안전망) — 이득이 1 이상으로 새는 극단 입력
{
  const left = new Float32Array(4096);
  const right = new Float32Array(4096);
  for (let i = 0; i < left.length; i += 1) {
    left[i] = (i % 7 === 0 ? 1 : -1) * (1 + (i % 13)) * 1e3;
    right[i] = (i % 5 === 0 ? -1 : 1) * 1e6;
  }
  const [outLeft, outRight] = runInQuanta(new Processor(), left, right);
  for (const channel of [outLeft, outRight]) {
    assert.ok(channel.every((value) => Number.isFinite(value) && Math.abs(value) <= CEILING_F32), '극단 입력도 천장 이하다');
  }
}

// ---------------------------------------------------------------------------------------------
// 3. NaN·Infinity 는 무음으로 바꾸고 이득을 오염시키지 않는다
// ---------------------------------------------------------------------------------------------
{
  const node = new Processor();
  const left = new Float32Array(256).fill(0.2);
  const right = new Float32Array(256).fill(0.2);
  left[10] = NaN;
  right[20] = Infinity;
  right[30] = -Infinity;
  const [outLeft, outRight] = runInQuanta(node, left, right);
  assert.equal(outLeft[10 + LOOKAHEAD], 0, 'NaN 은 무음으로 나간다');
  assert.equal(outRight[20 + LOOKAHEAD], 0, 'Infinity 는 무음으로 나간다');
  assert.equal(outRight[30 + LOOKAHEAD], 0, '-Infinity 는 무음으로 나간다');
  assert.equal(outLeft[11 + LOOKAHEAD], Math.fround(0.2), '다음 샘플은 영향을 받지 않는다');
  assert.equal(node.gain, 1, '숫자가 아닌 샘플이 이득을 끌어내리지 않는다');
}

// ---------------------------------------------------------------------------------------------
// 4. 룩어헤드: 큰 피크가 들어오는 순간(출력에 나오기 룩어헤드만큼 앞서) 이득이 이미 내려가 있다
// ---------------------------------------------------------------------------------------------
{
  const length = 600;
  const burstAt = 300;
  const left = new Float32Array(length);
  for (let i = 0; i < length; i += 1) left[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE);
  left[burstAt] = 2;
  const [out] = runInQuanta(new Processor(), left);
  const reduced = CEILING / 2;
  for (let i = burstAt; i < burstAt + LOOKAHEAD; i += 1) {
    assert.ok(
      Math.abs(out[i] - left[i - LOOKAHEAD] * reduced) < 1e-6,
      `${i}번 출력: 피크가 나오기 전에 이득이 이미 내려가 있어야 한다`,
    );
  }
  assert.ok(Math.abs(out[burstAt - 1] - left[burstAt - 1 - LOOKAHEAD]) < 1e-9, '피크가 들어오기 전 출력은 그대로다');
  assert.ok(Math.abs(out[burstAt + LOOKAHEAD] - CEILING_F32) < 1e-6, '피크는 천장에서 멈춘다');
}

// ---------------------------------------------------------------------------------------------
// 5. 릴리즈: 피크가 창을 벗어난 뒤 이득은 시상수 80 ms 로 1 에 돌아온다
// ---------------------------------------------------------------------------------------------
{
  const node = new Processor();
  const reduced = CEILING / 2;
  const release = Math.round(SAMPLE_RATE * 0.08); // 시상수 = 3840 샘플
  const peak = new Float32Array(1);
  peak[0] = 2;
  run(node, peak);
  // 피크(0번 샘플)는 창(룩어헤드 + 1 샘플)에 1~룩어헤드번 샘플까지 머문다. 그동안 이득은 그대로이고,
  // (룩어헤드 + 1)번 샘플부터 1 로 돌아가기 시작해 시상수(release 샘플)만큼 지나면 1 − (1 − 이득)·e⁻¹ 이 된다.
  run(node, new Float32Array(LOOKAHEAD).fill(0.1));
  assert.ok(Math.abs(node.gain - reduced) < 1e-9, '피크가 창 안에 있는 동안 이득은 그대로다');
  run(node, new Float32Array(release).fill(0.1));
  const expected = 1 - (1 - reduced) * Math.exp(-1);
  assert.ok(Math.abs(node.gain - expected) < 1e-5, `릴리즈 시상수 80 ms: ${node.gain} ≈ ${expected}`);
  run(node, new Float32Array(release * 8).fill(0.1));
  assert.ok(1 - node.gain < 1e-3, '충분히 지나면 이득은 1 에 가까워진다');
}

// ---------------------------------------------------------------------------------------------
// 6. 퀀텀 경계와 무관: 128 샘플로 나눠 흘려도 한 번에 흘린 것과 같다
// ---------------------------------------------------------------------------------------------
{
  const length = 128 * 40;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    left[i] = 1.4 * Math.sin((2 * Math.PI * 500 * i) / SAMPLE_RATE);
    right[i] = 0.7 * Math.sin((2 * Math.PI * 333 * i) / SAMPLE_RATE);
  }
  const whole = run(new Processor(), left, right);
  const split = runInQuanta(new Processor(), left, right);
  assert.deepEqual(Array.from(split[0]), Array.from(whole[0]), '왼쪽: 나눠 흘려도 같다');
  assert.deepEqual(Array.from(split[1]), Array.from(whole[1]), '오른쪽: 나눠 흘려도 같다');
}

// 지속되는 과입력: 천장 아래에서 모양을 유지한다(딱딱하게 잘리지 않는다)
{
  const length = 128 * 100;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const sample = 1.5 * Math.sin((2 * Math.PI * 500 * i) / SAMPLE_RATE);
    left[i] = sample;
    right[i] = sample / 2;
  }
  const [outLeft, outRight] = runInQuanta(new Processor(), left, right);
  assert.ok(outLeft.every(Number.isFinite) && outRight.every(Number.isFinite));
  assert.ok(Math.max(...outLeft, ...outRight) <= CEILING_F32);
  // 정상 상태에서는 이득이 천장 ÷ 1.5 ≈ 0.594 로 거의 일정하다 → 입력 0.75 지점의 출력은 약 0.446
  let sampled = 0;
  for (let i = 128 * 50; i < length; i += 1) {
    if (Math.abs(left[i - LOOKAHEAD] - 0.75) < 0.001) {
      assert.ok(outLeft[i] > 0.4 && outLeft[i] < 0.5, `과입력 사인이 모양을 유지한다: ${outLeft[i]}`);
      sampled += 1;
    }
  }
  assert.ok(sampled > 0, '시험할 샘플이 있어야 한다');
  const peakOut = Math.max(...outLeft.subarray(128 * 50));
  assert.ok(peakOut > CEILING - 0.01, `과입력의 출력 피크는 천장 바로 아래다: ${peakOut}`);
}

// 샘플레이트에 따라 룩어헤드가 1 ms 로 따라간다(96 kHz 는 96 샘플)
{
  const Processor96 = loadProcessor(96000);
  const node = new Processor96();
  const input = new Float32Array(400);
  input[0] = 0.5;
  const [out] = run(node, input);
  assert.equal(out[95], 0);
  assert.equal(out[96], 0.5, '96 kHz 에서는 96 샘플 뒤에 나온다');
}

// ---------------------------------------------------------------------------------------------
// 7. OutputStage: 프리셋 음량 보정 → 마스터 게인 → (가드) → 리미터 연결과 정리
// ---------------------------------------------------------------------------------------------
{
  const bundle = await build({
    entryPoints: ['src/audio/engine/OutputStage.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { OutputStage, LIMITER_PROCESSOR_NAME } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  );
  assert.equal(LIMITER_PROCESSOR_NAME, 'limiter-processor');

  class FakeNode {
    constructor(label) {
      this.label = label;
      this.connections = new Set();
      this.disconnectAllCalls = 0;
    }
    connect(target) {
      this.connections.add(target);
      return target;
    }
    disconnect(target) {
      if (target === undefined) {
        this.disconnectAllCalls += 1;
        this.connections.clear();
      } else {
        if (!this.connections.delete(target)) throw Object.assign(new Error('not connected'), { name: 'InvalidAccessError' });
      }
    }
  }
  const created = [];
  class FakeWorkletNode extends FakeNode {
    constructor(context, name, options) {
      super('limiter');
      this.context = context;
      this.name = name;
      this.options = options;
      created.push(this);
    }
  }
  globalThis.AudioWorkletNode = FakeWorkletNode;
  const context = { createGain: () => new FakeNode('master') };

  const guard = new FakeNode('guard');
  const stage = new OutputStage(context, { guard });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'limiter-processor');
  assert.deepEqual(created[0].options, { outputChannelCount: [2] });
  assert.equal(stage.output, created[0]);
  assert.notEqual(stage.presetTrim, stage.input, '프리셋 음량 보정(trim)은 마스터 게인과 다른 노드다');
  assert.deepEqual([...stage.presetTrim.connections], [stage.input], '체인 끝이 들어오는 trim 은 마스터 게인으로 간다');
  assert.deepEqual([...stage.input.connections], [guard], '마스터 게인은 가드로 간다');
  assert.deepEqual([...guard.connections], [stage.output], '가드는 리미터로 간다');
  stage.dispose();
  assert.equal(stage.presetTrim.connections.size, 0, 'trim 의 연결도 끊는다');
  assert.equal(stage.input.connections.size, 0);
  assert.equal(stage.output.connections.size, 0);
  assert.equal(guard.connections.size, 0, '가드와 리미터의 연결도 끊는다');
  assert.doesNotThrow(() => stage.dispose(), '두 번 불러도 괜찮다');

  const direct = new OutputStage(context);
  assert.deepEqual([...direct.presetTrim.connections], [direct.input], '가드가 없어도 trim 은 마스터 게인으로 간다');
  assert.deepEqual([...direct.input.connections], [direct.output], '가드가 없으면 마스터 게인이 바로 리미터로 간다');
  delete globalThis.AudioWorkletNode;
}

// ---------------------------------------------------------------------------------------------
// 8. 소스 단언: 스피커·미터·녹음이 같은 리미터 출력을 받고, 워클릿 파일이 앱과 오프라인 렌더에 모두 등록된다
// ---------------------------------------------------------------------------------------------
const [engine, urls, modules, renderChain] = await Promise.all([
  readFile('src/audio/AudioEngine.ts', 'utf8'),
  readFile('src/audio/worklets/urls.ts', 'utf8'),
  readFile('src/audio/offline/workletModules.ts', 'utf8'),
  readFile('src/audio/offline/renderChain.ts', 'utf8'),
]);
assert.match(urls, /from '\.\/limiter\.worklet\.ts\?worker&url'/, '리미터는 별도 파일을 ?worker&url 로 불러온다');
assert.match(engine, /new OutputStage\(this\.context, \{ guard: this\.howlGuard \}\)/);
assert.match(engine, /this\.outputStage\.output\.connect\(this\.context\.destination\)/);
assert.match(engine, /this\.outputStage\.output\.connect\(this\.outputMeter\.input\)/);
assert.match(engine, /this\.outputStage\?\.output\.connect\(this\.recorderDestination\)/, '녹음은 같은 리미터 출력을 받는다');
assert.match(engine, /limiterWorkletUrl/, '엔진이 리미터 워클릿 파일을 등록한다');
assert.match(modules, /limiterWorkletUrl/, '오프라인 렌더도 같은 파일을 등록한다');
assert.match(renderChain, /new OutputStage\(context, \{ guard: howlGuard \}\)/, '오프라인 렌더도 같은 출력 단계를 쓴다');
// 프리셋 음량 보정(S1.4c): 체인 끝은 trim 으로 들어간다. 엔진과 오프라인 렌더가 같은 자리를 쓴다.
assert.match(engine, /to: chainEnd/, '엔진은 체인 끝을 마스터 게인이 아니라 trim 에 잇는다');
assert.match(engine, /this\.buildChainConnections\(\s*pedals,\s*nextEffects,\s*chainInput,\s*presetTrim,?\s*\)/);
assert.match(engine, /presetTrim\.gain\.value = dbToGain\(clampTrimDb\(this\.getPresetTrimDb\(\)\)\)/, '그래프를 만들 때 trim 의 처음 값은 스토어 값이다');
assert.match(engine, /rampParam\(trim\.gain, dbToGain\(clampTrimDb\(db\)\), context, PRESET_TRIM_RAMP_SECONDS\)/, 'trim 변경은 램프로 옮긴다');
assert.match(renderChain, /previous\.connect\(presetTrim\)/, '오프라인 렌더도 체인 끝을 trim 에 잇는다');
assert.doesNotMatch(engine, /previous\.connect\(masterGain\)|to: masterGain/, '체인 끝이 마스터 게인으로 곧장 가는 연결은 없다');
assert.doesNotMatch(engine + modules + renderChain, /peak-limiter-processor|peakLimiterProcessorSource/, '옛 리미터는 남기지 않는다');

console.log('Master limiter (lookahead 1 ms, ceiling −1 dBFS, release 80 ms), OutputStage wiring and recording route passed');
