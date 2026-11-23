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
  /** getUserMedia 가 돌려준 입력 트랙들의 현재 readyState('live' | 'ended') */
  inputTracks: Array<{ kind: string; readyState: string }>;
  /** 실시간 AudioContext 가 동시에 열려 있던(닫히지 않은) 최대 개수. 새 컨텍스트를 만드는 순간에 센다. */
  maxOpenContexts: number;
}

/**
 * AudioContext·OfflineAudioContext 생성자와 getUserMedia 를 감싸 만들어진 것을 센다.
 * 앱이 시작할 때 AudioContext 나 마이크를 몰래 만들지 않는지(E-23) 확인하는 데 쓴다.
 */
export async function trackAudioContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracked: BaseAudioContext[] = [];
    const streams: MediaStream[] = [];
    const counters = { offline: 0, getUserMedia: 0, maxOpen: 0 };
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
      window.AudioContext = wrap(AudioContext, (instance) => {
        tracked.push(instance);
        const open = tracked.filter((context) => context.state !== 'closed').length;
        counters.maxOpen = Math.max(counters.maxOpen, open);
      });
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
        value: async (constraints?: MediaStreamConstraints) => {
          counters.getUserMedia += 1;
          const stream = await nativeGetUserMedia(constraints);
          streams.push(stream);
          return stream;
        },
      });
    }
    Object.defineProperty(window, '__audioTracking', {
      configurable: true,
      value: () => ({
        contexts: tracked.map((context) => ({ state: context.state, sampleRate: context.sampleRate })),
        offlineContexts: counters.offline,
        getUserMediaCalls: counters.getUserMedia,
        inputTracks: streams.flatMap((stream) => stream.getTracks().map((track) => ({ kind: track.kind, readyState: track.readyState }))),
        maxOpenContexts: counters.maxOpen,
      }),
    });
  });
}

export async function readAudioTracking(page: Page): Promise<AudioTracking> {
  return page.evaluate(() => (window as unknown as { __audioTracking: () => AudioTracking }).__audioTracking());
}

// ---------------------------------------------------------------------------------------------
// 입력 채널 수 · 출력 좌우 레벨
// ---------------------------------------------------------------------------------------------
/**
 * 입력 장치가 채널 수를 `channelCount` 로 알리는 것처럼 보이게 한다(E-02: 채널이 하나뿐인 장치에서는 선택 메뉴가 없다).
 * 가짜 마이크는 `channelCount` 제약을 무시하고 늘 2채널을 주므로 트랙의 `getSettings()` 값만 바꾼다. 소리 자체는 그대로다.
 */
export async function mockInputChannelCount(page: Page, channelCount: number): Promise<void> {
  await page.addInitScript((count: number) => {
    const devices = navigator.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== 'function') return;
    const nativeGetUserMedia = devices.getUserMedia.bind(devices);
    Object.defineProperty(devices, 'getUserMedia', {
      configurable: true,
      value: async (constraints?: MediaStreamConstraints) => {
        const stream = await nativeGetUserMedia(constraints);
        for (const track of stream.getAudioTracks()) {
          const nativeSettings = track.getSettings.bind(track);
          track.getSettings = () => ({ ...nativeSettings(), channelCount: count });
        }
        return stream;
      },
    });
  }, channelCount);
}

export interface OutputLevels {
  /** 왼쪽 채널 RMS(dBFS). 완전한 무음이면 −200 */
  leftDb: number;
  /** 오른쪽 채널 RMS(dBFS) */
  rightDb: number;
}

/**
 * 앱이 `context.destination` 에 연결하는 노드마다 좌우를 따로 재는 분석 노드를 붙인다(소리는 바뀌지 않는다).
 * 앱 코드를 건드리지 않고 '실제로 스피커로 나가는 소리'의 좌우 균형을 보기 위한 것이다. page.goto 전에 부른다.
 */
