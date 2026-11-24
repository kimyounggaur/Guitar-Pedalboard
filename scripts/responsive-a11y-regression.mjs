import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { delay, getOpenPort, requireChrome, startChrome, stopChild, waitForHttp } from './lib/chrome.mjs';

const [
  appShellSource,
  pedalBoardSource,
  pedalCardSource,
  meterSource,
  connectSource,
  mediaQuerySource,
  delaySource,
  noiseGateSource,
  fuzzSource,
  presetSource,
  controlsCss,
  layoutCss,
  panelsCss,
  pedalsCss,
  responsiveCss,
  indexSource,
  shortcutsSource,
  dockHeightSource,
  keysSource,
] = await Promise.all([
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PedalBoard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PedalCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/Meter.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ConnectGuitarPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/hooks/useMediaQuery.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/effects/DelayPedal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/effects/NoiseGatePedal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/effects/FuzzPedal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PresetPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/controls.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/layout.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/panels.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/pedals.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/responsive.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GlobalKeyboardShortcuts.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/hooks/useDockHeight.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/persistence/keys.ts', import.meta.url), 'utf8'),
]);

assert.match(appShellSource, /MOBILE_LAYOUT_QUERY = '\(max-width: 767px\)'/);
assert.match(appShellSource, /role="tablist"/);
assert.match(appShellSource, /role="tab"/);
// S1.6: 탭 맨 앞에 '페달'(기본 선택)이 있고, 나머지 셋은 각자 패널을 가진다.
const mobileTabOrder = [
  ['pedals', '페달'],
  ['input', '입력'],
  ['meter', '미터'],
  ['preset', '프리셋'],
];
for (const [id, label] of mobileTabOrder) {
  assert.match(appShellSource, new RegExp(`\\{ id: '${id}', label: '${label}' \\}`));
}
assert.ok(
  appShellSource.indexOf("{ id: 'pedals'") < appShellSource.indexOf("{ id: 'input'") &&
    appShellSource.indexOf("{ id: 'input'") < appShellSource.indexOf("{ id: 'meter'") &&
    appShellSource.indexOf("{ id: 'meter'") < appShellSource.indexOf("{ id: 'preset'"),
  '탭 순서는 페달 → 입력 → 미터 → 프리셋 이어야 합니다.',
);
assert.match(appShellSource, /useState<MobileTabId>\('pedals'\)/, "기본 선택 탭은 '페달' 이어야 합니다.");
assert.ok(
  appShellSource.includes("aria-controls={tab.id === 'pedals' ? PEDAL_BOARD_SECTION_ID : `mobile-panel-${tab.id}`}"),
  "'페달' 탭은 페달보드 영역을, 나머지는 자기 패널을 가리켜야 합니다.",
);
assert.match(appShellSource, /PEDAL_BOARD_SECTION_ID = 'pedal-board-section'/);
assert.match(pedalBoardSource, /<section id="pedal-board-section" className="board-section"/);
for (const id of ['input', 'meter', 'preset']) {
  assert.ok(appShellSource.includes(`id="mobile-panel-${id}"`));
  assert.ok(appShellSource.includes(`aria-labelledby="mobile-tab-${id}"`));
}
// 도크가 열렸는지는 따로 저장하지 않고 선택된 탭에서 정한다. 같은 탭을 다시 누르면 '페달' 로 돌아가 접힌다. 토글 버튼은 없다.
assert.match(appShellSource, /const mobileDockOpen = isMobileLayout && activeMobileTab !== 'pedals'/);
assert.match(appShellSource, /setActiveMobileTab\(\(current\) => \(current === tabId \? 'pedals' : tabId\)\)/);
assert.doesNotMatch(appShellSource, /setMobileDockOpen|mobile-dock-toggle/, '도크 토글/별도 열림 상태가 되살아났습니다.');
assert.match(appShellSource, /useDockHeight\(dockElement\)/);
assert.match(appShellSource, /<section ref=\{setDockElement\} className="mobile-control-dock"/);
assert.match(dockHeightSource, /DOCK_HEIGHT_VAR = '--dock-h'/);
assert.match(dockHeightSource, /new ResizeObserver\(publish\)/);
assert.match(dockHeightSource, /observer\.disconnect\(\)/);
assert.match(dockHeightSource, /removeProperty\(DOCK_HEIGHT_VAR\)/);
assert.match(appShellSource, /aria-selected=\{isActive\}/);
assert.match(appShellSource, /tabIndex=\{isActive \? 0 : -1\}/);
assert.equal([...appShellSource.matchAll(/tabIndex=\{0\}/g)].length, 3);
assert.equal([...appShellSource.matchAll(/<ConnectGuitarPanel\b/g)].length, 1);
assert.equal([...appShellSource.matchAll(/<Meter\b/g)].length, 1);
assert.equal([...appShellSource.matchAll(/<PresetPanel\b/g)].length, 1);
assert.match(appShellSource, /const inputPanel = <ConnectGuitarPanel isMobile=\{isMobileLayout\} \/>/);
assert.match(appShellSource, /const meterPanel = <Meter active=\{!isMobileLayout \|\| activeMobileTab === 'meter'\} \/>/);
assert.match(appShellSource, /inputPanel=\{isMobileLayout \? undefined : inputPanel\}/);
assert.match(appShellSource, /window\.addEventListener\('online', updateOnlineStatus\)/);
assert.match(appShellSource, /window\.addEventListener\('offline', updateOnlineStatus\)/);
assert.match(appShellSource, /window\.removeEventListener\('online', updateOnlineStatus\)/);
assert.match(appShellSource, /window\.removeEventListener\('offline', updateOnlineStatus\)/);
assert.match(appShellSource, /오프라인 상태입니다\./);
assert.match(appShellSource, /기타 실시간 입력은 사용할 수 없습니다\. 음원 파일 재생 모드로 톤을 확인해 주세요\./);
assert.doesNotMatch(appShellSource, /addEventListener\('keydown'/);

assert.match(pedalBoardSource, /interface PedalBoardProps[\s\S]*inputPanel\?: ReactNode/);
assert.match(pedalBoardSource, /export function PedalBoard\(\{ inputPanel \}: PedalBoardProps\)/);
assert.match(pedalBoardSource, /\{inputPanel\}/);
assert.match(pedalBoardSource, /className="signal-chain-text"[\s\S]{0,100}role="region"/);
assert.match(pedalBoardSource, /aria-label="현재 신호 체인"/);
assert.match(pedalBoardSource, /aria-atomic="true"/);
assert.match(pedalBoardSource, /tabIndex=\{0\}/);

assert.match(mediaQuerySource, /window\.matchMedia\(query\)/);
assert.match(mediaQuerySource, /mediaQuery\.addEventListener\('change', updateMatch\)/);
assert.match(mediaQuerySource, /mediaQuery\.removeEventListener\('change', updateMatch\)/);

assert.match(meterSource, /interface MeterProps[\s\S]*active\?: boolean/);
assert.match(meterSource, /export function Meter\(\{ active = true \}: MeterProps\)/);
assert.equal(
  [...meterSource.matchAll(/!active \|\| !isRunning \|\| document\.visibilityState !== 'visible'/g)].length,
  2,
  '비활성 모바일 미터가 render/sync 양쪽에서 rAF를 중지해야 합니다.',
);
assert.match(meterSource, /\}, \[active, isRunning\]\);/);
assert.match(meterSource, /window\.setInterval\(update, STORE_REFRESH_INTERVAL_MS\)/);
assert.match(meterSource, /\}, \[isRunning, refreshMeters\]\);/);
assert.match(meterSource, /tunerStatus === 'in-tune'[\s\S]*'정확함'/);
assert.match(meterSource, /roundedCents > 0 \? '높음' : '낮음'/);
assert.match(meterSource, /const boundedCents = Math\.round\(Math\.min\(50, Math\.max\(-50, hasPitch \? pitch\.cents : 0\)\)\);/);
assert.match(meterSource, /aria-valuenow=\{boundedCents\}/);
assert.match(meterSource, /aria-valuetext=\{tuningStatusLabel\}[\s\S]{0,120}role="meter"/);

