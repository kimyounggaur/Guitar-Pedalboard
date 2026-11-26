import assert from 'node:assert/strict';
import console from 'node:console';
import { openApp } from './lib/app-browser.mjs';
import { delay } from './lib/chrome.mjs';
import { byClass, byId, byRole, byTag, find, findAll, hasClass, isElement, textContent } from './lib/html-tree.mjs';
import { createSsrHarness } from './lib/ssr-harness.mjs';

// S4.7: 화면 구조·접근성은 컴포넌트를 실제로 그려(서버 렌더) 요소와 속성을 묻고, 처리기·효과를 직접 불러 확인한다.
// 레이아웃·스타일은 실제 Chrome 이 계산한 값으로 확인한다. 소스 파일을 글자로 읽는 검사는 없다.

// ── 가짜 환경 ────────────────────────────────────────────────────────────────────────────────────────────────────
let viewportWidth = 390;
const mediaLog = []; // matchMedia 로 만든 질의와 그 질의에 단 리스너 기록
function matchMedia(query) {
  const parsed = /^\((min|max)-width: (\d+)px\)$/.exec(query);
  const entry = {
    media: query,
    get matches() {
      if (!parsed) return false;
      return parsed[1] === 'min' ? viewportWidth >= Number(parsed[2]) : viewportWidth <= Number(parsed[2]);
    },
    addEventListener(type, listener) { mediaLog.push({ op: 'add', query, type, listener }); },
    removeEventListener(type, listener) { mediaLog.push({ op: 'remove', query, type, listener }); },
    addListener() {},
    removeListener() {},
  };
  mediaLog.push({ op: 'create', query });
  return entry;
}
const navigatorMock = { onLine: true, userAgent: 'node', mediaDevices: undefined };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorMock });

const windowListeners = [];
const frames = { requested: [], cancelled: [] };
const intervals = { set: [], cleared: [] };
const windowOverrides = {
  matchMedia,
  addEventListener: (type, handler, options) => { windowListeners.push({ op: 'add', type, handler, options }); },
  removeEventListener: (type, handler, options) => { windowListeners.push({ op: 'remove', type, handler, options }); },
  requestAnimationFrame: (callback) => { frames.requested.push(callback); return frames.requested.length; },
  cancelAnimationFrame: (id) => { frames.cancelled.push(id); },
  setInterval: (callback, delay) => { intervals.set.push({ callback, delay }); return intervals.set.length; },
  clearInterval: (id) => { intervals.cleared.push(id); },
};

/** 효과가 만지는 document 의 가짜. 문서 루트 스타일 변경과 리스너 등록을 기록한다. */
function installFakeDocument({ visibilityState = 'visible' } = {}) {
  const log = { style: [], listeners: [], focused: [] };
  const original = globalThis.document;
  globalThis.document = {
    visibilityState,
    documentElement: {
      style: {
        setProperty: (name, value) => log.style.push(['set', name, value]),
        removeProperty: (name) => log.style.push(['remove', name]),
      },
    },
    addEventListener: (type, handler) => log.listeners.push(['add', type, handler]),
    removeEventListener: (type, handler) => log.listeners.push(['remove', type, handler]),
    getElementById: (id) => ({ focus: () => log.focused.push(id) }),
  };
  return {
    log,
    set visibilityState(value) { globalThis.document.visibilityState = value; },
    restore() {
      if (original === undefined) delete globalThis.document;
      else globalThis.document = original;
    },
  };
}

const MOBILE_TAB_STATE = 1; // AppShell 의 useState 순서: 0 모바일 질의 · 1 선택된 탭 · 2 도크 요소 · 3~6 사이드바 · 7 온라인 여부
const ONLINE_STATE = 7;

// ── AppShell: 탭·패널·도크·온라인 안내·정리 (자식 화면은 호출 기록으로 대신한다) ────────────────────────────────────────
const recordingStub = (name, body = 'return null;') =>
  `export function ${name}(props: any) { (globalThis as any).__ssrCalls.push({ name: '${name}', props }); ${body} }`;
