// React 컴포넌트를 Node 에서 실제로 그려 보는 도구(S4.7). 소스를 글자로 읽는 대신 `renderToStaticMarkup` 으로 그린 결과를 묻는다.
//
//   const h = await createSsrHarness({ extraExports: ["{ DelayPedal } from './components/effects/DelayPedal.tsx'"] });
//   const tree = h.render(h.exports.DelayPedal, { pedalId: 'delay' });   // html-tree 의 트리
//
// 처리기·효과도 시험할 수 있다:
//   · `h.hosts` — 그린 DOM 요소(button·input 등)가 받은 props. `h.findHost('button', (props) => hostText(props.children) === 'A')?.props.onClick()` 처럼 처리기를 직접 불러 스토어가 바뀌는지 본다.
//   · `h.runEffects()` — 렌더 중 등록된 useEffect 를 실행하고(서버 렌더는 효과를 돌리지 않는다), 돌려준 정리 함수들을 `cleanups` 로 준다.
//   · `h.serverState(store, patch)` — zustand 는 서버 렌더에서 스토어의 '처음 상태' 를 그린다. 그 처음 상태를 잠시 바꿔 다른 상태의 화면을 그려 본다(돌려주는 함수를 부르면 되돌린다).
//   · `h.render(Component, props, { states: { 0: true } })` — 렌더 안 useState 의 초기값을 순서(0부터)로 정해 '메뉴가 열린' 같은 화면을 그린다. 처리기가 부른 setState 는 `h.stateSets` 에 쌓인다.
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

// 그린 DOM 요소(문자열 타입)의 props 를 globalThis.__ssrHosts 에 쌓는 jsx 런타임.
const HOST_RECORDING_JSX_RUNTIME = `import * as real from 'react/jsx-runtime';
const record = (type: unknown, props: unknown) => { if (typeof type === 'string') (globalThis as any).__ssrHosts?.push({ type, props }); };
export const Fragment = real.Fragment;
export function jsx(type: any, props: any, key?: any) { record(type, props); return real.jsx(type, props, key); }
export function jsxs(type: any, props: any, key?: any) { record(type, props); return real.jsxs(type, props, key); }`;

// src 안의 모듈이 부르는 useEffect 를 globalThis.__ssrEffects 에 쌓는 react(서버 렌더는 효과를 돌리지 않으므로 직접 돌릴 수 있게 한다).
const EFFECT_RECORDING_REACT = `import * as React from 'react';
export * from 'react';
export default React;
export function useEffect(effect: any, deps?: any) { (globalThis as any).__ssrEffects?.push({ effect, deps }); }
export const useLayoutEffect = useEffect;
// useState: 렌더 순서(0, 1, …)로 초기값을 바꿔 줄 수 있고(메뉴가 열린 화면 등), setState 호출은 globalThis.__ssrState.sets 에 쌓는다.
export function useState(initial: any) {
  const control = (globalThis as any).__ssrState;
  if (!control) return React.useState(initial);
  const index = control.index++;
  const [value] = React.useState(index in control.initial ? control.initial[index] : initial);
  return [value, (action: unknown) => { control.sets.push({ index, action }); }];
}`;

/** props.children 에서 글자만 모은다(요소는 그 아이들을 이어서 모은다). */
export function hostText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(hostText).join('');
  return hostText(node.props?.children);
}