assert.match(connectSource, /STORAGE_KEYS\.mobileAudioNotice/);
assert.match(keysSource, /mobileAudioNotice: 'guitar-pedalboard:mobile-audio-notice-dismissed'/);
assert.match(connectSource, /모바일은 입력 지연이 커서 실시간 연주에 적합하지 않습니다\./);
assert.match(connectSource, /음원 파일 재생 모드로 톤을 확인하거나, PC \+ 오디오 인터페이스 사용을 권장합니다\./);
// 저장소 접근의 try/catch 는 SafeStorage 한 곳에 있다(S1.7). 이 컴포넌트는 직접 localStorage 를 만지지 않고 SafeStorage 로 읽고 쓴다.
assert.doesNotMatch(connectSource, /localStorage/);
assert.match(connectSource, /safeStorage\.getRaw\(STORAGE_KEYS\.mobileAudioNotice\)/);
assert.match(connectSource, /safeStorage\.setRaw\(STORAGE_KEYS\.mobileAudioNotice, 'true'\)/);
assert.match(connectSource, /aria-label="모바일 오디오 안내 닫기"/);

assert.match(pedalCardSource, /<article[\s\S]*role="group"[\s\S]*aria-label=\{`\$\{pedal\.name\} 이펙터`\}/);
assert.match(delaySource, /ariaValueText=\{delayModeLabels\[params\.mode\]\}/);
assert.match(delaySource, /<div className="delay-led" aria-hidden="true" \/>/);
assert.doesNotMatch(delaySource, /delay-led[^>]*aria-label/);
assert.match(noiseGateSource, /noise-gate-led[^>]*aria-hidden="true"/);
assert.doesNotMatch(noiseGateSource, /noise-gate-led[^>]*aria-label/);
assert.match(fuzzSource, /ariaValueText=\{fuzzModeLabels\[params\.mode\]\}/);
assert.match(presetSource, /<ul className="preset-library-list" aria-label="프리셋 라이브러리">/);
assert.match(presetSource, /<li key=\{library\.id\}>/);
assert.match(presetSource, /<ul className="preset-list" aria-label="프리셋 목록">/);
assert.match(presetSource, /<li className=\{`preset-item/);
assert.doesNotMatch(presetSource, /role="list"/);

const componentsRoot = fileURLToPath(new URL('../src/components', import.meta.url));
const componentFiles = await collectFiles(componentsRoot);
let rangeCount = 0;
let namedGenericCount = 0;
for (const componentFile of componentFiles.filter((file) => file.endsWith('.tsx'))) {
  const source = await readFile(componentFile, 'utf8');
  for (const [namedGenericTag] of source.matchAll(/<(?:div|span)\b[^>]*\baria-label=[^>]*>/g)) {
    assert.match(namedGenericTag, /\brole=/, `${componentFile}: 이름 있는 generic 요소에 유효한 role이 필요합니다.`);
    namedGenericCount += 1;
  }
  let cursor = 0;
  while (true) {
    const typeIndex = source.indexOf('type="range"', cursor);
    if (typeIndex < 0) break;
    const inputStart = source.lastIndexOf('<input', typeIndex);
    const inputEnd = source.indexOf('/>', typeIndex);
    assert.ok(inputStart >= 0 && inputEnd > typeIndex, `${componentFile}: range input 태그 파싱 실패`);
    const inputTag = source.slice(inputStart, inputEnd + 2);
    assert.match(inputTag, /aria-label=/, `${componentFile}: range aria-label 누락`);
    assert.match(inputTag, /aria-valuetext=/, `${componentFile}: range aria-valuetext 누락`);
    rangeCount += 1;
    cursor = inputEnd + 2;
  }
}
assert.ok(rangeCount >= 13, `예상보다 적은 range를 검사했습니다: ${rangeCount}`);
assert.ok(namedGenericCount >= 20, `예상보다 적은 named generic 요소를 검사했습니다: ${namedGenericCount}`);

assert.match(indexSource, /viewport-fit=cover/);
assert.match(responsiveCss, /@media \(min-width: 768px\) and \(max-width: 1279px\)/);
assert.match(pedalsCss, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 300px\), 1fr\)\)/);
assert.match(responsiveCss, /\.mobile-control-panels\[hidden\]/);
// S1.6: 도크는 최대 50dvh, 본문 아래 여백은 --dock-h 를 따른다(66dvh·고정 140px 여백은 없다).
assert.match(responsiveCss, /\.mobile-control-dock \{[^}]*max-height: 50dvh;/);
assert.match(responsiveCss, /\.mobile-control-panel \{[^}]*max-height: calc\(50dvh - var\(--dock-tabs-h\)\);/);
assert.match(responsiveCss, /padding: 12px [^;]*calc\(var\(--dock-h, 0px\) \+ env\(safe-area-inset-bottom\) \+ 16px\)/);
assert.match(responsiveCss, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.doesNotMatch(responsiveCss, /66dvh|min\(66dvh|mobile-dock-toggle/);
assert.match(pedalsCss, /\.stomp-toggle-switch \{[^}]*min-height: 44px;/, '스톰프 스위치 터치 영역은 44×44 px 아래로 줄지 않아야 합니다.');
assert.match(responsiveCss, /@media \(max-width: 767px\)/);
assert.match(responsiveCss, /grid-auto-flow: column/);
assert.match(responsiveCss, /scroll-snap-type: x mandatory/);
assert.match(responsiveCss, /scroll-snap-align: start/);
assert.match(responsiveCss, /position: fixed[\s\S]*bottom: 0[\s\S]*\.mobile-bottom-tabs/);
assert.match(responsiveCss, /env\(safe-area-inset-bottom\)/);
assert.match(responsiveCss, /min-height: 44px/);
// S1.7(L-54): 순서 변경 알림은 도크 높이를 따라 도크 위에 놓인다(펼친 도크와 겹치던 고정 82 px 를 대신한다).
assert.match(responsiveCss, /\.chain-toast \{[^}]*bottom: calc\(var\(--dock-h, 58px\) \+ 12px\);/);
assert.doesNotMatch(responsiveCss, /bottom: calc\(82px/);
assert.match(responsiveCss, /\.app-shell[\s\S]*overflow-x: clip/);
assert.match(responsiveCss, /\.workspace[\s\S]*overflow-x: clip/);
assert.match(responsiveCss, /\.board-section[\s\S]*overflow-x: clip/);
const mobilePresetDisplayIndex = responsiveCss.indexOf('.mobile-preset-panel.sidebar');
const hiddenPanelRuleIndex = responsiveCss.indexOf('.mobile-control-panel[hidden]');
assert.ok(
  mobilePresetDisplayIndex >= 0 && hiddenPanelRuleIndex > mobilePresetDisplayIndex,
  'hidden panel display 규칙은 sidebar display override 뒤에 있어야 합니다.',
);
assert.match(
  responsiveCss.slice(hiddenPanelRuleIndex, hiddenPanelRuleIndex + 100),
  /display: none !important/,
);
assert.match(responsiveCss, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(responsiveCss, /\.sortable-pedal[\s\S]*\.stomp-toggle-led[\s\S]*\[class\$="-led"\]/);
assert.match(responsiveCss, /animation: none !important/);
assert.match(responsiveCss, /transition: none !important/);
assert.match(controlsCss, /:where\(button, a\[href\], input, select, textarea, \[tabindex\]\):focus-visible/);
assert.match(controlsCss, /\.toggle-switch:focus-within \.switch-track/);
assert.match(controlsCss, /\.effect-status\.state-closed\s*\{\s*color: var\(--danger\);/);
assert.match(layoutCss, /\.preset-library-list > li\s*\{\s*display: contents;/);
assert.match(layoutCss, /\.section-heading\s*\{[\s\S]{0,140}flex-direction: column;/);
assert.match(layoutCss, /\.header-tools\s*\{[\s\S]{0,180}width: 100%;/);
assert.match(
  layoutCss,
  /\.header-tools \.connect-panel \.audio-file-upload\s*\{[\s\S]{0,180}grid-column: 1 \/ -1;/,
);
assert.match(layoutCss, /\.signal-chain-hop\s*\{\s*flex: 0 0 auto;/);
assert.match(layoutCss, /\.chain-effect-pill\s*\{\s*flex: 0 0 auto;/);
assert.match(panelsCss, /\.mobile-audio-notice/);
assert.match(panelsCss, /\.tuner-status-text/);
assert.match(panelsCss, /\.primary-button\s*\{\s*background: #2f72cb;/);
assert.match(panelsCss, /\.primary-button:hover:not\(:disabled\)\s*\{\s*background: #2869bd;/);
assert.match(pedalsCss, /\.compressor-brand-panel\s*\{[\s\S]{0,180}background: #0878bf;/);

assert.equal(
  [...shortcutsSource.matchAll(/window\.addEventListener\('keydown'/g)].length,
  1,
  '단축키 전역 keydown listener 계약이 변경되었습니다.',
);

const browserLayout = await verifyMobileBrowserLayout();
if (browserLayout) {
  assert.equal(
    browserLayout.rootScrollWidth,
    browserLayout.rootClientWidth,
    `모바일 문서가 가로로 넘칩니다: ${browserLayout.rootScrollWidth}/${browserLayout.rootClientWidth}`,
  );
  assert.deepEqual(browserLayout.visiblePanelIds, ['mobile-panel-input']);
  assert.equal(browserLayout.hiddenPanelRects.length, 2);
  for (const rect of browserLayout.hiddenPanelRects) {
    assert.deepEqual(rect, { width: 0, height: 0 });
  }
  assert.ok(
    browserLayout.boardScrollWidth > browserLayout.boardClientWidth,
    '페달보드 내부 가로 스크롤 영역이 유지되어야 합니다.',
  );
  assert.ok(
    browserLayout.chainScrollWidth > browserLayout.chainClientWidth,
    '모바일 신호 체인이 읽을 수 있는 내부 가로 스크롤 영역을 유지해야 합니다.',
  );
  assert.equal(browserLayout.chainOverlapCount, 0, '모바일 신호 체인 항목이 서로 겹칩니다.');
  assert.deepEqual(
    browserLayout.undersizedTargets,
    [],
    `44×44px 미만 모바일 타깃: ${JSON.stringify(browserLayout.undersizedTargets)}`,
  );
}

console.log(
  `Responsive/a11y regression passed: mobile tabs, single panel instances, responsive CSS, ${rangeCount} ranges, tuner/offline notices, listener cleanup${browserLayout ? ` and ${browserLayout.checkedTargetCount} mobile targets at 390px` : ''}.`,
);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(directory, entry.name);
      return entry.isDirectory()
        ? collectFiles(entryPath)
        : [entryPath];
    }),
  );
  return files.flat();
}

async function verifyMobileBrowserLayout() {
  const chromePath = await requireChrome('Responsive browser geometry');
  if (!chromePath) {
    console.warn('Responsive browser geometry skipped: Chrome or WebSocket is unavailable.');
    return null;
  }

  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const vitePath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const appPort = await getOpenPort();
  const appUrl = `http://127.0.0.1:${appPort}/`;
  let viteProcess;
  let browser;

  try {
    viteProcess = spawn(
      process.execPath,
      [vitePath, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'],
      { cwd: projectRoot, stdio: 'ignore', windowsHide: true },
    );
    await waitForHttp(appUrl, viteProcess);

    browser = await startChrome({ chromePath, profilePrefix: 'guitar-pedalboard-responsive-' });
    const { cdp } = browser;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.send('Page.navigate', { url: appUrl });

    const clickTab = (id) =>
      cdp.send('Runtime.evaluate', { expression: `document.getElementById('mobile-tab-${id}').click()`, returnByValue: true });
    // --dock-h 는 ResizeObserver 가 비동기로 갱신하므로 도크의 실제 높이와 같아질 때까지 기다린다.
    const dockVarMatches = (layout) => layout.dockVar === `${Math.ceil(layout.dockHeight)}px`;

    const collapsed = await waitForBrowserLayout(cdp, dockVarMatches);
    assert.deepEqual(collapsed.visiblePanelIds, [], '모바일 패널은 기본 접힘 상태여야 합니다.');
    assert.deepEqual(collapsed.tabIds, ['pedals', 'input', 'meter', 'preset']);
    assert.equal(collapsed.selectedTabId, 'pedals', "기본 선택 탭은 '페달' 이어야 합니다.");
    assert.ok(collapsed.dockHeight >= 50 && collapsed.dockHeight <= 64, `접힌 도크는 탭 줄(약 56px)만 남아야 합니다: ${collapsed.dockHeight}px`);

    await clickTab('input');
    const expanded = await waitForBrowserLayout(cdp, (layout) => layout.selectedTabId === 'input' && dockVarMatches(layout));
    assert.deepEqual(expanded.visiblePanelIds, ['mobile-panel-input']);
    assert.ok(expanded.dockHeight > collapsed.dockHeight, '탭을 누르면 도크가 펼쳐져야 합니다.');
    assert.ok(expanded.dockHeight <= expanded.viewportHeight * 0.5 + 1, `펼친 도크는 화면 높이의 50% 이하여야 합니다: ${expanded.dockHeight}/${expanded.viewportHeight}`);

    await clickTab('input');
    const retapped = await waitForBrowserLayout(cdp, (layout) => layout.selectedTabId === 'pedals' && dockVarMatches(layout));
    assert.deepEqual(retapped.visiblePanelIds, [], '펼쳐진 탭을 다시 누르면 접혀야 합니다.');
    assert.equal(retapped.dockHeight, collapsed.dockHeight, '다시 접으면 처음 높이로 돌아와야 합니다.');

    await clickTab('input');
    return await waitForBrowserLayout(cdp, (layout) => layout.selectedTabId === 'input' && dockVarMatches(layout));
  } finally {
    await browser?.close();
    await stopChild(viteProcess);
  }
}

async function waitForBrowserLayout(cdp, ready = () => true) {
  const expression = `(() => {
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
    return {
      tabIds: tabs.map((tab) => tab.id.replace('mobile-tab-', '')),
      selectedTabId: (tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.id ?? '').replace('mobile-tab-', ''),
      dockHeight: dock ? dock.getBoundingClientRect().height : 0,
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
    };
  })()`;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    const layout = result.result?.value;
    if (layout && ready(layout)) return layout;
    await delay(50);
  }
  throw new Error('Timed out waiting for the responsive app layout.');
}