const shell = await createSsrHarness({
  extraExports: [
    "{ AppShell } from './components/AppShell.tsx'",
    "{ useAudioStore } from './store/audioStore.ts'",
    "{ useMediaQuery } from './hooks/useMediaQuery.ts'",
    "{ useDockHeight } from './hooks/useDockHeight.ts'",
    "{ ko } from './i18n/ko.ts'",
  ],
  stubs: {
    'components/ConnectGuitarPanel': recordingStub('ConnectGuitarPanel', 'return <div id="stub-connect" data-mobile={String(props.isMobile)} />;'),
    'components/Meter': recordingStub('Meter', 'return <div id="stub-meter" data-active={String(props.active)} />;'),
    'components/PresetPanel': recordingStub('PresetPanel', 'return <div id="stub-preset" />;'),
    'components/PedalBoard': recordingStub('PedalBoard', 'return <div id="stub-board">{props.inputPanel}</div>;'),
    'components/ChainText': recordingStub('ChainText'),
    'components/HistoryControls': recordingStub('HistoryControls'),
    'components/GlobalKeyboardShortcuts': recordingStub('GlobalKeyboardShortcuts'),
    'components/MidiReconnectBanner': recordingStub('MidiReconnectBanner'),
  },
  windowOverrides,
});
{
  const { AppShell, useAudioStore: shellStore, useMediaQuery, useDockHeight, ko } = shell.exports;
  const callsOf = (name) => shell.calls.filter((call) => call.name === name);
  function renderShell(width, { states = {}, online = true } = {}) {
    viewportWidth = width;
    navigatorMock.onLine = online;
    shell.calls.length = 0;
    return shell.render(AppShell, {}, { states });
  }
  const panelHidden = (tree) => Object.fromEntries(findAll(tree, byRole('tabpanel')).map((panel) => [panel.attrs.id, 'hidden' in panel.attrs]));

  // 휴대폰: 맨 앞이 '페달'(기본 선택)이고 나머지 셋은 각자 패널을 가진다.
  const mobile = renderShell(390);
  const tablist = find(mobile, byRole('tablist'));
  assert.equal(tablist.attrs['aria-label'], '모바일 컨트롤 패널');
  assert.deepEqual(
    findAll(tablist, byRole('tab')).map((tab) => [tab.attrs.id, textContent(tab), tab.attrs['aria-selected'], tab.attrs.tabindex, tab.attrs['aria-controls']]),
    [
      ['mobile-tab-pedals', '페달', 'true', '0', 'pedal-board-section'],
      ['mobile-tab-input', '입력', 'false', '-1', 'mobile-panel-input'],
      ['mobile-tab-meter', '미터', 'false', '-1', 'mobile-panel-meter'],
      ['mobile-tab-preset', '프리셋', 'false', '-1', 'mobile-panel-preset'],
    ],
    "탭 순서는 페달 → 입력 → 미터 → 프리셋, 기본 선택은 '페달', '페달' 탭은 페달보드 영역을 가리킨다",
  );
  const panels = findAll(mobile, byRole('tabpanel'));
  assert.deepEqual(
    panels.map((panel) => [panel.attrs.id, panel.attrs['aria-labelledby'], panel.attrs.tabindex]),
    [
      ['mobile-panel-input', 'mobile-tab-input', '0'],
      ['mobile-panel-meter', 'mobile-tab-meter', '0'],
      ['mobile-panel-preset', 'mobile-tab-preset', '0'],
    ],
  );
  for (const panel of panels) assert.ok(find(mobile, byId(panel.attrs['aria-labelledby'])), `${panel.attrs.id}: 이름이 되는 탭이 있다`);
  assert.deepEqual(panelHidden(mobile), { 'mobile-panel-input': true, 'mobile-panel-meter': true, 'mobile-panel-preset': true }, "'페달' 탭에서는 패널이 모두 접힌다");
  assert.equal('hidden' in find(mobile, byId('mobile-control-panels')).attrs, true);
  assert.equal(hasClass(find(mobile, byTag('main')), 'mobile-dock-open'), false);
  assert.equal(find(mobile, byClass('mobile-control-dock')).attrs['aria-label'], '모바일 오디오 컨트롤');
  // 도크 토글 버튼은 없다(열림은 선택된 탭이 정한다).
  assert.equal(findAll(mobile, (node) => `${node.attrs?.class ?? ''} ${node.attrs?.id ?? ''}`.includes('dock-toggle')).length, 0);
  // 화면마다 입력·미터·프리셋 패널은 한 번씩만 그려진다(같은 상태를 가진 복사본이 둘이 되지 않는다).
  assert.deepEqual([callsOf('ConnectGuitarPanel').length, callsOf('Meter').length, callsOf('PresetPanel').length, callsOf('PedalBoard').length], [1, 1, 1, 1]);
  assert.equal(callsOf('ConnectGuitarPanel')[0].props.isMobile, true, '휴대폰 배치의 입력 패널은 모바일 안내를 보인다');
  assert.equal(callsOf('Meter')[0].props.active, false, '미터 탭이 아니면 미터는 쉰다');
  assert.equal(callsOf('PedalBoard')[0].props.inputPanel, undefined, '휴대폰은 입력 패널을 도크에 둔다(페달보드에 넘기지 않는다)');
  assert.equal(callsOf('ChainText').length, 0, '휴대폰에는 오른쪽 패널이 없다');

  // 선택된 탭이 도크의 열림·보이는 패널·미터 활성을 정한다.
  for (const [tabId, panelId] of [['input', 'mobile-panel-input'], ['meter', 'mobile-panel-meter'], ['preset', 'mobile-panel-preset']]) {
    const tree = renderShell(390, { states: { [MOBILE_TAB_STATE]: tabId } });
    assert.deepEqual(
      Object.entries(panelHidden(tree)).filter(([, hidden]) => !hidden).map(([id]) => id),
      [panelId],
      `${tabId}: 그 탭의 패널만 보인다`,
    );
    assert.equal(hasClass(find(tree, byTag('main')), 'mobile-dock-open'), true, `${tabId}: 도크가 열린다`);
    assert.equal('hidden' in find(tree, byId('mobile-control-panels')).attrs, false);
    assert.deepEqual(
      findAll(tree, byRole('tab')).map((tab) => [tab.attrs['aria-selected'], tab.attrs.tabindex]),
      ['pedals', 'input', 'meter', 'preset'].map((id) => (id === tabId ? ['true', '0'] : ['false', '-1'])),
      `${tabId}: 선택된 탭만 탭 순서에 있다`,
    );
    assert.equal(callsOf('Meter')[0].props.active, tabId === 'meter', `${tabId}: 미터는 미터 탭에서만 깨어 있다`);
  }

  // 탭을 누르면 그 탭으로, 선택된 탭을 다시 누르면 '페달' 로 돌아가 접힌다.
  const tabAfterClick = (current, tabId) => {
    renderShell(390, { states: { [MOBILE_TAB_STATE]: current } });
    shell.findHost('button', (props) => props.id === `mobile-tab-${tabId}`).props.onClick();
    const set = shell.stateSets.at(-1);
    assert.equal(set.index, MOBILE_TAB_STATE);
    return shell.applyStateAction(set.action, current);
  };
  assert.equal(tabAfterClick('pedals', 'input'), 'input');
  assert.equal(tabAfterClick('input', 'input'), 'pedals', '펼쳐진 탭을 다시 누르면 접힌다');
  assert.equal(tabAfterClick('meter', 'input'), 'input');
  assert.equal(tabAfterClick('input', 'pedals'), 'pedals');

  // 방향키·Home·End 로 탭을 옮기고 그 탭에 포커스를 준다(양 끝은 이어진다).
  const keyOnTabs = (current, key) => {
    renderShell(390, { states: { [MOBILE_TAB_STATE]: current } });
    const fake = installFakeDocument();
    const prevented = [];
    try {
      shell.findHost('button', (props) => props.id === `mobile-tab-${current}`).props.onKeyDown({ key, preventDefault: () => prevented.push(key) });
      const set = shell.stateSets.at(-1);
      return { next: set ? shell.applyStateAction(set.action, current) : null, prevented: prevented.length, focused: fake.log.focused };
    } finally {
      fake.restore();
    }
  };
  assert.deepEqual(keyOnTabs('pedals', 'ArrowRight'), { next: 'input', prevented: 1, focused: ['mobile-tab-input'] });
  assert.deepEqual(keyOnTabs('preset', 'ArrowRight'), { next: 'pedals', prevented: 1, focused: ['mobile-tab-pedals'] });
  assert.deepEqual(keyOnTabs('pedals', 'ArrowLeft'), { next: 'preset', prevented: 1, focused: ['mobile-tab-preset'] });
  assert.deepEqual(keyOnTabs('meter', 'ArrowLeft'), { next: 'input', prevented: 1, focused: ['mobile-tab-input'] });
  assert.deepEqual(keyOnTabs('meter', 'Home'), { next: 'pedals', prevented: 1, focused: ['mobile-tab-pedals'] });
  assert.deepEqual(keyOnTabs('input', 'End'), { next: 'preset', prevented: 1, focused: ['mobile-tab-preset'] });
  assert.deepEqual(keyOnTabs('input', 'a'), { next: null, prevented: 0, focused: [] }, '다른 키는 건드리지 않는다');

  // 데스크톱·태블릿: 탭이 없고 입력 패널은 페달보드로 넘어가며, 패널은 각각 한 번씩만 그려진다.
  for (const width of [1400, 1000]) {
    const tree = renderShell(width);
    assert.equal(find(tree, byRole('tablist')), null, `${width}: 하단 탭이 없다`);
    assert.equal(find(tree, byClass('mobile-control-dock')), null);
    assert.deepEqual([callsOf('ConnectGuitarPanel').length, callsOf('Meter').length, callsOf('PresetPanel').length, callsOf('ChainText').length], [1, 1, 1, 1], `${width}: 패널은 한 번씩`);
    assert.equal(callsOf('ConnectGuitarPanel')[0].props.isMobile, false);
    assert.equal(callsOf('Meter')[0].props.active, true, `${width}: 데스크톱의 미터는 늘 깨어 있다`);
    assert.notEqual(callsOf('PedalBoard')[0].props.inputPanel, undefined, `${width}: 입력 패널은 페달보드 머리말로 간다`);
    assert.ok(find(tree, byId('stub-connect')), `${width}: 입력 패널이 페달보드 안에 그려진다`);
  }

  // 오프라인 안내: 문구는 카탈로그(ko.ts) 것이고, 온라인이면 보이지 않는다.
  assert.equal(ko.notice.offlineTitle, '오프라인 상태입니다.');
  assert.equal(ko.notice.offlineBody, '기타 실시간 입력은 사용할 수 없습니다. 음원 파일 재생 모드로 톤을 확인해 주세요.');
  assert.equal(find(renderShell(390, { online: true }), byClass('offline-notice')), null);
  const offline = find(renderShell(390, { online: false }), byClass('offline-notice'));
  assert.deepEqual([offline.attrs.role, offline.attrs['aria-live']], ['status', 'polite']);
  assert.deepEqual(findAll(offline, (node) => node.tag === 'strong' || node.tag === 'span').map(textContent), [ko.notice.offlineTitle, ko.notice.offlineBody]);

  // 효과: online/offline 리스너를 달고 같은 함수로 떼며, 전역 keydown 은 달지 않는다(그건 GlobalKeyboardShortcuts 한 곳).
  const patch = { connectSavedMidi: async () => {}, disposeMidi: () => {}, disposeRecording: () => {} };
  shellStore.setState(patch);
  const restoreShellState = shell.serverState(shellStore, patch);
  const fakeShellDocument = installFakeDocument();
  try {
    windowListeners.length = 0;
    renderShell(390, { online: true });
    const mounted = shell.runEffects();
    const added = windowListeners.filter((entry) => entry.op === 'add');
    assert.deepEqual(added.map((entry) => entry.type).sort(), ['offline', 'online']);
    assert.equal(added[0].handler, added[1].handler, '두 이벤트는 같은 갱신 함수를 쓴다');
    const update = added[0].handler;
    navigatorMock.onLine = false;
    update();
    const setOnline = shell.stateSets.at(-1);
    assert.deepEqual([setOnline.index, setOnline.action], [ONLINE_STATE, false], '이벤트가 오면 navigator.onLine 으로 온라인 상태를 바꾼다');
    navigatorMock.onLine = true;
    update();
    assert.equal(shell.stateSets.at(-1).action, true);
    assert.equal(windowListeners.some((entry) => entry.type === 'keydown'), false, 'AppShell 은 keydown 리스너를 달지 않는다');
    assert.equal(fakeShellDocument.log.listeners.some(([, type]) => type === 'keydown'), false);
    mounted.cleanup();
    const removed = windowListeners.filter((entry) => entry.op === 'remove');
    assert.deepEqual(removed.map((entry) => [entry.type, entry.handler]).sort(), added.map((entry) => [entry.type, entry.handler]).sort(), '단 리스너를 그대로 뗀다');
  } finally {
    fakeShellDocument.restore();
    restoreShellState();
  }

  // 도크 높이: 도크의 실제 높이를 --dock-h 로 문서 루트에 적고, 크기가 바뀌면 다시 적고, 정리하면 지운다.
  class FakeResizeObserver {
    static instances = [];
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; FakeResizeObserver.instances.push(this); }
    observe(target, options) { this.observed.push([target, options]); }
    disconnect() { this.disconnected = true; }
  }
  globalThis.ResizeObserver = FakeResizeObserver;
  const DockProbe = ({ dock }) => { useDockHeight(dock); return null; };
  const dockDocument = installFakeDocument();
  try {
    let dockHeight = 56.2;
    const dock = { getBoundingClientRect: () => ({ height: dockHeight }) };
    shell.render(DockProbe, { dock });
    const mounted = shell.runEffects();
    assert.deepEqual(dockDocument.log.style, [['set', '--dock-h', '57px']], '처음 값은 올림한 높이');
    const observer = FakeResizeObserver.instances.at(-1);
    assert.deepEqual(observer.observed, [[dock, { box: 'border-box' }]]);
    dockHeight = 300;
    observer.callback();
    assert.deepEqual(dockDocument.log.style.at(-1), ['set', '--dock-h', '300px'], '크기가 바뀌면 다시 적는다');
    mounted.cleanup();
    assert.equal(observer.disconnected, true);
    assert.deepEqual(dockDocument.log.style.at(-1), ['remove', '--dock-h'], '정리하면 변수를 지운다');

    dockDocument.log.style.length = 0;
    FakeResizeObserver.instances.length = 0;
    shell.render(DockProbe, { dock: null });
    shell.runEffects();
    assert.deepEqual(dockDocument.log.style, [['remove', '--dock-h']], '도크가 없으면(데스크톱) 변수를 지운다');
    assert.equal(FakeResizeObserver.instances.length, 0);
  } finally {
    delete globalThis.ResizeObserver;
    dockDocument.restore();
  }

  // useMediaQuery: 질의로 matchMedia 를 부르고 'change' 에 리스너를 달았다가 같은 함수로 뗀다.
  const MediaProbe = ({ query }) => { useMediaQuery(query); return null; };
  viewportWidth = 390;
  mediaLog.length = 0;
  shell.render(MediaProbe, { query: '(max-width: 767px)' });
  const mediaMounted = shell.runEffects();
  const addedMedia = mediaLog.filter((entry) => entry.op === 'add');
  assert.deepEqual(addedMedia.map((entry) => [entry.query, entry.type]), [['(max-width: 767px)', 'change']]);
  viewportWidth = 1000;
  addedMedia[0].listener();
  assert.equal(shell.stateSets.at(-1).action, false, '질의 결과가 바뀌면 새 값을 반영한다');
  mediaMounted.cleanup();
  assert.deepEqual(mediaLog.filter((entry) => entry.op === 'remove').map((entry) => [entry.query, entry.type, entry.listener]), [['(max-width: 767px)', 'change', addedMedia[0].listener]]);
}
shell.restore();

