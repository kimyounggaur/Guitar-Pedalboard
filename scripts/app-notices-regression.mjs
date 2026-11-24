// S2.4 다른 탭 경고·새 버전 알림 시험(설계서 4.7절 변환 절차 6, S2.4 변경 5와 수용 기준).
//
//   1. 다른 탭 경고  v1 키에 값이 쓰일 때만(지우기·다른 키·v2 키는 아니다) 경고를 띄운다. 한 번 띄운 뒤 일정 시간은 다시 띄우지 않는다.
//                   설계서에 적힌 문구 그대로, 닫을 때까지 남는 경고다.
//   2. 새 버전 알림  이미 제어하던 서비스 워커가 새것으로 바뀔 때만 '연주를 마친 뒤 새로고침' 알림을 띄운다(처음 설치는 아니다).
//                   알림만 띄우고 새로고침하지 않는다 — 사람이 '새로고침' 을 눌렀을 때 한 번만 부른다.
//   3. 자동 새로고침 금지  앱 소스에 스스로 새로고침하는 길이 없다(vite-plugin-pwa 의 가상 모듈 `virtual:pwa-register` 는 자동 갱신 모드에서
//                   페이지를 스스로 다시 불러오므로 쓰지 않는다). 새로고침을 부르는 파일은 사람이 누른 버튼 안에서만 부르는 세 곳뿐이다.
//   4. 연결  main.tsx 가 두 안내를 설치하고(다른 탭 경고는 v2 모드에서만), vite.config.ts 의 서비스 워커 설정이 알림이 기대는 동작을 유지한다.
// 두 탭을 실제로 열어 보는 것, 서비스 워커를 실제로 바꿔 보는 것은 e2e 가 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

let checks = 0;
const ok = (value, message) => {
  checks += 1;
  assert.ok(value, message);
};
const equal = (actual, expected, message) => {
  checks += 1;
  assert.equal(actual, expected, message);
};
const deepEqual = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFile(join(root, file), 'utf8');

const bundle = await build({
  stdin: {
    contents: [
      "export { installCrossTabNotice, isOldVersionWrite, OLD_VERSION_TAB_MESSAGE, OLD_VERSION_TAB_TOAST_KEY, OLD_VERSION_TAB_COOLDOWN_MS } from './app/crossTabNotice.ts';",
      "export { installUpdateNotice, UPDATE_NOTICE_MESSAGE, UPDATE_NOTICE_ACTION_LABEL, UPDATE_NOTICE_TOAST_KEY } from './app/updateNotice.ts';",
      "export { STORAGE_KEYS } from './persistence/keys.ts';",
      "export { useToastStore } from './store/toastStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'app-notices-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const {
  OLD_VERSION_TAB_COOLDOWN_MS,
  OLD_VERSION_TAB_MESSAGE,
  OLD_VERSION_TAB_TOAST_KEY,
  STORAGE_KEYS,
  UPDATE_NOTICE_ACTION_LABEL,
  UPDATE_NOTICE_MESSAGE,
  UPDATE_NOTICE_TOAST_KEY,
  installCrossTabNotice,
  installUpdateNotice,
  isOldVersionWrite,
  useToastStore,
} = harness;
const toasts = () => useToastStore.getState().toasts;

/** 이벤트를 받을 수 있는 가짜 대상(window, serviceWorker 컨테이너 대신) */
function createTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
    emit(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
  };
}
const storageEvent = (key, newValue = '{}') => ({ key, newValue, oldValue: null });

/** console.warn 을 잠시 가로채 호출 수를 센다(시험 출력에 경고가 섞이지 않게). */
function withWarnings(run) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    run(warnings);
  } finally {
    console.warn = original;
  }
}

// ---------------------------------------------------------------------------------------------
// 0. 문구는 설계서에 적힌 그대로다.
// ---------------------------------------------------------------------------------------------
const design = await read('docs/refactoring-design.md');
equal(OLD_VERSION_TAB_MESSAGE, '다른 탭에서 이전 버전이 열려 있습니다. 그 탭을 닫고 새로고침해 주세요.', '다른 탭 경고 문구');
equal(UPDATE_NOTICE_MESSAGE, '새 버전이 있습니다 — 연주를 마친 뒤 새로고침', '새 버전 알림 문구');
equal(UPDATE_NOTICE_ACTION_LABEL, '새로고침', '새 버전 알림의 버튼 글자');
ok(design.includes(`'${OLD_VERSION_TAB_MESSAGE}'`), '설계서 4.7절의 다른 탭 경고 문구와 같아야 합니다');
ok(design.includes(`'${UPDATE_NOTICE_MESSAGE}'`), '설계서 S2.4 의 새 버전 알림 문구와 같아야 합니다');
ok(OLD_VERSION_TAB_COOLDOWN_MS >= 60_000, '연주 중에 경고가 자주 끼어들지 않도록 다시 띄우는 간격은 1분 이상이어야 합니다');

