import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

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
]);

assert.match(appShellSource, /MOBILE_LAYOUT_QUERY = '\(max-width: 767px\)'/);
assert.match(appShellSource, /role="tablist"/);
assert.match(appShellSource, /role="tab"/);
for (const [id, label] of [
  ['input', '입력'],
  ['meter', '미터'],
  ['preset', '프리셋'],
]) {
  assert.match(appShellSource, new RegExp(`\\{ id: '${id}', label: '${label}' \\}`));
  assert.ok(appShellSource.includes(`aria-controls={\`mobile-panel-\${tab.id}\`}`));
  assert.ok(appShellSource.includes(`id="mobile-panel-${id}"`));
  assert.ok(appShellSource.includes(`aria-labelledby="mobile-tab-${id}"`));
}
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
assert.match(meterSource, /\}, \[active, isRunning, refreshMeters\]\);/);
assert.match(meterSource, /tunerStatus === 'in-tune'[\s\S]*'정확함'/);
assert.match(meterSource, /roundedCents > 0 \? '높음' : '낮음'/);
assert.match(meterSource, /const boundedCents = Math\.round\(Math\.min\(50, Math\.max\(-50, hasPitch \? pitch\.cents : 0\)\)\);/);
assert.match(meterSource, /aria-valuenow=\{boundedCents\}/);
assert.match(meterSource, /aria-valuetext=\{tuningStatusLabel\}[\s\S]{0,120}role="meter"/);

assert.match(connectSource, /guitar-pedalboard:mobile-audio-notice-dismissed/);
assert.match(connectSource, /모바일은 입력 지연이 커서 실시간 연주에 적합하지 않습니다\./);
assert.match(connectSource, /음원 파일 재생 모드로 톤을 확인하거나, PC \+ 오디오 인터페이스 사용을 권장합니다\./);
assert.ok([...connectSource.matchAll(/try \{/g)].length >= 2, 'localStorage 읽기/쓰기에 try/catch가 필요합니다.');
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
assert.match(responsiveCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(responsiveCss, /@media \(max-width: 767px\)/);
assert.match(responsiveCss, /grid-auto-flow: column/);
assert.match(responsiveCss, /scroll-snap-type: x mandatory/);
assert.match(responsiveCss, /scroll-snap-align: start/);
assert.match(responsiveCss, /position: fixed[\s\S]*bottom: 0[\s\S]*\.mobile-bottom-tabs/);
assert.match(responsiveCss, /env\(safe-area-inset-bottom\)/);
assert.match(responsiveCss, /min-height: 44px/);
assert.match(responsiveCss, /\.chain-toast[\s\S]*bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\)/);
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
  const chromePath = await findChromePath();
  if (!chromePath || typeof globalThis.WebSocket === 'undefined') {
    console.warn('Responsive browser geometry skipped: Chrome or WebSocket is unavailable.');
    return null;
  }

  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const vitePath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const appPort = await getOpenPort();
  const debuggingPort = await getOpenPort();
  const profileDirectory = await mkdtemp(join(tmpdir(), 'guitar-pedalboard-responsive-'));
  const appUrl = `http://127.0.0.1:${appPort}/`;
  let viteProcess;
  let chromeProcess;
  let cdp;

  try {
    viteProcess = spawn(
      process.execPath,
      [vitePath, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'],
      { cwd: projectRoot, stdio: 'ignore', windowsHide: true },
    );
    await waitForHttp(appUrl, viteProcess);

    chromeProcess = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-gpu',
        '--no-first-run',
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${profileDirectory}`,
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true },
    );

    const target = await waitForChromeTarget(debuggingPort, chromeProcess);
    cdp = await createCdpClient(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.send('Page.navigate', { url: appUrl });

    return await waitForBrowserLayout(cdp);
  } finally {
    if (cdp) {
      try {
        await cdp.send('Browser.close');
      } catch {
        cdp.close();
      }
    }
    await stopChild(chromeProcess);
    await stopChild(viteProcess);
    const tempRoot = tmpdir().toLowerCase();
    assert.ok(
      profileDirectory.toLowerCase().startsWith(tempRoot),
      'Chrome 임시 프로필이 시스템 temp 밖에 있습니다.',
    );
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

async function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported browser location.
    }
  }
  return null;
}

async function getOpenPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function waitForHttp(url, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited with ${child.exitCode}`);
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForChromeTarget(port, child) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${child.exitCode}`);
    try {
      const targets = await (await globalThis.fetch(endpoint)).json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // DevTools is still starting.
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for Chrome DevTools.');
}

async function createCdpClient(webSocketUrl) {
  const socket = new globalThis.WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function waitForBrowserLayout(cdp) {
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
    return {
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
    if (result.result?.value) return result.result.value;
    await delay(50);
  }
  throw new Error('Timed out waiting for the responsive app layout.');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(2_000)]);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
