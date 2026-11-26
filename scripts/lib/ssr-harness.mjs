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

export async function createSsrHarness({ extraExports = [], stubs = {}, windowOverrides = {} } = {}) {
  const stubPlugin = {
    name: 'ssr-stubs',
    setup(builder) {
      builder.onResolve({ filter: /^\./ }, (args) => {
        const relative = path.relative(srcDir, path.resolve(args.resolveDir, args.path)).split(path.sep).join('/');
        const key = relative.replace(/\.(?:tsx?|jsx?)$/, '');
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
    // react-dom/server.node 는 CommonJS 라 node 내장 모듈을 require 로 부른다. ESM 묶음에서도 쓸 수 있게 require 를 만들어 둔다.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(process.cwd() + '/');" },
    write: false,
    logLevel: 'silent',
  });

  const storage = new Map();
  const originalWindow = globalThis.window;
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

  const { createElement, renderToStaticMarkup, ...exports } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
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
    restore() {
      delete globalThis.__ssrCalls;
      if (originalWindow === undefined) delete globalThis.window;
    },
  };
}
