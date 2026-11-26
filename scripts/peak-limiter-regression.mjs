// 마스터 리미터(S1.4a, 설계서 GS-6) 시험.
//   · limiter.worklet.ts 를 실제 파일 그대로 읽어 오디오 스레드를 흉내 낸 vm 에서 돌린다(문자열 복사본이 아니다).
//   · S1.5: 최근 100 ms 의 최대 이득 감소량을 포트로 알린다({type:'limiter', maxGrDb, frame}).
//   · OutputStage 는 가짜 컨텍스트로 연결 모양만 본다. 엔진 연결(스피커·미터·녹음)은 진짜 AudioEngine 을 가짜 오디오 위에서 돌려 그래프로 확인한다(S4.7).
// 소리 자체(최악 조합 피크)는 오디오 렌더 프로브 P-03 이 잰다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { access } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createEngineHarness } from './lib/engine-harness.mjs';

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
/** 오디오 스레드의 전역을 흉내 낸다. `currentFrame` 은 process 를 부를 때마다 테스트가 올려 준다. */
const audioGlobals = { currentFrame: 0 };
function loadProcessor(sampleRate = SAMPLE_RATE) {
  let Processor;
  vm.runInNewContext(workletCode, {
    sampleRate,
    get currentFrame() {
      return audioGlobals.currentFrame;
    },
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { messages: [], postMessage: (message) => this.port.messages.push(message) };
      }
    },
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
    audioGlobals.currentFrame = start;
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
  const meter = new FakeNode('level-meter#out');
  const stage = new OutputStage(context, { guard, levelMeter: meter });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'limiter-processor');
  assert.deepEqual(created[0].options, { outputChannelCount: [2] });
  assert.equal(stage.limiter, created[0], '리미터 노드는 포트로 감소량을 알리므로 밖에서도 읽을 수 있다');
  assert.equal(stage.output, meter, '출력 레벨 미터가 있으면 그 노드가 이 단계의 출력이다(스피커·녹음이 여기서 갈라진다)');
  assert.deepEqual([...stage.limiter.connections], [meter], '리미터 뒤에 level-meter#out');
  assert.notEqual(stage.presetTrim, stage.input, '프리셋 음량 보정(trim)은 마스터 게인과 다른 노드다');
  assert.deepEqual([...stage.presetTrim.connections], [stage.input], '체인 끝이 들어오는 trim 은 마스터 게인으로 간다');
  assert.deepEqual([...stage.input.connections], [guard], '마스터 게인은 가드로 간다');
  assert.deepEqual([...guard.connections], [stage.limiter], '가드는 리미터로 간다');
  stage.dispose();
  assert.equal(stage.presetTrim.connections.size, 0, 'trim 의 연결도 끊는다');
  assert.equal(stage.input.connections.size, 0);
  assert.equal(stage.limiter.connections.size, 0);
  assert.equal(guard.connections.size, 0, '가드와 리미터의 연결도 끊는다');
  assert.doesNotThrow(() => stage.dispose(), '두 번 불러도 괜찮다');

  const direct = new OutputStage(context);
  assert.deepEqual([...direct.presetTrim.connections], [direct.input], '가드가 없어도 trim 은 마스터 게인으로 간다');
  assert.deepEqual([...direct.input.connections], [direct.limiter], '가드가 없으면 마스터 게인이 바로 리미터로 간다');
  assert.equal(direct.output, direct.limiter, '미터가 없으면 리미터가 이 단계의 출력이다');
  delete globalThis.AudioWorkletNode;
}

