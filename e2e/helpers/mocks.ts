// 브라우저 기능 모의. 모두 `page.addInitScript` 로 앱 코드보다 먼저 심으므로 page.goto 전에 부른다.
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------------------------
// 저장소
// ---------------------------------------------------------------------------------------------
export type StorageFailure = 'blocked' | 'quota';

/**
 * 저장소 실패 모의.
 *  - 'blocked': `window.localStorage` 를 읽는 순간 SecurityError (쿠키·사이트 데이터 차단 상태)
 *  - 'quota'  : 읽기는 되지만 `setItem` 이 QuotaExceededError (저장 공간 가득 참)
 * 둘 다 sessionStorage 에는 영향이 없다.
 */
export async function mockStorage(page: Page, failure: StorageFailure): Promise<void> {
  await page.addInitScript((mode: StorageFailure) => {
    if (mode === 'blocked') {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
      return;
    }
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string): void {
      if (this === window.localStorage) {
        throw new DOMException(`Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`, 'QuotaExceededError');
      }
      nativeSetItem.call(this, key, value);
    };
  }, failure);
}

// ---------------------------------------------------------------------------------------------
// Web MIDI
// ---------------------------------------------------------------------------------------------
export interface MidiMock {
  /** 가짜 MIDI 입력 장치를 꽂고 id 를 돌려 준다(statechange 이벤트가 발생한다). */
  connect(name: string, manufacturer?: string): Promise<string>;
  /** 장치를 뽑는다(state 가 'disconnected' 로 바뀌고 statechange 가 발생한다). */
  disconnect(id: string): Promise<void>;
  /** 장치가 메시지를 보낸 것처럼 midimessage 를 일으킨다. 예: [0xb0, 64, 127] */
  send(id: string, bytes: number[]): Promise<void>;
  /** requestMIDIAccess 호출 횟수와 현재 연결된 입력 수 */
  stats(): Promise<{ requests: number; connectedInputs: number }>;
}

/**
 * `navigator.requestMIDIAccess` 를 가짜로 바꾼다. 처음에는 장치가 없고 `connect()` 로 꽂는다.
 * 앱이 쓰는 표면만 구현했다: access.inputs(Map), access.onstatechange, input.onmidimessage·state·id·name.
 */
