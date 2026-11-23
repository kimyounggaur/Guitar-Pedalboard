// 시험 스크립트가 함께 쓰는 Chrome 실행·DevTools(CDP) 도우미. 새 의존성 없이 Node 내장 기능만 쓴다.
// responsive-a11y-regression.mjs 에 있던 코드를 옮겼고(동작은 같다), 오디오 렌더 프로브도 이것을 쓴다.
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

/** GitHub Actions 등 CI 는 CI=true 를 넣는다. 'false'·'0' 은 CI 가 아닌 것으로 본다. */
export const runsInCi = Boolean(process.env.CI) && !['false', '0'].includes(process.env.CI);

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 설치된 Chrome/Chromium 실행 파일 경로. 없으면 null. */
export async function findChromePath() {
  const explicitPath = process.env.CHROME_PATH;
  const fallbackPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  // CI 에서 CHROME_PATH 를 정했는데 그 파일이 없으면 다른 Chrome 으로 넘어가지 않는다(설정 오류로 실패시킨다).
  const candidates = runsInCi && explicitPath
    ? [explicitPath]
    : [explicitPath, ...fallbackPaths].filter(Boolean);

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

/**
 * 브라우저 시험이 필요한 스크립트가 맨 앞에서 부른다.
 * Chrome 과 WebSocket 이 있으면 경로를 돌려주고, 없으면 CI 에서는 오류를 던지고 로컬에서는 null 을 돌려준다.
 */
export async function requireChrome(purpose) {
  const chromePath = await findChromePath();
  if (chromePath && typeof globalThis.WebSocket !== 'undefined') return chromePath;
  if (runsInCi) {
    // CI 에서 브라우저 검사를 말없이 건너뛰면 '통과'로 보이는 검사 공백이 생긴다.
    throw new Error(
      `${purpose} cannot be skipped in CI: Chrome or WebSocket is unavailable. `
        + 'Set CHROME_PATH to an installed Chrome/Chromium executable.',
    );
  }
  return null;
}

export async function getOpenPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('빈 포트를 찾지 못했습니다.');
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

export async function waitForHttp(url, child, label = 'Vite') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
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

export async function waitForChromeTarget(port, child) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chrome exited with code ${child.exitCode} and signal ${child.signalCode}`);
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

/**
 * DevTools 프로토콜 클라이언트. send(method, params) 는 결과를 돌려주고,
 * on(method, handler) 는 이벤트(Runtime.consoleAPICalled 등)를 받는다.
 */
export async function createCdpClient(webSocketUrl) {
  const socket = new globalThis.WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  let closedReason = null;
  const pending = new Map();
  const handlers = new Map();
  // 연결이 끊기면 답을 기다리던 요청은 영영 풀리지 않는다. 특히 Browser.close 는 Chrome 이 답하기 전에 종료하면서
  // 소켓을 닫는 일이 있어(간헐적으로 시험이 180초 동안 멈췄다), 끊기는 순간 대기 요청을 모두 거부하고 이후 send 도 바로 거부한다.
  socket.addEventListener('close', () => {
    closedReason = 'CDP 연결이 닫혔습니다.';
    for (const { reject } of pending.values()) reject(new Error(closedReason));
    pending.clear();
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method && handlers.has(message.method)) {
      for (const handler of handlers.get(message.method)) handler(message.params ?? {});
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  return {
    send(method, params = {}) {
      if (closedReason) return Promise.reject(new Error(closedReason));
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, handler) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(handler);
    },
    close() {
      socket.close();
    },
  };
}

export async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(2_000)]);
}

/**
 * 헤드리스 Chrome 을 임시 프로필로 띄우고 첫 페이지에 CDP 로 연결한다.
 * 돌려주는 close() 가 Chrome 종료와 임시 프로필 삭제를 맡는다(항상 finally 에서 부른다).
 *
 * @param {{ chromePath: string, extraArgs?: string[], profilePrefix?: string, quiet?: boolean }} options  quiet: Chrome 이 stderr 로 내는 로그(컨테이너에서는 dbus 오류가 많다)를 버린다
 */
export async function startChrome({ chromePath, extraArgs = [], profilePrefix = 'guitar-pedalboard-chrome-', quiet = false }) {
  const debuggingPort = await getOpenPort();
  const profileDirectory = await mkdtemp(join(tmpdir(), profilePrefix));
  let chromeProcess;
  let cdp;

  const close = async () => {
    if (cdp) {
      // Browser.close 가 답 없이 소켓만 닫히면 거부(→ 정상 종료로 본다), 소켓도 안 닫히고 답도 없으면 3초 뒤 강제로 넘어간다.
      let giveUp;
      const gaveUp = new Promise((resolve) => {
        giveUp = setTimeout(resolve, 3_000);
      });
      try {
        await Promise.race([cdp.send('Browser.close'), gaveUp]);
      } catch {
        cdp.close();
      } finally {
        clearTimeout(giveUp);
      }
    }
    await stopChild(chromeProcess);
    const tempRoot = tmpdir().toLowerCase();
    if (!profileDirectory.toLowerCase().startsWith(tempRoot)) {
      throw new Error('Chrome 임시 프로필이 시스템 temp 밖에 있습니다.');
    }
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  };

  try {
    chromeProcess = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-gpu',
        '--no-first-run',
        '--disable-dev-shm-usage',
        ...(process.env.CI ? ['--no-sandbox'] : []),
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${profileDirectory}`,
        ...extraArgs,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', quiet ? 'ignore' : 'inherit'], windowsHide: true },
    );
    const target = await waitForChromeTarget(debuggingPort, chromeProcess);
    cdp = await createCdpClient(target.webSocketDebuggerUrl);
    return { cdp, close };
  } catch (error) {
    await close();
    throw error;
  }
}