// ── 실제 컴포넌트를 그려서 확인: 앱 전체·미터·모바일 안내·페달보드·페달 카드·딜레이/퍼즈/노이즈 게이트·프리셋·알림 영역 ──────────
const real = await createSsrHarness({
  extraExports: [
    "{ AppShell } from './components/AppShell.tsx'",
    "{ PedalBoard } from './components/PedalBoard.tsx'",
    "{ Meter } from './components/Meter.tsx'",
    "{ ConnectGuitarPanel } from './components/ConnectGuitarPanel.tsx'",
    "{ PresetPanel } from './components/PresetPanel.tsx'",
    "{ DelayPedal } from './components/effects/DelayPedal.tsx'",
    "{ FuzzPedal } from './components/effects/FuzzPedal.tsx'",
    "{ NoiseGatePedal } from './components/effects/NoiseGatePedal.tsx'",
    "{ ToastRegion } from './components/Toast.tsx'",
    "{ useAudioStore } from './store/audioStore.ts'",
    "{ usePedalStore } from './store/pedalStore.ts'",
    "{ STORAGE_KEYS } from './persistence/index.ts'",
    "{ ko } from './i18n/ko.ts'",
  ],
  windowOverrides,
});
const rangesOf = (tree) => findAll(tree, (node) => node.tag === 'input' && node.attrs.type === 'range');
let auditedRangeCount = 0;
let auditedNamedCount = 0;
{
  const { AppShell, PedalBoard, Meter, ConnectGuitarPanel, PresetPanel, DelayPedal, FuzzPedal, NoiseGatePedal, ToastRegion, useAudioStore, usePedalStore, STORAGE_KEYS, ko } = real.exports;
  const pedals = usePedalStore.getState().pedals;
  const pedalOfType = (type) => pedals.find((pedal) => pedal.type === type);
  const labelOf = (node) => node.attrs['aria-label'];

  // 튜너: 센트 막대는 role=meter 이고, 값은 -50~50 으로 잘리며, 글자는 큰 글씨 문구와 같다.
  const tunerCases = [
    [{ frequency: 83, note: 'E2', cents: 12, stringNumber: 6, targetNote: 'E2' }, '12', '12센트 높음'],
    [{ frequency: 80, note: 'E2', cents: -80, stringNumber: 6, targetNote: 'E2' }, '-50', '80센트 낮음'],
    [{ frequency: 85, note: 'E2', cents: 80, stringNumber: 6, targetNote: 'E2' }, '50', '80센트 높음'],
    [{ frequency: 82.4, note: 'E2', cents: 3, stringNumber: 6, targetNote: 'E2' }, '3', '정확함'],
  ];
  for (const [pitch, now, text] of tunerCases) {
    const restore = real.serverState(useAudioStore, { isTunerActive: true, pitch });
    try {
      const tree = real.render(Meter, {});
      const strip = find(tree, (node) => node.attrs?.role === 'meter' && labelOf(node) === '튜닝 센트');
      assert.deepEqual(
        [strip.attrs['aria-valuemin'], strip.attrs['aria-valuemax'], strip.attrs['aria-valuenow'], strip.attrs['aria-valuetext']],
        ['-50', '50', now, text],
        `센트 ${pitch.cents}: 막대 값과 문구`,
      );
      assert.equal(textContent(find(tree, byClass('tuner-status-text'))), text, '큰 글씨 문구와 막대의 문구가 같다');
    } finally {
      restore();
    }
  }
  for (const [patch, text] of [[{ isTunerActive: false }, '튜너 꺼짐'], [{ isTunerActive: true }, '신호 대기']]) {
    const restore = real.serverState(useAudioStore, patch);
    try {
      const strip = find(real.render(Meter, {}), (node) => node.attrs?.role === 'meter' && labelOf(node) === '튜닝 센트');
      assert.deepEqual([strip.attrs['aria-valuenow'], strip.attrs['aria-valuetext']], ['0', text]);
    } finally {
      restore();
    }
  }

  // 미터의 그리기 루프: 보이는 데다 켜져 있고 이 패널이 활성일 때만 돈다. 레벨 갱신 타이머는 패널과 상관없이 켜져 있는 동안 100 ms 마다.
  const refreshCalls = [];
  function mountMeter({ active, running, visibility = 'visible' }) {
    const restoreState = real.serverState(useAudioStore, { isRunning: running, refreshMeters: (...args) => refreshCalls.push(args) });
    const fake = installFakeDocument({ visibilityState: visibility });
    frames.requested.length = 0;
    frames.cancelled.length = 0;
    intervals.set.length = 0;
    intervals.cleared.length = 0;
    refreshCalls.length = 0;
    real.render(Meter, { active });
    const effects = real.effects.slice(0, 2).map((entry) => entry.deps);
    const mounted = real.runEffects();
    const visibilityHandlers = () => fake.log.listeners.filter(([op, type]) => op === 'add' && type === 'visibilitychange').map(([, , handler]) => handler);
    return { fake, effects, mounted, visibilityHandlers, done: () => { fake.restore(); restoreState(); } };
  }
  {
    const run = mountMeter({ active: true, running: true });
    try {
      assert.deepEqual(run.effects.map((deps) => deps.length), [2, 2]);
      assert.deepEqual(run.effects[0], [true, true], '그리기 효과는 [활성, 재생 중] 이 바뀔 때 다시 설정된다');
      assert.equal(run.effects[1][0], true, '타이머 효과는 재생 중 여부가 바뀔 때 다시 설정된다');
      assert.equal(frames.requested.length, 1, '보이고 켜져 있으면 프레임을 하나 요청한다');
      assert.equal(run.visibilityHandlers().length, 1, '보임 여부 변화를 지켜본다');
      assert.deepEqual(intervals.set.map((timer) => timer.delay), [100]);
      assert.equal(refreshCalls.length, 1, '타이머를 걸 때 한 번 바로 갱신한다');
      intervals.set[0].callback();
      assert.equal(refreshCalls.length, 2, '타이머가 돌면 갱신한다');
      // 프레임이 돌 때 문서가 가려졌다면 다음 프레임을 요청하지 않는다(보이지 않는 탭에서 계속 그리지 않는다).
      run.fake.visibilityState = 'hidden';
      frames.requested[0]();
      assert.equal(frames.requested.length, 1, '가려진 문서에서는 프레임이 이어지지 않는다');
      run.fake.visibilityState = 'visible';
      // 가려졌다가 다시 보이면: 가려질 때 걸려 있던 프레임을 취소하고, 보일 때 다시 요청한다.
      const handler = run.visibilityHandlers()[0];
      handler();
      assert.equal(frames.requested.length, 2, '다시 보이면 프레임을 새로 요청한다');
      run.fake.visibilityState = 'hidden';
      handler();
      assert.equal(frames.cancelled.length, 1, '가려지면 걸려 있던 프레임을 취소한다');
      assert.equal(frames.requested.length, 2);
      run.fake.visibilityState = 'visible';
      handler();
      assert.equal(frames.requested.length, 3);
      run.mounted.cleanup();
      assert.deepEqual(
        run.fake.log.listeners.filter(([op, type]) => op === 'remove' && type === 'visibilitychange').map(([, , removed]) => removed),
        [handler],
        '정리하면 보임 리스너를 같은 함수로 뗀다',
      );
      assert.equal(frames.cancelled.length, 2, '정리하면 걸려 있던 프레임을 취소한다');
      assert.deepEqual(intervals.cleared, [1], '정리하면 타이머를 끈다');
    } finally {
      run.done();
    }
  }
  for (const [name, options, expectedFrames, expectedTimers] of [
    ['비활성 패널(모바일에서 미터 탭이 아님)', { active: false, running: true }, 0, 1],
    ['재생 중이 아님', { active: true, running: false }, 0, 0],
    ['가려진 문서', { active: true, running: true, visibility: 'hidden' }, 0, 1],
  ]) {
    const run = mountMeter(options);
    try {
      assert.equal(frames.requested.length, expectedFrames, `${name}: 프레임 요청`);
      assert.equal(intervals.set.length, expectedTimers, `${name}: 레벨 갱신 타이머`);
      assert.deepEqual(run.effects[0], [options.active, options.running], `${name}: 그리기 효과의 의존 값`);
      run.mounted.cleanup();
    } finally {
      run.done();
    }
  }

  // 모바일 안내: 문구·역할·닫기 버튼, 닫으면 저장하고 다음에는 보이지 않는다.
  const noticeOf = (tree) => find(tree, byClass('mobile-audio-notice'));
  assert.equal(STORAGE_KEYS.mobileAudioNotice, 'guitar-pedalboard:mobile-audio-notice-dismissed');
  real.storage.delete(STORAGE_KEYS.mobileAudioNotice);
  assert.equal(noticeOf(real.render(ConnectGuitarPanel, { isMobile: false })), null, '데스크톱에는 모바일 안내가 없다');
  const mobileTree = real.render(ConnectGuitarPanel, { isMobile: true });
  const notice = noticeOf(mobileTree);
  assert.deepEqual([notice.attrs.role, notice.attrs['aria-label']], ['note', '모바일 오디오 안내']);
  assert.deepEqual(findAll(notice, byTag('span')).map(textContent), [
    '모바일은 입력 지연이 커서 실시간 연주에 적합하지 않습니다.',
    '음원 파일 재생 모드로 톤을 확인하거나, PC + 오디오 인터페이스 사용을 권장합니다.',
  ]);
  assert.equal(find(notice, byTag('button')).attrs['aria-label'], '모바일 오디오 안내 닫기');
  assert.equal(real.storage.has(STORAGE_KEYS.mobileAudioNotice), false, '닫기 전에는 저장된 것이 없다');
  real.findHost('button', (props) => props['aria-label'] === '모바일 오디오 안내 닫기').props.onClick();
  assert.equal(real.storage.get(STORAGE_KEYS.mobileAudioNotice), 'true', "닫으면 'true' 를 저장한다");
  assert.equal(real.stateSets.at(-1).action, true);
  assert.equal(noticeOf(real.render(ConnectGuitarPanel, { isMobile: true })), null, '닫은 뒤에는 다시 그려도 보이지 않는다');
  real.storage.delete(STORAGE_KEYS.mobileAudioNotice);

  // 페달보드: 연결 패널을 넘겨받는 자리, 신호 체인 글, 접근성 속성.
  const withInput = real.render(PedalBoard, { inputPanel: real.createElement('div', { id: 'probe-input' }) });
  const section = find(withInput, byId('pedal-board-section'));
  assert.deepEqual([section.tag, section.attrs.class], ['section', 'board-section']);
  assert.ok(find(section, byId('probe-input')), '넘겨받은 입력 패널이 페달보드 영역 안에 그려진다');
  assert.equal(find(real.render(PedalBoard, {}), byId('probe-input')), null);
  const chain = find(withInput, byClass('signal-chain-text'));
  assert.deepEqual(
    [chain.attrs.role, chain.attrs['aria-label'], chain.attrs['aria-live'], chain.attrs['aria-atomic'], chain.attrs.tabindex],
    ['region', '현재 신호 체인', 'polite', 'true', '0'],
  );
  assert.deepEqual(findAll(chain, byClass('chain-endpoint')).map(textContent), ['기타 입력', '출력']);
  assert.deepEqual(findAll(chain, byClass('chain-effect-pill')).map(textContent), pedals.map((pedal) => pedal.name), '체인 글은 페달 순서를 그대로 보인다');
  for (const arrow of findAll(chain, byClass('chain-arrow'))) assert.equal(arrow.attrs['aria-hidden'], 'true', '화살표는 장식이다');

  // 딜레이·퍼즈의 모드 노브는 모드 이름을 읽어 준다. LED 는 장식이라 이름 없이 숨긴다.
  const delayPedal = pedalOfType('delay');
  const delayModes = [['digital', 'Digital'], ['analog', 'Analog'], ['tape', 'Tape'], ['slapback', 'Slapback'], ['pingpong', 'Pingpong']];
  for (const [index, [mode, label]] of delayModes.entries()) {
    const tree = real.render(DelayPedal, { pedalId: delayPedal.id, params: { ...delayPedal.params, mode }, onChange() {} });
    const modeRange = rangesOf(tree).find((range) => labelOf(range) === 'Mode');
    assert.equal(modeRange.attrs['aria-valuetext'], `Mode ${label}`, `딜레이 ${mode}`);
    assert.equal(modeRange.attrs.value, String(index), `딜레이 ${mode}: 노브 값은 모드 순서`);
    const led = find(tree, byClass('delay-led'));
    assert.deepEqual([led.attrs['aria-hidden'], led.attrs['aria-label'], led.attrs.role], ['true', undefined, undefined]);
  }
  const fuzzPedal = pedalOfType('fuzz');
  for (const [index, [mode, label]] of [['classic', 'Classic'], ['gated', 'Gated'], ['velcro', 'Velcro']].entries()) {
    const tree = real.render(FuzzPedal, { params: { ...fuzzPedal.params, mode }, onChange() {} });
    const modeRange = rangesOf(tree).find((range) => labelOf(range) === 'Mode');
    assert.equal(modeRange.attrs['aria-valuetext'], `Mode ${label}`, `퍼즈 ${mode}`);
    assert.equal(modeRange.attrs.value, String(index));
  }
  const gatePedal = pedalOfType('noiseGate');
  const gateLeds = findAll(real.render(NoiseGatePedal, { pedalId: gatePedal.id, params: gatePedal.params, onChange() {} }), (node) => String(node.attrs?.class ?? '').split(' ').includes('noise-gate-led'));
  assert.equal(gateLeds.length, 1);
  assert.deepEqual([gateLeds[0].attrs['aria-hidden'], gateLeds[0].attrs['aria-label']], ['true', undefined], '노이즈 게이트 LED 는 이름 없이 숨긴다');

  // 프리셋 패널의 목록은 ul > li 이고 role 을 덮어쓰지 않는다.
  const presetTree = real.render(PresetPanel, {});
  const lists = findAll(presetTree, byTag('ul'));
  assert.deepEqual(lists.map((list) => [list.attrs.class, labelOf(list)]), [['preset-library-list', '프리셋 라이브러리'], ['preset-list', '프리셋 목록']]);
  for (const list of lists) {
    assert.ok(list.children.length > 0 && list.children.every((child) => child.tag === 'li'), `${list.attrs.class}: 자식은 모두 li`);
    assert.equal(list.attrs.role, undefined, `${list.attrs.class}: role 을 덮어쓰지 않는다(ul 의 목록 의미를 지킨다)`);
  }
  assert.ok(findAll(lists[1], byTag('li')).every((item) => hasClass(item, 'preset-item')));

  // 알림 영역은 이름 있는 region.
  const toast = find(real.render(ToastRegion, {}), byClass('toast-region'));
  assert.deepEqual([toast.attrs.role, labelOf(toast)], ['region', '알림']);

  // 페달 카드: 15종이 모두 '<이름> 이펙터' 로 이름 붙은 section 으로 그려진다. 앱 전체(휴대폰·데스크톱)에서 같다.
  const effectTypes = ['noiseGate', 'compressor', 'autoWah', 'drive', 'crunch', 'fuzz', 'graphicEQ', 'eq', 'cab', 'chorus', 'flanger', 'phaser', 'tremolo', 'delay', 'reverb'];
  assert.deepEqual(pedals.map((pedal) => pedal.type), effectTypes, '기본 체인에는 이펙터 15종이 있다');

  // 접근성 감사: 앱 전체를 그린 결과에서 이름 있는 generic 요소는 role 이 있고, 모든 range 는 이름과 값 문구가 있다.
  const genericRoles = new Set();
  function auditAccessibility(tree, where) {
    const nodes = findAll(tree, () => true).filter(isElement);
    const named = nodes.filter((node) => (node.tag === 'div' || node.tag === 'span') && node.attrs['aria-label'] !== undefined);
    const ranges = rangesOf(tree);
    for (const node of named) {
      const role = node.attrs.role;
      assert.ok(role && !['presentation', 'none', 'generic'].includes(role), `${where}: 이름 있는 ${node.tag}.${node.attrs.class ?? ''}(${node.attrs['aria-label']}) 에 이름을 가질 수 있는 role 이 필요하다`);
      genericRoles.add(role);
    }
    for (const range of ranges) {
      assert.ok(range.attrs['aria-label'], `${where}: range(${range.attrs.class ?? range.attrs.id ?? ''}) 에 aria-label 이 없다`);
      assert.ok(range.attrs['aria-valuetext'], `${where}: range(${range.attrs['aria-label']}) 에 aria-valuetext 가 없다`);
    }
    return { ranges: ranges.length, named: named.length };
  }
  for (const width of [390, 1400]) {
    viewportWidth = width;
    navigatorMock.onLine = false; // 오프라인 안내(role=status)까지 그린다
    const appTree = real.render(AppShell, {});
    navigatorMock.onLine = true;
    const cards = findAll(appTree, (node) => node.tag === 'section' && String(node.attrs['aria-label'] ?? '').endsWith(' 이펙터'));
    assert.deepEqual(cards.map(labelOf), pedals.map((pedal) => `${ko.pedal[pedal.type].name} 이펙터`), `${width}: 페달 카드 이름과 순서`);
    const audit = auditAccessibility(appTree, `${width}px 앱`);
    assert.ok(audit.ranges >= 100, `${width}: 검사한 range 가 너무 적다(${audit.ranges}) — 화면이 덜 그려졌을 수 있다`);
    assert.ok(audit.named >= 25, `${width}: 검사한 이름 있는 generic 요소가 너무 적다(${audit.named})`);
    auditedRangeCount = Math.max(auditedRangeCount, audit.ranges);
    auditedNamedCount = Math.max(auditedNamedCount, audit.named);
  }
  auditAccessibility(real.render(ToastRegion, {}), '알림 영역');
  assert.ok(['region', 'group', 'tablist', 'note', 'meter'].every((role) => genericRoles.has(role)), `감사가 다양한 role 을 봐야 한다: ${[...genericRoles]}`);
}
real.restore();

