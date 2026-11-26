// React 컴포넌트를 Node 에서 실제로 그려 보는 도구(S4.7). 소스를 글자로 읽는 대신 `renderToStaticMarkup` 으로 그린 결과를 묻는다.
//
//   const h = await createSsrHarness({ extraExports: ["{ DelayPedal } from './components/effects/DelayPedal.tsx'"] });
//   const tree = h.render(h.exports.DelayPedal, { pedalId: 'delay' });   // html-tree 의 트리
//
// `stubs` 는 컴포넌트가 가져오는 모듈 하나를 기록용 가짜로 바꾼다 — 예: ToggleSwitch 를 바꿔 "Sync 스위치가 어떤 onChange 를 받았나" 를 꺼내
// 직접 불러 본다(실제 클릭 대신 처리기를 호출해 스토어가 바뀌는지 본다). 키는 src 기준 경로(확장자 없이), 값은 가짜 모듈의 TSX 소스다.
// 가짜 모듈은 전역 `__ssrCalls`(배열)에 받은 props 를 쌓는다.
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './esbuild-plugins.mjs';
import { parseHtml } from './html-tree.mjs';

const srcDir = fileURLToPath(new URL('../../src', import.meta.url));
let instanceCounter = 0;

export async function createSsrHarness({ extraExports = [], stubs = {}, windowOverrides = {}, define = {}, documentOverrides = null } = {}) {
  const stubPlugin = {
    name: 'ssr-stubs',
    setup(builder) {
      // 상대 경로는 src 기준 경로(확장자 없이), 패키지 이름('react-dom/client')은 그대로 키로 쓴다.
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === 'ssr-stub' || args.kind === 'entry-point') return undefined;
        const key = args.path.startsWith('.')
          ? path.relative(srcDir, path.resolve(args.resolveDir, args.path)).split(path.sep).join('/').replace(/\.(?:tsx?|jsx?)$/, '')
          : args.path;
        return key in stubs ? { path: key, namespace: 'ssr-stub' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'ssr-stub' }, (args) => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: srcDir }));
    },
  };
  const contents = [
    "export { createElement } from 'react';",
    "export { renderToStaticMarkup } from 'react-dom/server.node';",
    ...extraExports.map((entry) => `export ${entry};`),
  ].join('\n');
  const bundle = await build({
    plugins: [stubPlugin, workerUrlStub],
    stdin: { contents, resolveDir: srcDir, sourcefile: 'ssr-harness-entry.ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    jsx: 'automatic',
    // Vite 가 빌드 때 채워 주는 값. 앱은 이 저장소 주소 아래(/Guitar-Pedalboard/)에 올라간다.
    define: {
      'import.meta.env.BASE_URL': '"/Guitar-Pedalboard/"',
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'import.meta.env.MODE': '"production"',
      ...define,
    },
    // react-dom/server.node 는 CommonJS 라 node 내장 모듈을 require 로 부른다. ESM 묶음에서도 쓸 수 있게 require 를 만들어 둔다.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(process.cwd() + '/');" },
    write: false,
    logLevel: 'silent',
  });

  const storage = new Map();
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  if (documentOverrides) globalThis.document = documentOverrides;
  const calls = [];
  globalThis.__ssrCalls = calls;
  globalThis.window = originalWindow ?? {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args),
    ...windowOverrides,
  };

  // 이미 window 가 있으면(다른 시험이 만들어 둔 것) 덮어쓰지 않고 필요한 값만 얹었다가 restore() 에서 되돌린다.
  const savedWindowValues = new Map();
  if (originalWindow !== undefined) {
    for (const [key, value] of Object.entries(windowOverrides)) {
      savedWindowValues.set(key, Object.getOwnPropertyDescriptor(originalWindow, key));
      originalWindow[key] = value;
    }
  }

  const { createElement, renderToStaticMarkup, ...exports } = await import(
    // 같은 묶음을 다시 불러도 새로 실행되도록(main.tsx 처럼 불러올 때 실행되는 모듈) 주소를 매번 다르게 만든다.
    `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# ssr-harness-instance=${(instanceCounter += 1)}`).toString('base64')}`
  );
  return {
    exports,
    createElement,
    storage,
    /** 가짜 모듈이 받은 props(렌더 순서대로) */
    calls,
    /** 컴포넌트를 그려 요소 트리로 돌려준다. */
    render(component, props = {}) {
      return parseHtml(renderToStaticMarkup(createElement(component, props)));
    },
    html(component, props = {}) {
      return renderToStaticMarkup(createElement(component, props));
    },
    /** 이미 만든 React 요소(예: 클래스 컴포넌트 인스턴스의 render() 결과)를 그려 트리로 돌려준다. */
    renderElement(element) {
      return parseHtml(renderToStaticMarkup(element));
    },
    restore() {
      delete globalThis.__ssrCalls;
      if (documentOverrides) {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
      }
      for (const [key, descriptor] of savedWindowValues) {
        if (descriptor) Object.defineProperty(originalWindow, key, descriptor);
        else delete originalWindow[key];
      }
      if (originalWindow === undefined) delete globalThis.window;
    },
  };
}