// ---------------------------------------------------------------------------------------------
// 1. 다른 탭 경고
// ---------------------------------------------------------------------------------------------
{
  // 1-1 어떤 이벤트가 '옛 버전 탭이 썼다'로 읽히는가
  const v1Keys = new Set([STORAGE_KEYS.v1Pedals, STORAGE_KEYS.v1Presets]);
  equal(STORAGE_KEYS.v1Pedals, 'guitar-pedalboard:pedals', 'v1 작업 상태 키');
  equal(STORAGE_KEYS.v1Presets, 'web-guitar-pedalboard-presets', 'v1 프리셋 키');
  for (const key of v1Keys) {
    ok(isOldVersionWrite({ key, newValue: '{}' }), `${key} 에 값이 쓰이면 옛 탭이다`);
    ok(isOldVersionWrite({ key, newValue: '' }), `${key} 에 빈 문자열이 쓰여도 쓰기다(지우기가 아니다)`);
    ok(!isOldVersionWrite({ key, newValue: null }), `${key} 를 지운 것은 옛 탭이 저장한 것이 아니다(설정 초기화)`);
  }
  ok(!isOldVersionWrite({ key: null, newValue: null }), 'localStorage.clear() 는 key 가 null 이다');
  ok(!isOldVersionWrite({ key: null, newValue: '{}' }), 'key 가 null 이면 무엇이든 아니다');
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    if (v1Keys.has(key)) continue;
    ok(!isOldVersionWrite({ key, newValue: '{}' }), `${name}(${key}) 는 이 앱이 지금 쓰는 키라서 경고하지 않는다`);
  }
  for (const key of ['guitar-pedalboard:pedals:corrupt-1', 'guitar-pedalboard:v2:pedals', 'web-guitar-pedalboard-presets:corrupt-1', 'other-app:pedals', 'pedals', '']) {
    ok(!isOldVersionWrite({ key, newValue: '{}' }), `${JSON.stringify(key)} 는 v1 키가 아니다`);
  }
}

{
  // 1-2 설치·해제와 경고 내용
  const target = createTarget();
  const shown = [];
  const uninstall = installCrossTabNotice({ target, show: (input) => shown.push(input), now: () => 0 });
  equal(target.listenerCount('storage'), 1, 'storage 이벤트를 하나만 듣는다');
  equal(target.listenerCount('message'), 0, '그 밖의 이벤트는 듣지 않는다');
  equal(shown.length, 0, '설치만으로는 띄우지 않는다');

  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(shown.length, 1, 'v1 작업 상태 키에 쓰이면 경고를 띄운다');
  deepEqual(
    shown[0],
    { message: '다른 탭에서 이전 버전이 열려 있습니다. 그 탭을 닫고 새로고침해 주세요.', kind: 'warning', key: 'storage:old-version-tab', durationMs: 0 },
    '경고: 설계서 문구, 경고 종류, 닫을 때까지 남는다',
  );

  uninstall();
  equal(target.listenerCount('storage'), 0, '해제하면 듣기를 멈춘다');
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Presets));
  equal(shown.length, 1, '해제한 뒤에는 띄우지 않는다');
}

{
  // 1-3 프리셋 키도 같다. 이 앱의 키·지우기·전체 삭제는 경고가 아니다.
  const target = createTarget();
  const shown = [];
  installCrossTabNotice({ target, show: (input) => shown.push(input), now: () => 0 });
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Presets));
  equal(shown.length, 1, 'v1 프리셋 키에 쓰여도 띄운다');

  const quiet = createTarget();
  const quietShown = [];
  installCrossTabNotice({ target: quiet, show: (input) => quietShown.push(input), now: () => 0 });
  for (const key of Object.values(STORAGE_KEYS)) {
    if (key === STORAGE_KEYS.v1Pedals || key === STORAGE_KEYS.v1Presets) continue;
    quiet.emit('storage', storageEvent(key));
  }
  quiet.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals, null));
  quiet.emit('storage', storageEvent(STORAGE_KEYS.v1Presets, null));
  quiet.emit('storage', storageEvent(null, null));
  equal(quietShown.length, 0, '이 앱의 v2·설정 키, v1 키 지우기, 전체 삭제는 경고하지 않는다');
}