const COLOR_PROBE = `const resolveColor = (value) => {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
};`;

async function waitForLayout(app, expression, ready = () => true) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const layout = await app.evaluate(expression);
    if (layout && ready(layout)) return layout;
    await delay(50);
  }
  throw new Error('Timed out waiting for the responsive app layout.');
}

const MOBILE_LAYOUT_EXPRESSION = `(() => {
  const panels = [...document.querySelectorAll('.mobile-control-panel')];
  const board = document.querySelector('.pedal-board');
  const chain = document.querySelector('.signal-chain-text');
  if (panels.length !== 3 || !board || !chain) return null;
  const chainItems = [...chain.children];
  const interactiveTargets = [...document.querySelectorAll('button, a[href], select, textarea, input:not([type="hidden"]), [role="button"]')]
    .filter((element, index, elements) => elements.indexOf(element) === index);
  const visibleTargets = interactiveTargets.flatMap((element) => {
    const inputType = element instanceof HTMLInputElement ? element.type : '';
    let hitTarget = element;
    if (inputType === 'checkbox' || inputType === 'radio') {
      hitTarget = element.closest('label') || (element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]') : null) || element;
    }
    const rect = hitTarget.getBoundingClientRect();
    const style = getComputedStyle(hitTarget);
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return [];
    return [{ element, inputType, rect }];
  });
  const undersizedTargets = visibleTargets.flatMap(({ element, inputType, rect }) => {
    if (rect.width >= 44 && rect.height >= 44) return [];
    return [{
      tag: element.tagName.toLowerCase(),
      type: inputType || undefined,
      className: typeof element.className === 'string' ? element.className : '',
      label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 36) || '',
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    }];
  });
  const dock = document.querySelector('.mobile-control-dock');
  const tabs = [...document.querySelectorAll('.mobile-bottom-tabs [role="tab"]')];
  const px = (value) => Number.parseFloat(value);
  const toast = document.createElement('div');
  toast.className = 'chain-toast';
  document.body.appendChild(toast);
  const toastBottom = getComputedStyle(toast).bottom;
  toast.remove();
  const shell = document.querySelector('.app-shell');
  const tabsStyle = getComputedStyle(document.querySelector('.mobile-bottom-tabs'));
  const dockStyle = getComputedStyle(dock);
  const visiblePanel = panels.find((panel) => !panel.hidden);
  return {
    tabIds: tabs.map((tab) => tab.id.replace('mobile-tab-', '')),
    selectedTabId: (tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.id ?? '').replace('mobile-tab-', ''),
    dockHeight: dock.getBoundingClientRect().height,
    dockVar: document.documentElement.style.getPropertyValue('--dock-h'),
    viewportHeight: window.innerHeight,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
    visiblePanelIds: panels.filter((panel) => !panel.hidden && panel.getBoundingClientRect().width > 0).map((panel) => panel.id),
    hiddenPanelRects: panels.filter((panel) => panel.hidden).map((panel) => {
      const rect = panel.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
    boardClientWidth: board.clientWidth,
    boardScrollWidth: board.scrollWidth,
    chainClientWidth: chain.clientWidth,
    chainScrollWidth: chain.scrollWidth,
    chainOverlapCount: chainItems.slice(1).filter((item, index) => (
      chainItems[index].getBoundingClientRect().right > item.getBoundingClientRect().left
    )).length,
    checkedTargetCount: visibleTargets.length,
    undersizedTargets,
    // 스타일: 도크·탭·패널·본문 여백·토스트·보드
    dock: { position: dockStyle.position, bottom: dockStyle.bottom, maxHeight: px(dockStyle.maxHeight) },
    tabColumns: tabsStyle.gridTemplateColumns.split(' ').map(px),
    tabMinHeights: tabs.map((tab) => getComputedStyle(tab).minHeight),
    tabHeights: tabs.map((tab) => tab.getBoundingClientRect().height),
    shellPaddingBottom: px(getComputedStyle(shell).paddingBottom),
    toastBottom: px(toastBottom),
    containerDisplay: getComputedStyle(document.getElementById('mobile-control-panels')).display,
    panelDisplays: Object.fromEntries(panels.map((panel) => [panel.id, getComputedStyle(panel).display])),
    visiblePanelMaxHeight: visiblePanel ? px(getComputedStyle(visiblePanel).maxHeight) : null,
  };
})()`;