export async function mockMidi(page: Page): Promise<MidiMock> {
  await page.addInitScript(() => {
    type Handler = ((event: unknown) => void) | null;
    interface FakeInput {
      id: string;
      name: string;
      manufacturer: string;
      type: 'input';
      state: 'connected' | 'disconnected';
      connection: 'open' | 'closed';
      onmidimessage: Handler;
      onstatechange: Handler;
      addEventListener(type: string, listener: (event: unknown) => void): void;
      removeEventListener(type: string, listener: (event: unknown) => void): void;
      open(): Promise<FakeInput>;
      close(): Promise<FakeInput>;
    }
    const inputs = new Map<string, FakeInput>();
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const stats = { requests: 0 };
    let counter = 0;
    const access = {
      inputs,
      outputs: new Map(),
      sysexEnabled: false,
      onstatechange: null as Handler,
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        listeners.get(type)?.delete(listener);
      },
    };
    const fireStateChange = (port: FakeInput) => {
      const event = { type: 'statechange', port, target: access };
      access.onstatechange?.(event);
      listeners.get('statechange')?.forEach((listener) => listener(event));
    };
    const midiMock = {
      connect(name: string, manufacturer = 'Mock') {
        counter += 1;
        const id = `mock-midi-${counter}`;
        const portListeners = new Set<(event: unknown) => void>();
        const input: FakeInput = {
          id,
          name,
          manufacturer,
          type: 'input',
          state: 'connected',
          connection: 'open',
          onmidimessage: null,
          onstatechange: null,
          addEventListener: (_type, listener) => portListeners.add(listener),
          removeEventListener: (_type, listener) => portListeners.delete(listener),
          open: () => Promise.resolve(input),
          close: () => Promise.resolve(input),
        };
        (input as FakeInput & { __listeners: Set<(event: unknown) => void> }).__listeners = portListeners;
        inputs.set(id, input);
        fireStateChange(input);
        return id;
      },
      disconnect(id: string) {
        const input = inputs.get(id);
        if (!input) return;
        input.state = 'disconnected';
        input.connection = 'closed';
        fireStateChange(input);
      },
      send(id: string, bytes: number[]) {
        const input = inputs.get(id);
        if (!input || input.state !== 'connected') return;
        const event = { type: 'midimessage', data: new Uint8Array(bytes), target: input, timeStamp: performance.now() };
        input.onmidimessage?.(event);
        (input as FakeInput & { __listeners: Set<(event: unknown) => void> }).__listeners.forEach((listener) => listener(event));
      },
      stats() {
        let connected = 0;
        inputs.forEach((input) => {
          if (input.state === 'connected') connected += 1;
        });
        return { requests: stats.requests, connectedInputs: connected };
      },
    };
    Object.defineProperty(window, '__midiMock', { value: midiMock, configurable: true });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => {
        stats.requests += 1;
        return Promise.resolve(access);
      },
    });
  });

  const call = <T>(expression: string): Promise<T> => page.evaluate(expression) as Promise<T>;
  return {
    connect: (name, manufacturer) =>
      call<string>(`window.__midiMock.connect(${JSON.stringify(name)}, ${JSON.stringify(manufacturer ?? 'Mock')})`),
    disconnect: (id) => call<void>(`window.__midiMock.disconnect(${JSON.stringify(id)})`),
    send: (id, bytes) => call<void>(`window.__midiMock.send(${JSON.stringify(id)}, ${JSON.stringify(bytes)})`),
    stats: () => call<{ requests: number; connectedInputs: number }>('window.__midiMock.stats()'),
  };
}

// ---------------------------------------------------------------------------------------------
// 문서 가시성
// ---------------------------------------------------------------------------------------------
/**
 * 문서 숨김 모의: `document.visibilityState`·`document.hidden` 값을 바꾸고 `visibilitychange` 를 일으킨다.
 * 이미 로드된 페이지에도 쓸 수 있다(첫 호출 때 접근자를 심는다).
 */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((nextHidden: boolean) => {
    const holder = window as unknown as { __visibilityOverride?: { hidden: boolean } };
    if (!holder.__visibilityOverride) {
      holder.__visibilityOverride = { hidden: false };
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (holder.__visibilityOverride?.hidden ? 'hidden' : 'visible'),
      });
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => Boolean(holder.__visibilityOverride?.hidden),
      });
    }
    if (holder.__visibilityOverride.hidden === nextHidden) return;
    holder.__visibilityOverride.hidden = nextHidden;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/**
 * 두 번째 탭을 앞으로 가져온다. 같은 컨텍스트에 빈 탭을 열고 bringToFront() 한다.
 * 헤드리스 Chromium 에서는 뒤로 간 탭의 visibilityState 가 바뀌지 않을 수 있으므로
 * 돌려 주는 `hiddenAfter` 로 실제 바뀌었는지 확인하고, 바뀌지 않으면 setHidden 모의를 함께 쓴다.
 */
export async function bringOtherTabToFront(page: Page): Promise<{ other: Page; hiddenAfter: boolean }> {
  const other = await page.context().newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const hiddenAfter = await page.evaluate(() => document.visibilityState === 'hidden');
  return { other, hiddenAfter };
}

// ---------------------------------------------------------------------------------------------
// getUserMedia
// ---------------------------------------------------------------------------------------------
export type GetUserMediaErrorName =
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'NotReadableError'
  | 'OverconstrainedError'
  | 'SecurityError'
  | 'AbortError'
  | 'TypeError';

export const GET_USER_MEDIA_ERRORS: readonly GetUserMediaErrorName[] = [
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
  'SecurityError',
  'AbortError',
  'TypeError',
];