{
  // 1-4 다시 띄우는 간격: 한 번 띄운 뒤 간격 안에서는 어떤 v1 키에 쓰여도 한 번만, 간격이 지나면 다시
  let clock = 1_000_000;
  const cooldown = 10_000;
  const target = createTarget();
  const shown = [];
  installCrossTabNotice({ target, show: (input) => shown.push(input), now: () => clock, cooldownMs: cooldown });

  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(shown.length, 1, '처음 쓰기에서 띄운다');
  clock += 1;
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  clock += 5_000;
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Presets));
  clock += cooldown - 5_002; // 처음 띄운 때로부터 cooldown - 1
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(shown.length, 1, '간격 안의 쓰기(키가 달라도)는 다시 띄우지 않는다');

  clock += 1; // 처음 띄운 때로부터 정확히 cooldown
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(shown.length, 2, '간격이 지나면 다시 띄운다(경계 포함)');
  clock += 1;
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(shown.length, 2, '다시 띄운 뒤에는 새 간격이 시작된다');

  // 경고 대상이 아닌 이벤트는 간격을 소모하지 않는다.
  const fresh = createTarget();
  const freshShown = [];
  let freshClock = 0;
  installCrossTabNotice({ target: fresh, show: (input) => freshShown.push(input), now: () => freshClock, cooldownMs: cooldown });
  fresh.emit('storage', storageEvent(STORAGE_KEYS.v2State));
  fresh.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals, null));
  freshClock = 1;
  fresh.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(freshShown.length, 1, '앞선 무관한 이벤트가 간격을 먹지 않는다');
}

{
  // 1-5 안내를 못 띄워도 이벤트 처리에서 예외를 내지 않고, 다음 쓰기에서 다시 시도한다.
  const target = createTarget();
  let attempts = 0;
  const shown = [];
  installCrossTabNotice({
    target,
    show: (input) => {
      attempts += 1;
      if (attempts === 1) throw new Error('토스트를 못 띄움');
      shown.push(input);
    },
    now: () => 0,
  });
  withWarnings((warnings) => {
    target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
    equal(warnings.length, 1, '못 띄운 일은 콘솔에 한 번 남긴다');
  });
  equal(shown.length, 0, '못 띄웠다');
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(shown.length, 1, '띄우지 못한 것은 간격을 쓰지 않았으므로 다음 쓰기에서 다시 시도한다');
}

{
  // 1-6 실제 토스트 저장소: 닫을 때까지 남는 경고 하나, 간격 안에서는 늘지 않고, 닫은 뒤 간격이 지나면 다시 뜬다.
  useToastStore.getState().clear();
  let clock = 0;
  const target = createTarget();
  installCrossTabNotice({ target, now: () => clock, cooldownMs: 60_000 });
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(toasts().length, 1, '토스트가 하나 뜬다');
  const first = toasts()[0];
  equal(first.key, OLD_VERSION_TAB_TOAST_KEY, '토스트 키');
  equal(first.kind, 'warning', '경고 종류');
  equal(first.message, OLD_VERSION_TAB_MESSAGE, '문구');
  equal(first.durationMs, 0, '저절로 사라지지 않는다');
  ok(first.action === undefined, '버튼은 없다(닫기만)');

  clock = 30_000;
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(toasts().length, 1, '간격 안에서는 늘지 않는다');
  equal(toasts()[0].id, first.id, '같은 토스트가 그대로 있다(다시 그려지지 않는다)');

  useToastStore.getState().dismiss(first.id);
  equal(toasts().length, 0, '사람이 닫으면 닫힌다');
  clock = 59_999;
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(toasts().length, 0, '닫은 뒤에도 간격이 지나기 전에는 다시 뜨지 않는다');
  clock = 60_000;
  target.emit('storage', storageEvent(STORAGE_KEYS.v1Pedals));
  equal(toasts().length, 1, '간격이 지난 뒤에도 옛 탭이 계속 쓰면 다시 알린다');
  useToastStore.getState().clear();
}