// ---------------------------------------------------------------------------------------------
// 8. 엔진·오프라인 등록 동작: 스피커·미터·녹음이 같은 리미터 출력을 받고, 워클릿 파일이 앱과 오프라인 렌더에 모두 등록된다
// ---------------------------------------------------------------------------------------------
// 예전에는 AudioEngine.ts·urls.ts·workletModules.ts·renderChain.ts 를 글자로 읽어 19개 정규식으로 확인했다(S4.7 전).
// 이제는 진짜 AudioEngine 으로 그래프를 만들어 연결을 묻고, 등록 함수를 실행해 올라간 모듈을 묻는다.
// 오프라인 렌더(renderChain)가 같은 출력 단계·trim 자리를 쓰는지는 실제 브라우저에서 렌더하는 오디오 프로브(P-03 리미터, 음량 맞추기 프로브)가 소리로 확인한다.
{
  const harness = await createEngineHarness({
    extraExports: [
      "{ registerWorklets, workletSources } from './audio/offline/workletModules.ts'",
      "{ levelMeterWorkletUrl, limiterWorkletUrl, outputGuardWorkletUrl } from './audio/worklets/urls.ts'",
      "{ clampTrimDb, PRESET_TRIM_RAMP_SECONDS } from './audio/offline/loudnessSpec.ts'",
      "{ LIMITER_PROCESSOR_NAME } from './audio/engine/limiterSpec.ts'",
    ],
  });
  const { fake, engine, context, exports: app } = harness;
  const gainOf = (db) => 10 ** (db / 20);

  // --- 별도 파일 워클릿의 주소: 리미터·레벨 미터·출력 가드가 각자 자기 파일을 가리킨다 -----------------
  const fileWorklets = [
    ['limiter', app.limiterWorkletUrl],
    ['level-meter', app.levelMeterWorkletUrl],
    ['output-guard', app.outputGuardWorkletUrl],
  ];
  for (const [name, url] of fileWorklets) {
    assert.equal(url, `/assets/${name}.worklet.js`, `${name} 워클릿 주소는 자기 파일(${name}.worklet.ts)이어야 한다`);
    await access(`src/audio/worklets/${name}.worklet.ts`);
  }

  // --- 워클릿 모듈 등록: 엔진(실시간)과 오프라인 렌더가 같은 9개를 올린다 -------------------------------
  const engineBlobs = await harness.loadWorklets();
  assert.equal(harness.workletModules.length, 9, '엔진은 워클릿 모듈 9개를 올린다');
  const engineTexts = engineBlobs.map(({ text }) => text);
  assert.deepEqual(engineTexts, [...app.workletSources], '엔진이 올린 문자열 워클릿 6개는 오프라인 렌더의 목록과 같은 소스·같은 순서다');
  for (const [name, url] of fileWorklets) {
    assert.ok(harness.workletModules.includes(url), `엔진이 ${name} 워클릿 파일을 등록한다`);
  }

  const offlineModules = [];
  const blobCountBefore = harness.blobs.length;
  const offlineContext = fake.createContext({
    audioWorklet: { addModule: async (url) => { offlineModules.push(url); } },
  });
  await app.registerWorklets(offlineContext);
  assert.equal(offlineModules.length, 9, '오프라인 렌더도 같은 9개를 올린다');
  for (const [name, url] of fileWorklets) {
    assert.ok(offlineModules.includes(url), `오프라인 렌더도 ${name} 워클릿 파일을 등록한다`);
  }
  const offlineBlobs = harness.blobs.slice(blobCountBefore);
  assert.deepEqual(
    await Promise.all(offlineBlobs.map(({ blob }) => blob.text())),
    [...app.workletSources],
    '오프라인 렌더가 올린 문자열 워클릿은 같은 목록이다',
  );
  assert.deepEqual(
    harness.revokedUrls.slice(0, offlineBlobs.length).sort(),
    offlineBlobs.map(({ url }) => url).sort(),
    '오프라인 렌더는 등록이 끝나면 임시 주소를 바로 해제한다',
  );
  harness.revokedUrls.length = 0;

  // --- 등록된 프로세서 이름: 그래프가 쓰는 워클릿이 전부 등록되어 있고, 옛 리미터는 남지 않았다 -------------------
  const registeredNames = [];
  const collect = (code) => {
    vm.runInNewContext(code, {
      sampleRate: SAMPLE_RATE,
      currentFrame: 0,
      AudioWorkletProcessor: class {
        constructor() {
          this.port = { postMessage() {}, onmessage: null };
        }
      },
      registerProcessor: (name) => registeredNames.push(name),
    });
  };
  engineTexts.forEach(collect);
  for (const [name] of fileWorklets) {
    const compiledFile = await build({
      entryPoints: [`src/audio/worklets/${name}.worklet.ts`],
      bundle: true,
      format: 'iife',
      target: 'es2022',
      write: false,
    });
    collect(compiledFile.outputFiles[0].text);
  }
  assert.equal(new Set(registeredNames).size, 9, '워클릿 9개는 서로 다른 이름을 등록한다');
  assert.ok(registeredNames.includes(app.LIMITER_PROCESSOR_NAME));
  assert.ok(
    !registeredNames.some((name) => /peak-limiter/.test(name)),
    '옛 리미터(peak-limiter-processor)는 남기지 않는다',
  );

  // --- 엔진 그래프: 체인 → trim → 마스터 게인 → 가드 → 리미터 → 출력 미터 → [스피커, 파형 분석, 녹음] ------
  const wah = (id) => ({
    id,
    type: 'autoWah',
    name: id,
    active: true,
    color: '#6fa83f',
    params: { mix: 100, level: 100, sensitivity: 55, range: 60, resonance: 45, mode: 'auto', manual: 50 },
  });
  let pedals = [wah('wah-1'), wah('wah-2')];
  engine.setPedalsProvider(() => pedals);
  engine.setPresetTrimProvider(() => -6);
  const source = new fake.classes.GainNode(context);
  engine.createProcessingGraph(source);

  const stage = engine.outputStage;
  assert.ok(stage, '엔진이 출력 단계를 만들었다');
  const trim = stage.presetTrim;
  assert.ok(Math.abs(trim.gain.value - gainOf(-6)) < 1e-9, '그래프를 만들 때 trim 의 처음 값은 스토어(provider) 값이다');
  assert.equal(trim.gain.automation.length, 0, '처음 값은 램프 없이 바로 둔다(아직 소리가 흐르기 전이다)');

  assert.equal(stage.output, engine.outputTap, '출력 단계의 출력은 level-meter#out 이다');
  assert.ok(stage.limiter.connectsTo(engine.outputTap), '리미터 뒤에 level-meter#out');
  assert.ok(fake.pathExists(stage.input, stage.limiter), '마스터 게인에서 리미터까지 이어진다');
  assert.ok(stage.input.connectsTo(engine.outputGuard) && engine.outputGuard.connectsTo(stage.limiter), '마스터 게인 → 가드 → 리미터');
  assert.equal(stage.limiter.processorName, app.LIMITER_PROCESSOR_NAME);
  assert.ok(stage.output.connectsTo(context.destination), '스피커는 리미터 출력을 받는다');
  assert.ok(stage.output.connectsTo(engine.outputMeter.input), '파형 분석은 리미터 출력을 받는다');
  assert.deepEqual(
    fake.created().filter((node) => node.connectsTo(context.destination)),
    [stage.output],
    '스피커로 가는 길은 리미터 출력 하나뿐이다(리미터를 건너뛰는 연결이 없다)',
  );

  engine.createRecorderStream();
  assert.ok(stage.output.connectsTo(engine.recorderDestination), '녹음은 같은 리미터 출력을 받는다');
  assert.deepEqual(
    fake.created().filter((node) => node.connectsTo(engine.recorderDestination)),
    [stage.output],
    '녹음으로 가는 길도 리미터 출력 하나뿐이다',
  );

  // 처음 그래프에는 체인에 이펙터가 아직 없다(rebuild 전). 체인을 만들면 끝이 trim 으로 들어간다.
  engine.rebuildChain();
  await engine.rebuildQueue;
  const [first, second] = pedals.map((pedal) => engine.effects.get(pedal.id));
  assert.ok(first && second, '엔진이 페달마다 이펙터를 만들었다');
  assert.ok(engine.chainInput.connectsTo(first.input), '체인 입력 → 첫 이펙터');
  assert.ok(first.output.connectsTo(second.input), '이펙터 → 다음 이펙터');
  assert.ok(second.output.connectsTo(trim), '체인 끝은 마스터 게인이 아니라 trim 에 이어진다');
  assert.deepEqual(
    fake.created().filter((node) => node.connectsTo(stage.input)),
    [trim],
    '마스터 게인으로 들어오는 길은 trim 하나뿐이다(체인 끝이 마스터 게인으로 곧장 가지 않는다)',
  );

  pedals = [];
  engine.rebuildChain();
  await engine.rebuildQueue;
  assert.ok(engine.chainInput.connectsTo(trim), '이펙터가 없으면 체인 입력이 곧바로 trim 에 이어진다');
  assert.ok(!engine.chainInput.connectsTo(stage.input), '이펙터가 없어도 마스터 게인으로 곧장 가지 않는다');

  // --- trim 변경은 램프로 옮기고, 허용 범위로 자른다 -------------------------------------------------
  const directBefore = trim.gain.directAssignments;
  context.currentTime = 1.5;
  engine.setPresetTrimDb(-3);
  const ramp = trim.gain.automation.at(-1);
  assert.ok(ramp, 'trim 변경이 예약되지 않았다');
  assert.equal(ramp.kind, 'linear', 'trim 변경은 직선 램프다');
  assert.ok(Math.abs(ramp.value - gainOf(-3)) < 1e-9);
  assert.ok(Math.abs(ramp.time - (1.5 + app.PRESET_TRIM_RAMP_SECONDS)) < 1e-9, '램프는 지금부터 PRESET_TRIM_RAMP_SECONDS 뒤에 끝난다');
  engine.setPresetTrimDb(99);
  const clamped = trim.gain.automation.at(-1);
  assert.ok(Math.abs(clamped.value - gainOf(app.clampTrimDb(99))) < 1e-9, '허용 범위 밖 trim 은 잘라서 쓴다');
  assert.ok(clamped.value < gainOf(99), '잘리지 않은 값이 그대로 들어가지 않았다');
  assert.equal(trim.gain.directAssignments, directBefore, 'trim 변경은 직접 대입이 아니라 램프다(클릭 소리 방지)');

  harness.restore();
}