export async function createSsrHarness({ extraExports = [], stubs = {}, windowOverrides = {}, define = {}, documentOverrides = null } = {}) {
  const allStubs = { 'react/jsx-runtime': HOST_RECORDING_JSX_RUNTIME, ...stubs };
  const stubPlugin = {
    name: 'ssr-stubs',
    setup(builder) {
      // src 안에서 부르는 react 만 효과 기록용으로 바꾼다(zustand·react-dom 은 진짜 react 를 쓴다).
      builder.onResolve({ filter: /^react$/ }, (args) => (args.importer.startsWith(srcDir) ? { path: 'react', namespace: 'ssr-react' } : undefined));
      builder.onLoad({ filter: /.*/, namespace: 'ssr-react' }, () => ({ contents: EFFECT_RECORDING_REACT, loader: 'tsx', resolveDir: srcDir }));
      // 상대 경로는 src 기준 경로(확장자 없이), 패키지 이름('react-dom/client')은 그대로 키로 쓴다.
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === 'ssr-stub' || args.kind === 'entry-point') return undefined;
        const key = args.path.startsWith('.')
          ? path.relative(srcDir, path.resolve(args.resolveDir, args.path)).split(path.sep).join('/').replace(/\.(?:tsx?|jsx?)$/, '')
          : args.path;
        return key in allStubs ? { path: key, namespace: 'ssr-stub' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'ssr-stub' }, (args) => ({ contents: allStubs[args.path], loader: 'tsx', resolveDir: srcDir }));
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
      'process.env.NODE_ENV': '"production"',
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
  const hosts = [];
  const effects = [];
  globalThis.__ssrCalls = calls;
  globalThis.__ssrHosts = hosts;
  globalThis.__ssrEffects = effects;
  /** 가장 최근 렌더에서 불린 setState 들: { index(렌더 안 useState 순서), action(값 또는 함수) } */
  const stateSets = [];
  const beginRender = (states) => {
    hosts.length = 0;
    effects.length = 0;
    stateSets.length = 0;
    globalThis.__ssrState = { index: 0, initial: states, sets: stateSets };
  };
  if (originalWindow === undefined) globalThis.window = {
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
    /** 가장 최근 렌더에서 그려진 DOM 요소들의 { type, props } (문서 순서가 아니라 만들어진 순서: 안쪽 요소가 먼저) */
    hosts,
    /** 가장 최근 렌더에서 등록된 useEffect 들 */
    effects,
    findHost(type, predicate = () => true) {
      return hosts.find((host) => host.type === type && predicate(host.props)) ?? null;
    },
    findHosts(type, predicate = () => true) {
      return hosts.filter((host) => host.type === type && predicate(host.props));
    },
    /** 가장 최근 렌더 중·뒤에 불린 setState 기록(처리기가 상태를 바꾸려 했는지 볼 때 쓴다). */
    stateSets,
    /** setState 에 넘긴 값(또는 이전 값을 받는 함수)을 `current` 에 적용한 결과 */
    applyStateAction(action, current) {
      return typeof action === 'function' ? action(current) : action;
    },
    /**
     * 컴포넌트를 그려 요소 트리로 돌려준다.
     * `states`: 렌더 안 useState 호출 순서(0부터)별 초기값. 예: `{ 0: true }` 는 첫 useState 를 true 로 시작한다(열린 메뉴 화면).
     */
    render(component, props = {}, { states = {} } = {}) {
      return this.renderElement(createElement(component, props), { states });
    },
    html(component, props = {}, { states = {} } = {}) {
      beginRender(states);
      return renderToStaticMarkup(createElement(component, props));
    },
    /** 이미 만든 React 요소(예: 클래스 컴포넌트 인스턴스의 render() 결과)를 그려 트리로 돌려준다. */
    renderElement(element, { states = {} } = {}) {
      beginRender(states);
      return parseHtml(renderToStaticMarkup(element));
    },
    /** 가장 최근 렌더에서 등록된 효과를 모두 실행한다. 돌려주는 객체의 cleanup() 은 효과들이 돌려준 정리 함수를 모두 부른다. */
    runEffects() {
      const cleanups = effects.map(({ effect }) => effect()).filter((result) => typeof result === 'function');
      return { count: effects.length, cleanup: () => cleanups.forEach((cleanup) => cleanup()) };
    },
    /** zustand 의 서버 렌더가 읽는 '처음 상태' 를 잠시 바꾼다. 돌려주는 함수를 부르면 되돌린다. */
    serverState(store, patch) {
      const initial = store.getInitialState();
      const saved = Object.fromEntries(Object.keys(patch).map((key) => [key, initial[key]]));
      Object.assign(initial, patch);
      return () => Object.assign(initial, saved);
    },
    restore() {
      delete globalThis.__ssrCalls;
      delete globalThis.__ssrHosts;
      delete globalThis.__ssrEffects;
      delete globalThis.__ssrState;
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