// ---------------------------------------------------------------------------------------------
// 2. 새 버전 알림
// ---------------------------------------------------------------------------------------------
{
  // 2-1 서비스 워커를 쓸 수 없는 환경에서는 아무것도 하지 않는다.
  const none = installUpdateNotice({ serviceWorker: undefined, show: () => assert.fail('띄우면 안 됩니다') });
  equal(typeof none, 'function', '해제 함수를 돌려준다');
  none();
  checks += 1;

  // Node 에는 navigator.serviceWorker 가 없다 → 기본값 경로도 조용히 끝난다.
  const byDefault = installUpdateNotice();
  equal(typeof byDefault, 'function', '기본 경로도 해제 함수를 돌려준다');
  byDefault();

  // 접근만 해도 예외를 던지는 브라우저(쿠키·저장 차단)도 조용히 끝난다.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() {
      return {
        get serviceWorker() {
          throw new Error('SecurityError');
        },
      };
    },
  });
  try {
    const guarded = installUpdateNotice({ show: () => assert.fail('띄우면 안 됩니다') });
    equal(typeof guarded, 'function', 'serviceWorker 접근이 예외를 던져도 설치가 끝난다');
    guarded();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}

{
  // 2-2 처음 설치: 제어하던 서비스 워커가 없다가 생기는 것은 업데이트가 아니다. 그 뒤의 교체는 업데이트다.
  const container = createTarget({ controller: null });
  const shown = [];
  installUpdateNotice({ serviceWorker: container, show: (input) => shown.push(input), reload: () => assert.fail('새로고침하면 안 됩니다') });
  equal(container.listenerCount('controllerchange'), 1, 'controllerchange 를 하나만 듣는다');
  container.emit('controllerchange');
  equal(shown.length, 0, '처음 설치로 넘겨받는 것은 알리지 않는다');
  container.emit('controllerchange');
  equal(shown.length, 1, '그 뒤의 교체는 업데이트라서 알린다(같은 탭을 계속 쓰는 경우)');
}

{
  // 2-3 이미 제어하던 서비스 워커가 있는 탭: 교체되면 알리고, 알리기만 한다.
  let reloads = 0;
  const container = createTarget({ controller: { state: 'activated' } });
  const shown = [];
  const uninstall = installUpdateNotice({ serviceWorker: container, show: (input) => shown.push(input), reload: () => (reloads += 1) });
  equal(shown.length, 0, '설치만으로는 알리지 않는다');
  container.emit('controllerchange');
  equal(shown.length, 1, '새 서비스 워커가 넘겨받으면 알린다');
  const input = shown[0];
  equal(input.message, '새 버전이 있습니다 — 연주를 마친 뒤 새로고침', '문구');
  equal(input.kind, 'info', '경고가 아니라 안내');
  equal(input.key, UPDATE_NOTICE_TOAST_KEY, '키');
  equal(input.durationMs, 0, '저절로 사라지지 않는다(연주 중에 놓쳐도 남는다)');
  equal(input.action?.label, '새로고침', '버튼 글자');
  equal(reloads, 0, '알리는 것만으로는 새로고침하지 않는다(자동 새로고침 금지)');
  input.action.onAction();
  equal(reloads, 1, '사람이 버튼을 누르면 새로고침을 한 번 부른다');
  uninstall();
  equal(container.listenerCount('controllerchange'), 0, '해제하면 듣기를 멈춘다');
  container.emit('controllerchange');
  equal(shown.length, 1, '해제한 뒤에는 알리지 않는다');
  equal(reloads, 1, '그 뒤에도 새로고침하지 않는다');
}

{
  // 2-4 controller 가 undefined 인 구현도 '없음'이다. 안내를 못 띄워도 예외를 내지 않는다.
  const container = createTarget({ controller: undefined });
  const shown = [];
  installUpdateNotice({ serviceWorker: container, show: (input) => shown.push(input) });
  container.emit('controllerchange');
  equal(shown.length, 0, 'controller 가 undefined 면 처음 설치로 본다');

  const failing = createTarget({ controller: {} });
  installUpdateNotice({
    serviceWorker: failing,
    show: () => {
      throw new Error('토스트를 못 띄움');
    },
  });
  withWarnings((warnings) => {
    failing.emit('controllerchange');
    equal(warnings.length, 1, '못 띄운 일은 콘솔에 한 번 남긴다');
  });
}

