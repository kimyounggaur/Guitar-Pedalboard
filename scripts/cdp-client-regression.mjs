// scripts/lib/chrome.mjs 의 CDP 클라이언트가 연결이 끊겨도 영영 기다리지 않는지 확인한다.
//
// 배경: Browser.close 는 Chrome 이 답하기 전에 종료하면서 소켓을 닫는 일이 있다. 예전 클라이언트는 이때
// 대기 중인 요청을 풀어 주지 않아, 브라우저 시험(responsive-a11y 등)이 본 검사를 마치고도 종료 단계에서
// 180초 동안 멈췄다(S1.4a 검증 중 12회 중 1~2회 재현). 가짜 WebSocket 으로 연결·응답·끊김을 직접 일으켜 확인하므로
// Chrome 이 필요 없다.
import assert from 'node:assert/strict';
import console from 'node:console';
import { clearTimeout, setTimeout } from 'node:timers';
import { createCdpClient } from './lib/chrome.mjs';

class FakeSocket {
  static last = null;

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.listeners = new Map();
    FakeSocket.last = this;
    // 생성 직후 같은 틱에서 'open' 리스너가 붙으므로, 한 번 미뤄서 열린 것으로 만든다.
    Promise.resolve().then(() => this.emit('open', {}));
  }

  addEventListener(type, listener, options = {}) {
    const list = this.listeners.get(type) ?? [];
    list.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, list);
  }

  emit(type, event) {
    const list = this.listeners.get(type) ?? [];
    for (const entry of [...list]) {
      if (entry.once) list.splice(list.indexOf(entry), 1);
      entry.listener(event);
    }
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  /** 서버가 보낸 메시지를 흉내 낸다. */
  receive(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', {});
  }
}

/** 약속이 시간 안에 끝나지 않으면 '멈춤'을 오류로 바꿔, 되돌아온 결함이 시험을 멈추게 하지 않고 실패시키게 한다. */
function within(promise, milliseconds = 1_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${milliseconds}ms 안에 끝나지 않았습니다(멈춤).`)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = FakeSocket;
try {
  // 1. 요청에는 증가하는 id 가 붙고, 같은 id 의 응답이 결과로 돌아온다.
  const client = await createCdpClient('ws://fake.invalid/1');
  const socket = FakeSocket.last;
  const evaluated = client.send('Runtime.evaluate', { expression: '1+1' });
  assert.deepEqual(socket.sent, [{ id: 1, method: 'Runtime.evaluate', params: { expression: '1+1' } }]);
  socket.receive({ id: 1, result: { value: 2 } });
  assert.deepEqual(await within(evaluated), { value: 2 });

  // 2. 오류 응답은 거부로, 모르는 id 의 응답은 무시한다.
  const failing = client.send('Page.navigate', { url: 'x' });
  socket.receive({ id: 999, result: {} });
  socket.receive({ id: 2, error: { message: 'boom' } });
  await assert.rejects(within(failing), /boom/);

  // 3. 이벤트는 등록한 처리기로 간다.
  const events = [];
  client.on('Page.loadEventFired', (params) => events.push(params));
  socket.receive({ method: 'Page.loadEventFired', params: { timestamp: 7 } });
  assert.deepEqual(events, [{ timestamp: 7 }]);

  // 4. 핵심: 답을 기다리는 중에 연결이 끊기면(Chrome 이 Browser.close 에 답하지 않고 종료) 모든 대기 요청이 거부된다.
  const closing = client.send('Browser.close');
  const other = client.send('Page.enable');
  const settledBefore = client.send('Runtime.enable');
  socket.receive({ id: 5, result: {} });
  assert.deepEqual(await within(settledBefore), {}, '끊기기 전에 답이 온 요청은 값을 유지해야 합니다.');
  socket.close();
  await assert.rejects(within(closing), /닫혔/);
  await assert.rejects(within(other), /닫혔/);

  // 5. 끊긴 뒤의 send 는 보내지 않고 바로 거부된다.
  const sentCount = socket.sent.length;
  await assert.rejects(within(client.send('Runtime.evaluate')), /닫혔/);
  assert.equal(socket.sent.length, sentCount, '끊긴 소켓으로는 아무것도 보내지 않아야 합니다.');

  // 6. 클라이언트의 close() 는 소켓을 닫고, 이미 닫혀 있어도 오류 없이 지나간다.
  const second = await createCdpClient('ws://fake.invalid/2');
  const secondSocket = FakeSocket.last;
  const pendingAtClose = second.send('Browser.close');
  second.close();
  assert.equal(secondSocket.closed, true);
  await assert.rejects(within(pendingAtClose), /닫혔/);
  second.close();
} finally {
  globalThis.WebSocket = RealWebSocket;
}

console.log('CDP client regression passed: request/response ids, error replies, events, pending requests rejected when the socket closes, no sends after close.');
