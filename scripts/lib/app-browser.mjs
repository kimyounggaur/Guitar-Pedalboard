// 앱을 실제 Chrome 에서 열고 DOM·계산된 스타일·키 입력을 확인하는 도구(S4.7).
// CSS 나 포커스 이동처럼 Node 에서 흉내 낼 수 없는 것을 소스 글자(정규식)로 검사하는 대신 브라우저가 계산한 값으로 묻는다.
//
//   const app = await openApp({ purpose: '도움말 대화상자', viewport: { width: 1280, height: 800 } });
//   if (!app) return;              // 이 컴퓨터에는 Chrome 이 없다(CI 에서는 requireChrome 이 오류를 던진다)
//   try {
//     await app.press('?', { code: 'Slash', shift: true });
//     const open = await app.evaluate(`document.querySelector('[role="dialog"]') !== null`);
//   } finally { await app.close(); }
import { spawn } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { delay, getOpenPort, requireChrome, startChrome, stopChild, waitForHttp } from './chrome.mjs';

const KEY_CODES = {
  Tab: 9,
  Enter: 13,
  Escape: 27,
  ' ': 32,
};

/**
 * Vite 개발 서버와 헤드리스 Chrome 을 띄워 앱을 연다. Chrome 이 없으면 null(CI 에서는 오류).
 * @param {{ purpose: string, viewport?: { width: number, height: number, mobile?: boolean }, path?: string, waitFor?: string }} options
 *   waitFor: 앱이 떴다고 볼 CSS 선택자(기본 `.pedal-board`).
 */
export async function openApp({ purpose, viewport = { width: 1280, height: 800 }, path = '/', waitFor = '.pedal-board' }) {
  const chromePath = await requireChrome(purpose);
  if (!chromePath) {
    console.warn(`${purpose} skipped: Chrome or WebSocket is unavailable.`);
    return null;
  }

  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  const vitePath = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
  const appPort = await getOpenPort();
  const appUrl = `http://127.0.0.1:${appPort}${path}`;
  let viteProcess;
  let browser;
  const close = async () => {
    await browser?.close();
    await stopChild(viteProcess);
  };

  try {
    viteProcess = spawn(
      process.execPath,
      [vitePath, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'],
      { cwd: projectRoot, stdio: 'ignore', windowsHide: true },
    );
    await waitForHttp(`http://127.0.0.1:${appPort}/`, viteProcess);
    browser = await startChrome({ chromePath, profilePrefix: 'guitar-pedalboard-app-', quiet: true });
    const { cdp } = browser;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const app = {
      cdp,
      url: appUrl,
      close,
      async setViewport({ width, height, mobile = false }) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      },
      /** 표현식을 페이지에서 평가해 값을 돌려준다(JSON 으로 옮길 수 있는 값). 예외는 오류로 던진다. */
      async evaluate(expression) {
        const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) {
          throw new Error(`페이지 평가 오류: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\n${expression.slice(0, 200)}`);
        }
        return result.result?.value;
      },
      /** 표현식이 참 같은 값이 될 때까지 기다린다. */
      async waitFor(expression, { timeoutMs = 5_000, label = expression.slice(0, 80) } = {}) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await app.evaluate(expression);
          if (value) return value;
          await delay(40);
        }
        throw new Error(`시간 안에 조건이 되지 않았습니다: ${label}`);
      },
      /** 실제 키 입력(keyDown → keyUp). `key` 는 KeyboardEvent.key, `code` 는 물리 키. */
      async press(key, { code = '', shift = false, ctrl = false, alt = false, meta = false } = {}) {
        const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
        const printable = key.length === 1 && !ctrl && !alt && !meta;
        const base = { key, code, modifiers, windowsVirtualKeyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0) };
        await cdp.send('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', ...base, ...(printable ? { text: key } : {}) });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      },
      /** 화면 좌표로 마우스를 옮긴다(:hover 확인용). */
      async moveMouse(x, y) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      },
      /** CSS 미디어 기능(예: prefers-reduced-motion)을 흉내 낸다. */
      async emulateMedia(features) {
        await cdp.send('Emulation.setEmulatedMedia', { features });
      },
      /** 계산된 스타일 값들을 한꺼번에 읽는다: `await app.style('.dock', ['position', 'maxHeight'])` */
      async style(selector, properties) {
        return app.evaluate(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) return null;
          const style = getComputedStyle(element);
          return Object.fromEntries(${JSON.stringify(properties)}.map((name) => [name, style[name] || style.getPropertyValue(name)]));
        })()`);
      },
    };

    await app.setViewport(viewport);
    await cdp.send('Page.navigate', { url: appUrl });
    await app.waitFor(`document.querySelector(${JSON.stringify(waitFor)}) !== null`, { timeoutMs: 20_000, label: `앱 화면(${waitFor})` });
    return app;
  } catch (error) {
    await close();
    throw error;
  }
}