// ---------------------------------------------------------------------------------------------
// 9. 감소량 보고(S1.5): 최근 100 ms 의 최대 이득 감소량을 포트로 알린다. 줄일 일이 없으면 보내지 않는다.
// ---------------------------------------------------------------------------------------------
{
  const REPORT_FRAMES = Math.round(SAMPLE_RATE * 0.1);
  const reportOf = (node) => node.port.messages.filter((message) => message.type === 'limiter');

  // 천장 아래 신호: 보고가 없다
  const quiet = new Processor();
  const tone = new Float32Array(REPORT_FRAMES * 4);
  for (let i = 0; i < tone.length; i += 1) tone[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
  runInQuanta(quiet, tone);
  assert.equal(quiet.port.messages.length, 0, '줄이지 않으면 메시지가 없다');

  // 큰 피크 하나: 한 번 보고하고(최대 감소량 ≈ 20·log10(2/천장) = 6.99 + 0.9 dB), 지나간 뒤 0 을 한 번 알리고, 그 뒤로는 조용하다
  const loud = new Processor();
  const burst = new Float32Array(REPORT_FRAMES * 20).fill(0.1);
  burst[200] = 2;
  runInQuanta(loud, burst);
  const reports = reportOf(loud);
  assert.ok(reports.length >= 2, `감소를 알리고 끝났음도 알린다: ${JSON.stringify(reports)}`);
  const expectedDb = -20 * Math.log10(CEILING / 2);
  assert.ok(Math.abs(reports[0].maxGrDb - expectedDb) < 0.01, `첫 보고는 최대 감소량 ${expectedDb.toFixed(2)} dB: ${reports[0].maxGrDb}`);
  assert.ok(reports[0].frame >= REPORT_FRAMES && reports[0].frame <= REPORT_FRAMES + 128, `보고 시각(frame)은 100 ms 쯤: ${reports[0].frame}`);
  assert.ok(reports.every((report) => report.frame % 128 === 0), '보고는 렌더 양자 끝(frame)에 붙는다');
  const last = reports.at(-1);
  assert.ok(last.maxGrDb < 0.05, `마지막 보고는 '줄이지 않음'이다: ${last.maxGrDb}`);
  const decreasing = reports.map((report) => report.maxGrDb);
  assert.deepEqual(decreasing, [...decreasing].sort((a, b) => b - a), '릴리즈 동안 보고되는 감소량은 줄어든다');
  assert.ok(reports.length < 12, `릴리즈가 끝나면 보고가 멈춘다: ${reports.length}`);
  const countBefore = loud.port.messages.length;
  runInQuanta(loud, new Float32Array(REPORT_FRAMES * 5).fill(0.1));
  assert.equal(loud.port.messages.length, countBefore, '이미 0 을 알렸으면 더 보내지 않는다');

  // 지속되는 과입력: 100 ms 마다 계속 알린다(천장 ÷ 1.5 → 약 4.4 dB)
  const steady = new Processor();
  const loudTone = new Float32Array(REPORT_FRAMES * 10);
  for (let i = 0; i < loudTone.length; i += 1) loudTone[i] = 1.5 * Math.sin((2 * Math.PI * 500 * i) / SAMPLE_RATE);
  runInQuanta(steady, loudTone);
  const sustained = reportOf(steady);
  assert.ok(sustained.length >= 8, `지속 과입력에서는 계속 보고한다: ${sustained.length}`);
  const settled = sustained.at(-1).maxGrDb;
  assert.ok(Math.abs(settled - -20 * Math.log10(CEILING / 1.5)) < 0.3, `정상 상태 감소량 ≈ 4.4 dB: ${settled}`);
}

console.log('Master limiter (lookahead 1 ms, ceiling −1 dBFS, release 80 ms, GR report), OutputStage wiring and recording route passed');