export async function tapOutput(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Tap {
      source: AudioNode;
      left: AnalyserNode;
      right: AnalyserNode;
    }
    const taps: Tap[] = [];
    const nativeConnect = AudioNode.prototype.connect as unknown as (this: AudioNode, ...args: unknown[]) => unknown;
    const patched = function connect(this: AudioNode, ...args: unknown[]): unknown {
      const result = nativeConnect.apply(this, args);
      if (args[0] instanceof AudioDestinationNode && !taps.some((tap) => tap.source === this)) {
        const splitter = this.context.createChannelSplitter(2);
        const left = this.context.createAnalyser();
        const right = this.context.createAnalyser();
        nativeConnect.call(this, splitter);
        nativeConnect.call(splitter, left, 0);
        nativeConnect.call(splitter, right, 1);
        taps.push({ source: this, left, right });
      }
      return result;
    };
    AudioNode.prototype.connect = patched as unknown as typeof AudioNode.prototype.connect;
    Object.defineProperty(window, '__outputLevels', {
      configurable: true,
      value: async (durationMs: number): Promise<OutputLevels | null> => {
        const live = taps.filter((tap) => tap.source.context.state === 'running');
        const sums = live.map(() => ({ left: 0, right: 0, samples: 0 }));
        const buffer = new Float32Array(2048);
        const energy = (analyser: AnalyserNode): number => {
          analyser.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
          return sum;
        };
        const started = performance.now();
        do {
          live.forEach((tap, index) => {
            sums[index].left += energy(tap.left);
            sums[index].right += energy(tap.right);
            sums[index].samples += buffer.length;
          });
          await new Promise((resolve) => setTimeout(resolve, 40));
        } while (performance.now() - started < durationMs);
        const toDb = (sum: number, samples: number): number => (sum <= 0 ? -200 : Math.max(-200, 10 * Math.log10(sum / samples)));
        // 소리가 가장 큰 연결을 앱의 최종 출력으로 본다(녹음 도우미의 무음 연결이 함께 잡힐 수 있다).
        let best: OutputLevels | null = null;
        for (const sum of sums) {
          const levels = { leftDb: toDb(sum.left, sum.samples), rightDb: toDb(sum.right, sum.samples) };
          if (best === null || Math.max(levels.leftDb, levels.rightDb) > Math.max(best.leftDb, best.rightDb)) best = levels;
        }
        return best;
      },
    });
  });
}

/** `tapOutput` 을 심은 페이지에서 지금부터 durationMs 동안의 출력 좌우 RMS(dBFS)를 잰다. 연결된 상태에서 부른다. */
export async function readOutputLevels(page: Page, durationMs = 1000): Promise<OutputLevels> {
  const levels = await page.evaluate(
    (milliseconds) => (window as unknown as { __outputLevels: (ms: number) => Promise<OutputLevels | null> }).__outputLevels(milliseconds),
    durationMs,
  );
  if (!levels) throw new Error('출력 노드를 찾지 못했습니다. tapOutput 을 먼저 부르고, 앱이 연결된(재생 중인) 상태에서 읽어야 합니다.');
  return levels;
}

// ---------------------------------------------------------------------------------------------
// 하울링 차단 모의 · 사용자 동작 시각
// ---------------------------------------------------------------------------------------------
/**
 * 출력 가드(howl-guard) 워클릿이 '하울링 감지' 메시지를 보낸 것처럼 만들 수 있게 한다.
 * AudioWorkletNode 생성자를 감싸 `howl-guard` 노드의 포트를 붙잡아 두고, `triggerHowl()` 이 그 포트의 onmessage 를 부른다.
 * 실제 소리로 하울링을 일으키는 시험은 어렵고 흔들리므로, 차단 이후의 정리 경로만 확인하는 용도다.
 */
export async function mockHowlGuard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const guards: AudioWorkletNode[] = [];
    const Native = window.AudioWorkletNode;
    if (typeof Native !== 'function') return;
    const Wrapped = function (this: unknown, ...args: ConstructorParameters<typeof AudioWorkletNode>) {
      const instance = Reflect.construct(Native, args, new.target ?? Wrapped) as AudioWorkletNode;
      if (args[1] === 'howl-guard') guards.push(instance);
      return instance;
    } as unknown as typeof AudioWorkletNode;
    Wrapped.prototype = Native.prototype;
    Object.setPrototypeOf(Wrapped, Native);
    window.AudioWorkletNode = Wrapped;
    Object.defineProperty(window, '__triggerHowl', {
      configurable: true,
      value: () => {
        const guard = guards[guards.length - 1];
        const handler = guard?.port.onmessage;
        if (!guard || !handler) return false;
        (window as unknown as { __lastTrigger: number }).__lastTrigger = performance.now();
        handler.call(guard.port, new MessageEvent('message', { data: { type: 'howl' } }));
        return true;
      },
    });
  });
}

/** 마지막으로 만든 howl-guard 노드에 하울링 감지 메시지를 보낸다. 노드가 없으면 false. */
export async function triggerHowl(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __triggerHowl: () => boolean }).__triggerHowl());
}

/**
 * 키 누름·포인터 누름·클릭의 시각(`performance.now()`)을 `window.__lastTrigger` 에 남긴다.
 * '누른 뒤 500 ms 안에' 같은 기준을 Playwright 왕복 시간 없이 페이지 안에서 정확히 재기 위한 것이다.
 */
export async function markTriggers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stamp = () => {
      (window as unknown as { __lastTrigger: number }).__lastTrigger = performance.now();
    };
    for (const type of ['keydown', 'pointerdown', 'click']) window.addEventListener(type, stamp, { capture: true });
  });
}