function approx(actual, expected, message, tolerance = 1) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} (기대 ${expected})`);
}

async function verifyLayoutInBrowser() {
  const app = await openApp({ purpose: 'Responsive browser geometry', viewport: { width: 390, height: 844, mobile: true }, waitFor: '.mobile-control-dock' });
  if (!app) return null;
  try {
    const viewportMeta = await app.evaluate(`document.querySelector('meta[name="viewport"]').content`);
    assert.ok(viewportMeta.split(',').map((part) => part.trim()).includes('viewport-fit=cover'), `노치 화면을 위해 viewport-fit=cover 가 필요하다: ${viewportMeta}`);

    const clickTab = (id) => app.evaluate(`document.getElementById('mobile-tab-${id}').click()`);
    // --dock-h 는 ResizeObserver 가 비동기로 갱신하므로 도크의 실제 높이와 같아질 때까지 기다린다.
    const dockVarMatches = (layout) => layout.dockVar === `${Math.ceil(layout.dockHeight)}px`;
    const settled = (tabId) => (layout) => layout.selectedTabId === tabId && dockVarMatches(layout);
    const dockVarPx = (layout) => Number.parseFloat(layout.dockVar);

    const collapsed = await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, dockVarMatches);
    assert.deepEqual(collapsed.visiblePanelIds, [], '모바일 패널은 기본 접힘 상태여야 합니다.');
    assert.deepEqual(collapsed.tabIds, ['pedals', 'input', 'meter', 'preset']);
    assert.equal(collapsed.selectedTabId, 'pedals', "기본 선택 탭은 '페달' 이어야 합니다.");
    assert.ok(collapsed.dockHeight >= 50 && collapsed.dockHeight <= 64, `접힌 도크는 탭 줄(약 56px)만 남아야 합니다: ${collapsed.dockHeight}px`);
    // 도크: 화면 아래에 붙고 최대 50dvh.
    assert.equal(collapsed.dock.position, 'fixed');
    assert.equal(collapsed.dock.bottom, '0px');
    approx(collapsed.dock.maxHeight, collapsed.viewportHeight * 0.5, '도크 최대 높이는 화면의 50%');
    // 탭 줄: 4칸 균등, 한 칸 높이 44px 이상.
    assert.equal(collapsed.tabColumns.length, 4);
    assert.ok(collapsed.tabColumns.every((width) => Math.abs(width - collapsed.tabColumns[0]) < 0.5), `탭 칸 너비가 같아야 합니다: ${collapsed.tabColumns}`);
    assert.deepEqual(collapsed.tabMinHeights, ['44px', '44px', '44px', '44px']);
    assert.ok(collapsed.tabHeights.every((height) => height >= 44), `탭 높이 ${collapsed.tabHeights}`);
    // 본문 아래 여백은 도크 높이를 따른다(도크에 가려지지 않는다). 순서 변경 알림은 도크 위 12px.
    approx(collapsed.shellPaddingBottom, dockVarPx(collapsed) + 16, '접힌 본문 아래 여백 = 도크 높이 + 16', 0.5);
    approx(collapsed.toastBottom, dockVarPx(collapsed) + 12, '접힌 알림 위치 = 도크 높이 + 12', 0.5);
    // 접힌 패널과 그 묶음은 어떤 규칙에도 보이지 않는다(프리셋 패널의 display 덮어쓰기 포함).
    assert.equal(collapsed.containerDisplay, 'none');
    assert.deepEqual(Object.values(collapsed.panelDisplays), ['none', 'none', 'none']);

    // 보드·문서: 가로로 넘기지 않고(clip), 보드 안에서만 스냅 스크롤한다.
    const board = await app.style('.pedal-board', ['display', 'gridAutoFlow', 'gridAutoColumns', 'scrollSnapType', 'overflowX']);
    assert.deepEqual([board.display, board.gridAutoFlow, board.scrollSnapType, board.overflowX], ['grid', 'column', 'x mandatory', 'auto']);
    approx(Number.parseFloat(board.gridAutoColumns), Math.min(360, Math.max(300, 0.86 * 390)), '페달 한 칸 너비 clamp(300px, 86vw, 360px)', 0.1);
    // 390px 에서는 자르개(300px·360px)가 걸리지 않으므로, 폭을 바꿔 양쪽 끝도 본다.
    for (const width of [340, 600]) {
      await app.setViewport({ width, height: 844, mobile: true });
      await app.waitFor(`window.innerWidth === ${width}`, { label: `폭 ${width}` });
      const expectedColumn = Math.min(360, Math.max(300, 0.86 * width));
      const column = await waitForLayout(
        app,
        `(() => { const board = document.querySelector('.pedal-board'); return board ? Number.parseFloat(getComputedStyle(board).gridAutoColumns) : null; })()`,
        (value) => Math.abs(value - expectedColumn) < 0.1,
      );
      approx(column, expectedColumn, `${width}px: 페달 한 칸 너비`, 0.1);
    }
    await app.setViewport({ width: 390, height: 844, mobile: true });
    await app.waitFor('window.innerWidth === 390', { label: '폭 390' });
    await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, dockVarMatches);
    assert.deepEqual(
      await app.evaluate(`[...new Set([...document.querySelectorAll('.sortable-pedal')].map((pedal) => getComputedStyle(pedal).scrollSnapAlign))]`),
      ['start'],
    );
    for (const selector of ['.app-shell', '.workspace', '.board-section']) {
      assert.equal((await app.style(selector, ['overflowX'])).overflowX, 'clip', `${selector}: 가로 넘침은 잘라 낸다`);
    }

    await clickTab('input');
    const expanded = await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, settled('input'));
    assert.deepEqual(expanded.visiblePanelIds, ['mobile-panel-input']);
    assert.ok(expanded.dockHeight > collapsed.dockHeight, '탭을 누르면 도크가 펼쳐져야 합니다.');
    assert.ok(expanded.dockHeight <= expanded.viewportHeight * 0.5 + 1, `펼친 도크는 화면 높이의 50% 이하여야 합니다: ${expanded.dockHeight}/${expanded.viewportHeight}`);
    assert.notEqual(expanded.containerDisplay, 'none');
    assert.deepEqual(expanded.panelDisplays, { 'mobile-panel-input': 'block', 'mobile-panel-meter': 'none', 'mobile-panel-preset': 'none' });
    // 패널 높이는 도크 최대 높이에서 탭 줄(58px + 안전 영역)을 뺀 값이다.
    approx(expanded.visiblePanelMaxHeight, expanded.viewportHeight * 0.5 - 58, '패널 최대 높이 = 50dvh - 탭 줄');
    approx(expanded.shellPaddingBottom, dockVarPx(expanded) + 16, '펼친 본문 아래 여백 = 도크 높이 + 16', 0.5);
    approx(expanded.toastBottom, dockVarPx(expanded) + 12, '펼친 알림 위치 = 도크 높이 + 12(도크와 겹치지 않는다)', 0.5);

    // 안내: 입력 패널 안에서 한 줄 칸으로 놓이고, 닫기 버튼은 44px 이상이며 화면 안에 있다.
    const notice = await app.evaluate(`(() => {
      const element = document.querySelector('.mobile-audio-notice');
      const close = element.querySelector('button');
      const rect = element.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      return { display: getComputedStyle(element).display, left: rect.left, right: rect.right, closeWidth: closeRect.width, closeHeight: closeRect.height, viewport: document.documentElement.clientWidth };
    })()`);
    assert.equal(notice.display, 'grid');
    assert.ok(notice.left >= 0 && notice.right <= notice.viewport, `안내가 화면 안에 있어야 합니다: ${notice.left}~${notice.right}/${notice.viewport}`);
    assert.ok(notice.closeWidth >= 44 && notice.closeHeight >= 44, `안내 닫기 버튼 ${notice.closeWidth}×${notice.closeHeight}`);

    // 안전 영역(노치·홈 막대): 아래 안전 영역이 34px 이면 패널은 그만큼 낮아지고 본문 여백은 그만큼 늘어난다.
    await app.cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34 } });
    const safe = await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, (layout) => Math.abs(layout.visiblePanelMaxHeight - (expanded.visiblePanelMaxHeight - 34)) < 0.5);
    approx(safe.shellPaddingBottom, dockVarPx(safe) + 34 + 16, '안전 영역만큼 본문 여백이 늘어난다', 0.5);
    await app.cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 0 } });
    await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, (layout) => Math.abs(layout.visiblePanelMaxHeight - expanded.visiblePanelMaxHeight) < 0.5);

    await clickTab('input');
    const retapped = await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, settled('pedals'));
    assert.deepEqual(retapped.visiblePanelIds, [], '펼쳐진 탭을 다시 누르면 접혀야 합니다.');
    assert.equal(retapped.dockHeight, collapsed.dockHeight, '다시 접으면 처음 높이로 돌아와야 합니다.');

    // 미터 탭: 튜너 상태 글은 줄을 바꿀 수 있고 색은 상태를 따른다.
    await clickTab('meter');
    await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, settled('meter'));
    const tuner = await app.evaluate(`(() => {
      ${COLOR_PROBE}
      const reading = document.querySelector('.tuner-reading');
      const status = reading.querySelector('.tuner-status-text');
      const colorWith = (state) => {
        reading.classList.remove('is-in-tune', 'is-near', 'is-far');
        if (state) reading.classList.add(state);
        return getComputedStyle(status).color;
      };
      const original = reading.className;
      const result = {
        overflowWrap: getComputedStyle(status).overflowWrap,
        idle: colorWith(null), inTune: colorWith('is-in-tune'), near: colorWith('is-near'), far: colorWith('is-far'),
        expected: { idle: resolveColor('var(--ink-muted)'), inTune: resolveColor('var(--success)'), near: resolveColor('var(--warning)'), far: resolveColor('var(--danger)') },
      };
      reading.className = original;
      return result;
    })()`);
    assert.equal(tuner.overflowWrap, 'anywhere');
    assert.deepEqual([tuner.idle, tuner.inTune, tuner.near, tuner.far], [tuner.expected.idle, tuner.expected.inTune, tuner.expected.near, tuner.expected.far], '튜너 상태 글 색');
    assert.equal(new Set([tuner.idle, tuner.inTune, tuner.near, tuner.far]).size, 4, '네 상태의 색이 서로 달라야 합니다.');
    await clickTab('meter');
    await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, settled('pedals'));

    // 실제 키 입력: 탭에서 →키는 다음 탭을 고르고 거기로 포커스를 옮긴다.
    await app.evaluate(`document.getElementById('mobile-tab-pedals').focus()`);
    await app.press('ArrowRight', { code: 'ArrowRight' });
    const afterKey = await waitForLayout(app, `(() => ({ active: document.activeElement.id, selected: document.querySelector('.mobile-bottom-tabs [aria-selected="true"]').id }))()`, (state) => state.selected === 'mobile-tab-input');
    assert.deepEqual(afterKey, { active: 'mobile-tab-input', selected: 'mobile-tab-input' });

    await clickTab('input');
    const finalLayout = await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, settled('pedals'));
    await clickTab('input');
    const target = await waitForLayout(app, MOBILE_LAYOUT_EXPRESSION, settled('input'));
    assert.equal(target.rootScrollWidth, target.rootClientWidth, `모바일 문서가 가로로 넘칩니다: ${target.rootScrollWidth}/${target.rootClientWidth}`);
    assert.deepEqual(target.visiblePanelIds, ['mobile-panel-input']);
    assert.equal(target.hiddenPanelRects.length, 2);
    for (const rect of target.hiddenPanelRects) assert.deepEqual(rect, { width: 0, height: 0 });
    assert.ok(target.boardScrollWidth > target.boardClientWidth, '페달보드 내부 가로 스크롤 영역이 유지되어야 합니다.');
    assert.ok(target.chainScrollWidth > target.chainClientWidth, '모바일 신호 체인이 읽을 수 있는 내부 가로 스크롤 영역을 유지해야 합니다.');
    assert.equal(target.chainOverlapCount, 0, '모바일 신호 체인 항목이 서로 겹칩니다.');
    assert.deepEqual(target.undersizedTargets, [], `44×44px 미만 모바일 타깃: ${JSON.stringify(target.undersizedTargets)}`);
    assert.equal(finalLayout.selectedTabId, 'pedals');

    return { checkedTargetCount: target.checkedTargetCount };
  } finally {
    await app.close();
  }
}

// ── 실제 Chrome 에서 확인: 휴대폰 도크·탭·스크롤 스냅·안전 영역, 데스크톱·태블릿 경계, 포커스·감소된 모션·색 ───────────────────────
const browserResult = await verifyLayoutInBrowser();
await verifyDesktopLayout();

console.log(
  `Responsive/a11y regression passed: mobile tabs, single panel instances, rendered a11y audit (${auditedRangeCount} ranges, ${auditedNamedCount} named elements), tuner/offline notices, listener cleanup${browserResult ? ` and ${browserResult.checkedTargetCount} mobile targets at 390px plus computed layout/style checks` : ''}`,
);

async function verifyDesktopLayout() {
  // 데스크톱 폭에서 연 뒤 좁혀 간다(사이드바는 열 때의 폭으로 열림 여부를 정한다).
  const app = await openApp({ purpose: 'Responsive desktop/tablet styles', viewport: { width: 1280, height: 900 }, waitFor: '.header-tools .connect-panel' });
  if (!app) return;
  try {
    const desktop = await app.evaluate(`(() => {
      ${COLOR_PROBE}
      const all = (selector) => [...document.querySelectorAll(selector)];
      const styleOf = (selector, property) => [...new Set(all(selector).map((element) => getComputedStyle(element)[property]))];
      const panel = document.querySelector('.header-tools .connect-panel');
      const upload = panel.querySelector('.audio-file-upload');
      const panelStyle = getComputedStyle(panel);
      const uploadStyle = getComputedStyle(upload);
      const status = document.createElement('span');
      status.className = 'effect-status state-closed';
      document.querySelector('.pedal-card').appendChild(status);
      const closedColor = getComputedStyle(status).color;
      status.remove();
      return {
        counts: Object.fromEntries(['.section-heading', '.signal-chain-hop', '.chain-effect-pill', '.preset-library-list > li', '.stomp-toggle-switch', '.compressor-brand-panel'].map((selector) => [selector, all(selector).length])),
        headingDirection: styleOf('.section-heading', 'flexDirection'),
        uploadColumn: [uploadStyle.gridColumnStart, uploadStyle.gridColumnEnd],
        uploadWidth: upload.getBoundingClientRect().width,
        panelContentWidth: panel.clientWidth - Number.parseFloat(panelStyle.paddingLeft) - Number.parseFloat(panelStyle.paddingRight),
        hopFlex: ['flexGrow', 'flexShrink', 'flexBasis'].map((property) => styleOf('.signal-chain-hop', property).join()),
        pillFlex: ['flexGrow', 'flexShrink', 'flexBasis'].map((property) => styleOf('.chain-effect-pill', property).join()),
        presetItemDisplay: styleOf('.preset-library-list > li', 'display'),
        stompMinHeight: styleOf('.stomp-toggle-switch', 'minHeight'),
        compressorBackground: styleOf('.compressor-brand-panel', 'backgroundColor'),
        primaryBackground: styleOf('.primary-button', 'backgroundColor'),
        closedColor,
        dangerColor: resolveColor('var(--danger)'),
      };
    })()`);
    assert.ok(Object.values(desktop.counts).every((count) => count > 0), `검사할 요소가 있어야 합니다: ${JSON.stringify(desktop.counts)}`);
    assert.deepEqual(desktop.headingDirection, ['column']);
    assert.deepEqual(desktop.uploadColumn, ['1', '-1'], '음원 파일 영역은 연결 패널의 전체 칸을 차지한다');
    approx(desktop.uploadWidth, desktop.panelContentWidth, '음원 파일 영역 너비 = 연결 패널 안쪽 너비', 1.5);
    assert.deepEqual(desktop.hopFlex, ['0', '0', 'auto'], '체인 화살표 묶음은 줄어들지 않는다(가로 스크롤)');
    assert.deepEqual(desktop.pillFlex, ['0', '0', 'auto'], '체인 이펙터 알약은 줄어들지 않는다');
    assert.deepEqual(desktop.presetItemDisplay, ['contents'], '프리셋 라이브러리 li 는 버튼 격자를 그대로 두는 contents');
    assert.deepEqual(desktop.stompMinHeight, ['44px'], '스톰프 스위치 터치 영역은 44px 아래로 줄지 않는다');
    assert.deepEqual(desktop.compressorBackground, ['rgb(8, 120, 191)']);
    assert.deepEqual(desktop.primaryBackground, ['rgb(47, 114, 203)']);
    assert.equal(desktop.closedColor, desktop.dangerColor, "닫힘 상태 글은 --danger 색이다");

    // 마우스를 올리면 주 버튼이 한 단계 어두워진다.
    const center = await app.evaluate(`(() => {
      const button = [...document.querySelectorAll('.primary-button')].find((element) => !element.disabled);
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect();
      return [rect.left + rect.width / 2, rect.top + rect.height / 2];
    })()`);
    await app.moveMouse(center[0], center[1]);
    await app.waitFor(`getComputedStyle([...document.querySelectorAll('.primary-button')].find((element) => !element.disabled)).backgroundColor === 'rgb(40, 105, 189)'`, { label: '주 버튼 호버 색' });
    await app.moveMouse(0, 0);

    // 키보드로 포커스하면 흰 3px 윤곽선이 보이고, 토글은 그 안쪽 트랙에 윤곽선이 생긴다. 포커스가 없으면 없다.
    await app.press('Tab', { code: 'Tab' });
    const focus = await app.evaluate(`(() => {
      const outline = (element) => { const style = getComputedStyle(element); return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.outlineOffset].join(' '); };
      const firstFocus = outline(document.activeElement);
      const toggle = document.querySelector('.toggle-switch');
      const track = toggle.querySelector('.switch-track');
      const before = outline(track);
      toggle.querySelector('input').focus();
      return { firstFocus, before, after: outline(track), within: toggle.matches(':focus-within') };
    })()`);
    assert.equal(focus.firstFocus, 'solid 3px rgb(255, 255, 255) 3px');
    assert.equal(focus.within, true);
    assert.equal(focus.after, 'solid 3px rgb(255, 255, 255) 3px');
    assert.notEqual(focus.before, focus.after, '포커스가 없을 때는 트랙에 윤곽선이 없다');

    // 감소된 모션: 켜면 전환·애니메이션이 모두 꺼지고, 끄면 전환이 있다(검사가 헛돌지 않게 짝으로 본다).
    const motionSelectors = ['.sortable-pedal', '.pedal-card', '.stomp-toggle-button', '.stomp-toggle-led', '.cent-strip', '.cent-strip span', '[class$="-led"]'];
    const readMotion = () => app.evaluate(`Object.fromEntries(${JSON.stringify(motionSelectors)}.map((selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, { transition: style.transitionDuration, animation: style.animationName, property: style.transitionProperty }];
    }))`);
    const normalMotion = await readMotion();
    await app.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const reducedMotion = await readMotion();
    await app.emulateMedia([]);
    for (const selector of motionSelectors) {
      assert.deepEqual([reducedMotion[selector].transition, reducedMotion[selector].animation], ['0s', 'none'], `감소된 모션: ${selector}`);
      if (selector !== '.sortable-pedal') assert.notEqual(normalMotion[selector].transition.split(', ')[0], '0s', `${selector}: 평소에는 전환이 있어야 이 검사가 의미 있다`);
    }

    // 데스크톱·태블릿 경계: 폭에 따라 하단 탭·연결 패널 칸 수·작업 영역 열이 바뀐다.
    const boundaries = {};
    for (const width of [1280, 1279, 1000, 768, 767]) {
      await app.setViewport({ width, height: 900 });
      await app.waitFor(`window.innerWidth === ${width}`, { label: `폭 ${width}` });
      await delay(300); // 미디어 쿼리 변화가 React 상태로 반영되어 다시 그려질 시간(곧바로 읽으면 이전 배치가 읽힌다)
      boundaries[width] = await waitForLayout(
        app,
        `(() => {
          const panel = document.querySelector('.header-tools .connect-panel');
          const board = document.querySelector('.pedal-board');
          if (!board) return null;
          const boardStyle = getComputedStyle(board);
          const inner = board.clientWidth - Number.parseFloat(boardStyle.paddingLeft) - Number.parseFloat(boardStyle.paddingRight);
          const gap = Number.parseFloat(boardStyle.columnGap);
          return {
            hasTabs: document.querySelector('.mobile-bottom-tabs') !== null,
            headerConnectPanel: panel !== null,
            panelColumns: panel ? getComputedStyle(panel).gridTemplateColumns.split(' ').length : 0,
            workspaceColumns: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ').length,
            boardTracks: boardStyle.gridTemplateColumns.split(' ').map(Number.parseFloat),
            expectedTracks: Math.max(1, Math.floor((inner + gap) / (300 + gap))),
          };
        })()`,
        (layout) => layout.hasTabs === (width <= 767),
      );
    }
    assert.deepEqual(boundaries[767].hasTabs, true, '767px 는 휴대폰 배치(하단 탭)');
    assert.equal(boundaries[767].headerConnectPanel, false, '휴대폰에서는 연결 패널이 머리말이 아니라 도크에 있다');
    for (const width of [768, 1000, 1279]) {
      assert.deepEqual([boundaries[width].hasTabs, boundaries[width].panelColumns, boundaries[width].workspaceColumns], [false, 2, 1], `${width}px 태블릿: 탭 없음, 연결 패널 2칸, 작업 영역 1열`);
    }
    assert.deepEqual([boundaries[1280].hasTabs, boundaries[1280].panelColumns, boundaries[1280].workspaceColumns], [false, 4, 2], '1280px 데스크톱: 연결 패널 4칸, 작업 영역 2열(사이드바)');
    // 데스크톱·태블릿 페달 격자: 칸 하나는 최소 300px(좁으면 100%), 채울 수 있는 만큼 칸을 만든다.
    for (const width of [768, 1000, 1279, 1280]) {
      const { boardTracks, expectedTracks } = boundaries[width];
      assert.equal(boardTracks.length, expectedTracks, `${width}px: 페달 격자 칸 수`);
      assert.ok(boardTracks.every((track) => track >= 300 - 0.5), `${width}px: 칸 너비는 300px 이상 ${boardTracks}`);
    }
    assert.ok(boundaries[767].boardTracks.length === 15, '휴대폰은 페달을 한 줄(15칸)로 늘어놓고 가로로 넘긴다');
  } finally {
    await app.close();
  }
}