/** `navigator.mediaDevices.getUserMedia` 를 지정한 오류 이름으로 거부하게 한다(영어 원문 메시지 포함). */
export async function mockGetUserMediaError(page: Page, name: GetUserMediaErrorName): Promise<void> {
  await page.addInitScript((errorName: GetUserMediaErrorName) => {
    const messages: Record<GetUserMediaErrorName, string> = {
      NotAllowedError: 'Permission denied',
      NotFoundError: 'Requested device not found',
      NotReadableError: 'Could not start audio source',
      OverconstrainedError: 'The constraints could not be satisfied by the available devices.',
      SecurityError: 'getUserMedia is not allowed in this context',
      AbortError: 'Starting audio source failed',
      TypeError: 'Failed to execute getUserMedia on MediaDevices',
    };
    const fail = (): Promise<MediaStream> => {
      if (errorName === 'TypeError') return Promise.reject(new TypeError(messages.TypeError));
      const error = new DOMException(messages[errorName], errorName);
      if (errorName === 'OverconstrainedError') Object.defineProperty(error, 'constraint', { value: 'deviceId' });
      return Promise.reject(error);
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: fail });
  }, name);
}

// ---------------------------------------------------------------------------------------------
// 오디오 컨텍스트·마이크 요청 추적
// ---------------------------------------------------------------------------------------------
export interface AudioTracking {
  /** 만들어진 실시간 AudioContext 들의 현재 상태 */
  contexts: Array<{ state: string; sampleRate: number }>;
  /** 만들어진 OfflineAudioContext 수(IR 생성 등) */
  offlineContexts: number;
  /** getUserMedia 호출 횟수 */
  getUserMediaCalls: number;
}

/**
 * AudioContext·OfflineAudioContext 생성자와 getUserMedia 를 감싸 만들어진 것을 센다.
 * 앱이 시작할 때 AudioContext 나 마이크를 몰래 만들지 않는지(E-23) 확인하는 데 쓴다.
 */
export async function trackAudioContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracked: BaseAudioContext[] = [];
    const counters = { offline: 0, getUserMedia: 0 };
    const wrap = <T extends { new (...args: never[]): BaseAudioContext }>(Native: T, onCreate: (instance: BaseAudioContext) => void): T => {
      const Wrapped = function (this: unknown, ...args: never[]) {
        const instance = Reflect.construct(Native, args, new.target ?? Wrapped) as BaseAudioContext;
        onCreate(instance);
        return instance;
      } as unknown as T;
      Wrapped.prototype = Native.prototype;
      Object.setPrototypeOf(Wrapped, Native);
      return Wrapped;
    };
    if (typeof AudioContext === 'function') {
      window.AudioContext = wrap(AudioContext, (instance) => tracked.push(instance));
    }
    if (typeof OfflineAudioContext === 'function') {
      window.OfflineAudioContext = wrap(OfflineAudioContext, () => {
        counters.offline += 1;
      });
    }
    const devices = navigator.mediaDevices;
    if (devices && typeof devices.getUserMedia === 'function') {
      const nativeGetUserMedia = devices.getUserMedia.bind(devices);
      Object.defineProperty(devices, 'getUserMedia', {
        configurable: true,
        value: (constraints?: MediaStreamConstraints) => {
          counters.getUserMedia += 1;
          return nativeGetUserMedia(constraints);
        },
      });
    }
    Object.defineProperty(window, '__audioTracking', {
      configurable: true,
      value: () => ({
        contexts: tracked.map((context) => ({ state: context.state, sampleRate: context.sampleRate })),
        offlineContexts: counters.offline,
        getUserMediaCalls: counters.getUserMedia,
      }),
    });
  });
}

export async function readAudioTracking(page: Page): Promise<AudioTracking> {
  return page.evaluate(() => (window as unknown as { __audioTracking: () => AudioTracking }).__audioTracking());
}