{
  // 2-5 실제 토스트 저장소: 닫을 때까지 남는 안내 하나, 여러 번 바뀌어도 하나, 버튼이 새로고침을 부른다.
  useToastStore.getState().clear();
  let reloads = 0;
  const container = createTarget({ controller: {} });
  installUpdateNotice({ serviceWorker: container, reload: () => (reloads += 1) });
  container.emit('controllerchange');
  container.emit('controllerchange');
  equal(toasts().length, 1, '여러 번 바뀌어도 알림은 하나');
  const toast = toasts()[0];
  equal(toast.key, UPDATE_NOTICE_TOAST_KEY, '키');
  equal(toast.kind, 'info', '종류');
  equal(toast.message, UPDATE_NOTICE_MESSAGE, '문구');
  equal(toast.durationMs, 0, '닫을 때까지 남는다');
  equal(toast.action?.label, '새로고침', '버튼');
  equal(reloads, 0, '알림이 떠 있는 동안에도 새로고침은 일어나지 않았다');
  toast.action.onAction();
  equal(reloads, 1, '버튼이 새로고침을 부른다');
  useToastStore.getState().clear();
}

// ---------------------------------------------------------------------------------------------
// 3. 자동 새로고침 금지(소스 훑기)
// ---------------------------------------------------------------------------------------------
async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}
const files = await sourceFiles(join(root, 'src'));
const relativeName = (file) => relative(join(root, 'src'), file).split(sep).join('/');
const withText = await Promise.all(files.map(async (file) => ({ name: relativeName(file), text: await readFile(file, 'utf8') })));

deepEqual(
  withText.filter(({ text }) => text.includes('virtual:pwa-register')).map(({ name }) => name),
  [],
  '`virtual:pwa-register` 는 자동 갱신 모드에서 새 서비스 워커가 켜지면 페이지를 스스로 다시 불러온다 — 쓰지 않는다',
);
deepEqual(
  withText.filter(({ text }) => text.includes('.reload(')).map(({ name }) => name).sort(),
  ['app/AppErrorBoundary.tsx', 'app/staticFallback.ts', 'app/updateNotice.ts'],
  '새로고침을 부르는 파일: 오류 화면의 버튼, 정적 안내의 버튼, 새 버전 알림의 버튼뿐이어야 합니다(새 곳이 생기면 사람이 누른 동작 안인지 확인하고 목록에 적는다)',
);
for (const name of ['app/AppErrorBoundary.tsx', 'app/staticFallback.ts']) {
  // 오류 화면과 정적 안내는 사람이 누르는 버튼 쪽 코드다.
  ok(withText.some((file) => file.name === name), `${name} 이 있어야 합니다`);
}

// ---------------------------------------------------------------------------------------------
// 4. 연결: main.tsx 와 서비스 워커 설정
// ---------------------------------------------------------------------------------------------
const main = await read('src/main.tsx');
ok(main.includes("import { installCrossTabNotice } from './app/crossTabNotice';"), 'main.tsx 가 다른 탭 경고를 불러온다');
ok(main.includes("import { installUpdateNotice } from './app/updateNotice';"), 'main.tsx 가 새 버전 알림을 불러온다');
const mainLines = main.split('\n').map((line) => line.trim());
ok(
  mainLines.includes("if (getBoot().mode === 'v2') installCrossTabNotice();"),
  '다른 탭 경고는 v2 모드로 열렸을 때만 설치한다(옛 방식 모드의 탭은 v1 키에 쓰는 것이 정상이다)',
);
ok(mainLines.includes('installUpdateNotice();'), '새 버전 알림은 저장 모드와 상관없이 설치한다');
ok(main.includes("import { getBoot } from './persistence/appData';"), 'main.tsx 가 저장 모드를 읽는다');

const viteConfig = await read('vite.config.ts');
ok(viteConfig.includes("registerType: 'autoUpdate'"), '새 버전은 자동으로 받는다(알림이 있으니 사람에게 새로고침만 맡긴다)');
ok(viteConfig.includes('skipWaiting: true'), '새 서비스 워커가 곧바로 켜진다');
ok(viteConfig.includes('clientsClaim: true'), '켜진 서비스 워커가 열린 탭을 넘겨받는다 — 새 버전 알림이 기대는 controllerchange 가 이때 온다');

console.log(`app notices regression passed (${checks} checks)`);
