// AudioEngine 을 Node 에서 가짜 오디오 위에 올려 돌리는 도구(S4.7).
//
// 예전 시험은 `AudioEngine.ts` 소스를 글자로 읽어 `/case 'autoWah':[\s\S]*return new AutoWahEffect/` 같은 정규식으로 확인했다.
// 이 도구는 진짜 AudioEngine 을 esbuild 로 묶어 가짜 AudioContext 위에서 실행한다. 시험은 엔진이 만든 이펙터 종류,
// 워클릿 모듈로 넘긴 Blob 내용, 세션이 끝날 때 해제한 주소 같은 **실행 결과** 를 묻는다.
//
// 쓰는 법:
//   const h = await createEngineHarness({ extraExports: ["{ envelopeFollowerProcessorSource } from './audio/worklets/envelope-follower-processor.ts'"] });
//   const effect = h.engine.createEffect(pedal);
//   await h.loadWorklets();            // h.workletModules / h.blobs 로 결과 확인
//   h.engine.releaseGraph();           // h.revokedUrls 로 해제한 주소 확인
//   h.restore();
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './esbuild-plugins.mjs';
import { installFakeAudio } from './fake-audio.mjs';

const srcDir = fileURLToPath(new URL('../../src', import.meta.url));

/** `extraExports` 는 `{ a, b } from './path.ts'` 꼴 문자열 목록이다(src 기준). */
export async function createEngineHarness({ extraExports = [], contextOverrides = {} } = {}) {
  const contents = [
    "export { AudioEngine } from './audio/AudioEngine.ts';",
    ...extraExports.map((entry) => `export ${entry};`),
  ].join('\n');
  const bundle = await build({
    plugins: [workerUrlStub],
    stdin: { contents, resolveDir: srcDir, sourcefile: 'engine-harness-entry.ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  });

  const fake = installFakeAudio();
  const originalWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = originalWindow ?? {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
    },
    dispatchEvent() { return true; },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args),
  };

  const blobs = [];
  const revokedUrls = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = (blob) => {
    const url = original.create.call(URL, blob);
    blobs.push({ url, blob });
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
    original.revoke.call(URL, url);
  };

  const workletModules = [];
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const { AudioEngine, ...exports } = module;
  const engine = AudioEngine.getInstance();
  const context = fake.createContext({
    currentTime: 0,
    audioWorklet: { addModule: async (url) => { workletModules.push(url); } },
    destination: Object.assign(new fake.classes.GainNode(null), { kind: 'destination' }),
    ...contextOverrides,
  });
  engine.context = context;

  return {
    fake,
    engine,
    context,
    exports,
    blobs,
    revokedUrls,
    workletModules,
    /** window.localStorage 가짜가 담고 있는 값(저장소 시험용) */
    storage,
    /** 비공개 loadWorklets() 를 그대로 부른다(실제 start 경로가 부르는 함수). */
    async loadWorklets() {
      await engine.loadWorklets();
      return Promise.all(blobs.map(async ({ url, blob }) => ({ url, text: await blob.text() })));
    },
    restore() {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
      if (originalWindow === undefined) delete globalThis.window;
      fake.restore();
    },
  };
}
