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
  /** 뽑았던 같은 장치를 다시 꽂는다(같은 입력 객체가 'connected' 로 되살아나고 statechange 가 발생한다. 실제 크롬이 하는 일). */
  reconnect(id: string): Promise<void>;
  /** requestMIDIAccess 호출 횟수와 현재 연결된 입력 수 */
  stats(): Promise<{ requests: number; connectedInputs: number }>;
  /** 지금 꽂혀 있는 입력 중 앱이 `onmidimessage` 리스너를 붙여 둔 것의 수 */
  listening(): Promise<number>;
  /** 권한 모의(`options.permission` 을 준 경우): 지금 권한과, 권한 창이 뜬(= prompt 상태에서 요청한) 횟수 */
  permission(): Promise<{ state: 'granted' | 'prompt' | 'denied'; prompts: number }>;
  /** 사용자가 브라우저 설정에서 권한을 바꾼 것처럼 권한을 바꾸고 change 이벤트를 일으킨다. */
  setPermission(state: 'granted' | 'prompt' | 'denied'): Promise<void>;
  /** 다음 권한 창에서 사용자가 누를 답. 기본은 허용. */
  setPromptAnswer(answer: 'allow' | 'deny'): Promise<void>;
}

export interface MidiMockOptions {
  /**
   * MIDI 권한 모의. 주지 않으면 브라우저의 권한 조회를 건드리지 않고 요청은 언제나 성공한다(E-00 모의).
   * 'granted'·'prompt'·'denied' 는 `navigator.permissions.query({ name: 'midi' })` 가 그 상태를 돌려주고,
   * 'prompt' 에서 requestMIDIAccess 를 부르면 권한 창이 뜬 것으로 세어(`prompts`) 사용자의 답(`promptAnswer`)대로 허용·거부한다.
   * 'unsupported': 권한 조회가 예외를 던진다(Firefox·Safari 처럼). 요청은 권한 창 없이 성공한다.
   * 권한은 새로고침해도 이어진다(sessionStorage). 새로고침마다 장치·요청 횟수는 처음으로 돌아간다.
   */
  permission?: 'granted' | 'prompt' | 'denied' | 'unsupported';
  promptAnswer?: 'allow' | 'deny';
}

/**
 * `navigator.requestMIDIAccess` 를 가짜로 바꾼다. 처음에는 장치가 없고 `connect()` 로 꽂는다.
 * 앱이 쓰는 표면만 구현했다: access.inputs(Map), access.onstatechange, input.onmidimessage·state·id·name.
 */
export async function mockMidi(page: Page, options: MidiMockOptions = {}): Promise<MidiMock> {
  await page.addInitScript((opts) => {
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
    const stats = { requests: 0, prompts: 0 };
    let counter = 0;

    // --- 권한 모의(opts.permission 이 있을 때만) ---
    type PermState = 'granted' | 'prompt' | 'denied';
    const PERMISSION_KEY = '__midiMockPermission';
    const savedPermission = window.sessionStorage.getItem(PERMISSION_KEY);
    let permState: PermState =
      savedPermission === 'granted' || savedPermission === 'prompt' || savedPermission === 'denied'
        ? savedPermission
        : opts.permission === undefined || opts.permission === 'unsupported'
          ? 'prompt'
          : opts.permission;
    let promptAnswer: 'allow' | 'deny' = opts.promptAnswer ?? 'allow';
    const statusListeners = new Set<(event: unknown) => void>();
    const permissionStatus = {
      get state() {
        return permState;
      },
      onchange: null as Handler,
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (type === 'change') statusListeners.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        if (type === 'change') statusListeners.delete(listener);
      },
    };
    const setPermState = (next: PermState) => {
      if (next === permState) return;
      permState = next;
      window.sessionStorage.setItem(PERMISSION_KEY, next);
      const event = { type: 'change', target: permissionStatus };
      permissionStatus.onchange?.(event);
      statusListeners.forEach((listener) => listener(event));
    };
    if (opts.permission !== undefined) {
      const realPermissions = navigator.permissions;
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: {
          query: (descriptor: { name?: string }) => {
            if (descriptor?.name !== 'midi') return realPermissions.query(descriptor as PermissionDescriptor);
            if (opts.permission === 'unsupported') {
              return Promise.reject(new TypeError("Failed to execute 'query' on 'Permissions': 'midi' is not a valid enum value of type PermissionName."));
            }
            return Promise.resolve(permissionStatus);
          },
        },
      });
    }
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
      reconnect(id: string) {
        const input = inputs.get(id);
        if (!input) return;
        input.state = 'connected';
        input.connection = 'open';
        fireStateChange(input);
      },
      listening() {
        let count = 0;
        inputs.forEach((input) => {
          if (input.state === 'connected' && input.onmidimessage) count += 1;
        });
        return count;
      },
      permission() {
        return { state: permState, prompts: stats.prompts };
      },
      setPermission(state: PermState) {
        setPermState(state);
      },
      setPromptAnswer(answer: 'allow' | 'deny') {
        promptAnswer = answer;
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
        if (opts.permission !== undefined) {
          if (permState === 'denied') return Promise.reject(new DOMException('MIDI access was denied.', 'SecurityError'));
          if (permState === 'prompt') {
            stats.prompts += 1; // 권한 창이 떴다
            if (promptAnswer === 'deny') {
              setPermState('denied');
              return Promise.reject(new DOMException('MIDI access was denied.', 'SecurityError'));
            }
            setPermState('granted');
          }
        }
        return Promise.resolve(access);
      },
    });
  }, options);

  const call = <T>(expression: string): Promise<T> => page.evaluate(expression) as Promise<T>;
  return {
    connect: (name, manufacturer) =>
      call<string>(`window.__midiMock.connect(${JSON.stringify(name)}, ${JSON.stringify(manufacturer ?? 'Mock')})`),
    disconnect: (id) => call<void>(`window.__midiMock.disconnect(${JSON.stringify(id)})`),
    send: (id, bytes) => call<void>(`window.__midiMock.send(${JSON.stringify(id)}, ${JSON.stringify(bytes)})`),
    reconnect: (id) => call<void>(`window.__midiMock.reconnect(${JSON.stringify(id)})`),
    stats: () => call<{ requests: number; connectedInputs: number }>('window.__midiMock.stats()'),
    listening: () => call<number>('window.__midiMock.listening()'),
    permission: () => call<{ state: 'granted' | 'prompt' | 'denied'; prompts: number }>('window.__midiMock.permission()'),
    setPermission: (state) => call<void>(`window.__midiMock.setPermission(${JSON.stringify(state)})`),
    setPromptAnswer: (answer) => call<void>(`window.__midiMock.setPromptAnswer(${JSON.stringify(answer)})`),
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
// 워클릿 모듈 로드 추적
// ---------------------------------------------------------------------------------------------
export interface WorkletModuleLoad {
  /** addModule 에 넘긴 주소. 문자열 워클릿은 `blob:` 주소, 별도 파일 워클릿은 `/assets/…` 주소다. */
  url: string;
  status: 'pending' | 'loaded' | 'failed';
  message?: string;
}

/** `AudioWorklet.addModule` 호출과 결과를 기록한다. 오프라인 새로고침 뒤에도 워클릿이 다 로드되는지(E-23) 확인하는 데 쓴다. */
export async function trackWorkletModules(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const loads: Array<{ url: string; status: 'pending' | 'loaded' | 'failed'; message?: string }> = [];
    if (typeof AudioWorklet === 'function') {
      const nativeAddModule = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = function addModule(this: AudioWorklet, moduleURL: string | URL, options?: WorkletOptions): Promise<void> {
        const entry: { url: string; status: 'pending' | 'loaded' | 'failed'; message?: string } = { url: String(moduleURL), status: 'pending' };
        loads.push(entry);
        return nativeAddModule.call(this, moduleURL, options).then(
          () => {
            entry.status = 'loaded';
          },
          (error: unknown) => {
            entry.status = 'failed';
            entry.message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            throw error;
          },
        );
      };
    }
    Object.defineProperty(window, '__workletModules', {
      configurable: true,
      value: () => loads.map((load) => ({ ...load })),
    });
  });
}

export async function readWorkletModules(page: Page): Promise<WorkletModuleLoad[]> {
  return page.evaluate(() => (window as unknown as { __workletModules: () => WorkletModuleLoad[] }).__workletModules());
}

// ---------------------------------------------------------------------------------------------
// 오디오 그래프 연결 추적
// ---------------------------------------------------------------------------------------------
export interface GraphEdge {
  /** 연결을 시작한 노드. 워클릿은 `worklet:<처리기 이름>`, 나머지는 생성자 이름(예: GainNode). */
  from: string;
  /** 연결된 노드. 이름 규칙은 같다. */
  to: string;
  /** 출발 노드의 출력 번호(`connect(dest, output, input)` 의 두 번째 인자). 생략하면 0. */
  output: number;
  /** 도착 노드의 입력 번호(세 번째 인자). 생략하면 0. 입력이 둘인 출력 가드(0 = 프로그램, 1 = 하울링 분석 전용)를 가려내는 데 쓴다. */
  input: number;
}

/**
 * `AudioNode.connect` 호출과 워클릿 처리기 이름을 기록해 실제로 만들어진 그래프의 연결 모양을 볼 수 있게 한다.
 * (스피커·미터·녹음이 같은 레벨 미터#out 출력에서 갈라지는지처럼, 소리 레벨만으로는 알 수 없는 연결을 확인하는 데 쓴다.)
 * 앱 코드보다 먼저 심어야 하므로 page.goto 전에 부른다.
 */
export async function trackAudioGraph(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const names = new WeakMap<object, string>();
    const edges: Array<{ from: string; to: string; output: number; input: number }> = [];
    const NativeWorkletNode = window.AudioWorkletNode;
    if (typeof NativeWorkletNode === 'function') {
      window.AudioWorkletNode = class extends NativeWorkletNode {
        constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
          super(context, name, options);
          names.set(this, `worklet:${name}`);
        }
      } as typeof AudioWorkletNode;
    }
    const label = (node: object): string => names.get(node) ?? node.constructor.name;
    const nativeConnect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
    AudioNode.prototype.connect = function connect(this: AudioNode, destination: unknown, ...rest: unknown[]): unknown {
      // AudioParam 으로 가는 연결은 건너뛰고 노드끼리의 연결만 센다. 출력·입력 번호는 `connect(dest, output, input)` 의 인자 순서를 따른다.
      if (destination instanceof AudioNode) {
        edges.push({
          from: label(this),
          to: label(destination),
          output: typeof rest[0] === 'number' ? rest[0] : 0,
          input: typeof rest[1] === 'number' ? rest[1] : 0,
        });
      }
      return nativeConnect.call(this, destination, ...rest);
    } as typeof AudioNode.prototype.connect;
    Object.defineProperty(window, '__audioEdges', {
      configurable: true,
      value: () => edges.map((edge) => ({ ...edge })),
    });
    // 끊은 연결도 기록한다(S4.2: 꺼진 페달은 이펙트 입력을 끊어 쉰다). 도착 노드를 준 `disconnect(destination)` 만 센다.
    const disconnects: Array<{ from: string; to: string }> = [];
    const nativeDisconnect = AudioNode.prototype.disconnect as (this: AudioNode, ...args: unknown[]) => unknown;
    AudioNode.prototype.disconnect = function disconnect(this: AudioNode, ...args: unknown[]): unknown {
      if (args[0] instanceof AudioNode) disconnects.push({ from: label(this), to: label(args[0]) });
      return nativeDisconnect.apply(this, args);
    } as typeof AudioNode.prototype.disconnect;
    Object.defineProperty(window, '__audioDisconnects', {
      configurable: true,
      value: () => disconnects.map((entry) => ({ ...entry })),
    });
  });
}

/** `trackAudioGraph` 를 심은 페이지에서 지금까지 끊긴 연결(도착 노드를 준 `disconnect` 호출)의 출발·도착 노드 이름 목록 */
export async function readAudioDisconnects(page: Page): Promise<Array<{ from: string; to: string }>> {
  return page.evaluate(() => (window as unknown as { __audioDisconnects: () => Array<{ from: string; to: string }> }).__audioDisconnects());
}

export async function readAudioEdges(page: Page): Promise<GraphEdge[]> {
  return page.evaluate(() => (window as unknown as { __audioEdges: () => GraphEdge[] }).__audioEdges());
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
 * 출력 가드(output-guard) 워클릿이 '하울링 차단' 메시지를 보낸 것처럼 만들 수 있게 한다(S1.5).
 * AudioWorkletNode 생성자를 감싸 `output-guard` 노드의 포트를 붙잡아 두고, `triggerHowl()` 이 그 포트의 onmessage 를 부른다.
 * 메시지 모양은 가드가 실제로 보내는 `{type:'howl-cut', freqHz, frame}` 이다. 소리로 일으키는 진짜 하울링 시험은 E-03(`e03-howl.spec.ts`)이 맡고,
 * 이 모의는 차단 이후의 정리 경로(마이크 해제·토스트·녹음 보존)만 소리 없이 빠르게 확인하는 용도다.
 */
export async function mockHowlGuard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const guards: AudioWorkletNode[] = [];
    const Native = window.AudioWorkletNode;
    if (typeof Native !== 'function') return;
    const Wrapped = function (this: unknown, ...args: ConstructorParameters<typeof AudioWorkletNode>) {
      const instance = Reflect.construct(Native, args, new.target ?? Wrapped) as AudioWorkletNode;
      if (args[1] === 'output-guard') guards.push(instance);
      return instance;
    } as unknown as typeof AudioWorkletNode;
    Wrapped.prototype = Native.prototype;
    Object.setPrototypeOf(Wrapped, Native);
    window.AudioWorkletNode = Wrapped;
    Object.defineProperty(window, '__triggerHowl', {
      configurable: true,
      value: (freqHz: number) => {
        const guard = guards[guards.length - 1];
        const handler = guard?.port.onmessage;
        if (!guard || !handler) return false;
        (window as unknown as { __lastTrigger: number }).__lastTrigger = performance.now();
        handler.call(guard.port, new MessageEvent('message', { data: { type: 'howl-cut', freqHz, frame: 0 } }));
        return true;
      },
    });
  });
}

/** 마지막으로 만든 output-guard 노드에 하울링 차단 메시지(`howl-cut`, 주파수 freqHz)를 보낸다. 노드가 없으면 false. */
export async function triggerHowl(page: Page, freqHz = 1000): Promise<boolean> {
  return page.evaluate((hz) => (window as unknown as { __triggerHowl: (hz: number) => boolean }).__triggerHowl(hz), freqHz);
}

// ---------------------------------------------------------------------------------------------
// 출력 가드 관찰(E-03): 진짜 하울링 차단이 오디오 시계로 몇 초 만에 일어났는지
// ---------------------------------------------------------------------------------------------
export interface GuardObservation {
  /** 오디오 컨텍스트의 샘플레이트(Hz). 가드·레벨 미터 노드가 아직 없으면 0. */
  sampleRate: number;
  /** 입력 쪽 레벨 미터(level-meter#in)가 지금까지 보낸 메시지 수. 마이크가 실제로 흐르는지 확인하는 데 쓴다. */
  inputLevelMessages: number;
  /** 입력 레벨이 처음 −50 dBFS(가드의 레벨 하한)를 넘은 구간의 시작 시각(오디오 시계, 초). 한 번도 없으면 null. 보고 간격(약 33 ms)만큼 앞당겨 잡아 늦게 재지 않는다. */
  firstAudibleSeconds: number | null;
  /** 가드가 `howl-cut` 을 알린 시각(오디오 시계, 초). 차단이 없었으면 null. */
  cutSeconds: number | null;
  /** 차단 때 가드가 알린 하울링 주파수(Hz) */
  cutFreqHz: number | null;
  /** 차단 메시지를 메인 스레드가 받은 시각(`performance.now()`). 정지 정리까지 걸린 시간을 이 시각부터 잰다. */
  cutReceivedAt: number | null;
  /** 차단 메시지를 메인 스레드가 받은 때의 `document.visibilityState`. 차단이 없었으면 null. */
  visibilityAtCut: string | null;
  /** 차단 메시지를 받은 때 휴대폰 하단 도크에서 선택되어 있던 탭의 id(예: 'mobile-tab-pedals'). 차단이 없었거나 탭이 없는 배치(데스크톱)면 null. */
  selectedTabAtCut: string | null;
  /** 판정 진행 중(`howl-suspect`) 메시지 수 */
  suspectMessages: number;
}

/**
 * 출력 가드(`output-guard`)와 레벨 미터(`level-meter`) 노드의 포트 메시지를 앱과 나란히 엿본다(앱의 수신기는 그대로 둔다).
 * 가드가 1 kHz 지속음을 입력에서 처음 들은 때부터 차단 메시지를 보낸 때까지를 **오디오 시계**로 재기 위한 것이다.
 * 벽시계로 재면 마이크를 여는 시간·Playwright 왕복이 섞이고, 문서가 숨겨진 쪽은 타이머가 늦춰져 값이 흔들린다.
 * 차단 메시지를 받으면 `window.__lastTrigger` 도 그 시각으로 남기므로 `waitForTeardown` 이 '차단 → 정리 끝'을 잴 수 있다.
 * 앱 코드보다 먼저 심어야 하므로 page.goto 전에 부른다.
 */
export async function observeGuard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      sampleRate: 0,
      inputLevelMessages: 0,
      firstAudibleFrame: null as number | null,
      reportFrames: 0,
      cutFrame: null as number | null,
      cutFreqHz: null as number | null,
      cutReceivedAt: null as number | null,
      visibilityAtCut: null as string | null,
      selectedTabAtCut: null as string | null,
      suspectMessages: 0,
    };
    const Native = window.AudioWorkletNode;
    if (typeof Native !== 'function') return;
    // 가드의 레벨 하한(부록 B)과 같은 값. 이 레벨을 넘는 첫 입력을 '신호가 들어오기 시작한 때'로 본다.
    const AUDIBLE_DB = -50;
    const LEVEL_REPORT_HZ = 30;
    const RENDER_QUANTUM = 128;
    const Wrapped = function (this: unknown, ...args: ConstructorParameters<typeof AudioWorkletNode>) {
      const instance = Reflect.construct(Native, args, new.target ?? Wrapped) as AudioWorkletNode;
      const name = args[1];
      if (name === 'level-meter' || name === 'output-guard') {
        state.sampleRate = instance.context.sampleRate;
        state.reportFrames = Math.ceil(Math.round(state.sampleRate / LEVEL_REPORT_HZ) / RENDER_QUANTUM) * RENDER_QUANTUM;
        instance.port.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as { type?: string; tap?: string; frame?: number; rmsDb?: number[]; freqHz?: number } | null;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'level' && data.tap === 'in' && Array.isArray(data.rmsDb) && typeof data.frame === 'number') {
            state.inputLevelMessages += 1;
            if (state.firstAudibleFrame === null && Math.max(...data.rmsDb) > AUDIBLE_DB) state.firstAudibleFrame = data.frame - state.reportFrames;
          } else if (data.type === 'howl-suspect') {
            state.suspectMessages += 1;
          } else if (data.type === 'howl-cut' && state.cutFrame === null && typeof data.frame === 'number') {
            state.cutFrame = data.frame;
            state.cutFreqHz = typeof data.freqHz === 'number' ? data.freqHz : null;
            state.cutReceivedAt = performance.now();
            state.visibilityAtCut = document.visibilityState;
            state.selectedTabAtCut = document.querySelector('.mobile-bottom-tabs [role="tab"][aria-selected="true"]')?.id ?? null;
            (window as unknown as { __lastTrigger: number }).__lastTrigger = state.cutReceivedAt;
          }
        });
        // 수신기를 하나 더 달아도 앱의 `port.onmessage =` 가 포트를 시작시키지만, 먼저 시작해 두어도 앱이 받는 메시지는 달라지지 않는다.
        instance.port.start();
      }
      return instance;
    } as unknown as typeof AudioWorkletNode;
    Wrapped.prototype = Native.prototype;
    Object.setPrototypeOf(Wrapped, Native);
    window.AudioWorkletNode = Wrapped;
    Object.defineProperty(window, '__guardObservation', {
      configurable: true,
      value: (): GuardObservation => ({
        sampleRate: state.sampleRate,
        inputLevelMessages: state.inputLevelMessages,
        firstAudibleSeconds: state.firstAudibleFrame === null || state.sampleRate === 0 ? null : Math.max(0, state.firstAudibleFrame) / state.sampleRate,
        cutSeconds: state.cutFrame === null || state.sampleRate === 0 ? null : state.cutFrame / state.sampleRate,
        cutFreqHz: state.cutFreqHz,
        cutReceivedAt: state.cutReceivedAt,
        visibilityAtCut: state.visibilityAtCut,
        selectedTabAtCut: state.selectedTabAtCut,
        suspectMessages: state.suspectMessages,
      }),
    });
  });
}

export async function readGuardObservation(page: Page): Promise<GuardObservation> {
  return page.evaluate(() => (window as unknown as { __guardObservation: () => GuardObservation }).__guardObservation());
}

/** 숨겨진 탭에서 타이머가 깨어나는 최소 간격(ms). Chrome 은 백그라운드 탭의 setTimeout·setInterval 을 약 1초에 한 번만 깨운다. */
export const HIDDEN_TIMER_FLOOR_MS = 1000;

/**
 * 문서를 '숨김'으로 **흉내 낸다**. 진짜 숨김은 이 환경의 헤드리스 Chrome 에서 만들 수 없다
 * (실측: 탭을 앞뒤로 옮기거나 창을 최소화해도 visibilityState 는 'visible' 그대로이고, 페이지마다 창이 따로 뜬다).
 * 그래서 숨겨진 탭이 앱에 주는 조건을 페이지 안에서 만든다. 가장 불리한 쪽으로 잡는다.
 *   (1) `document.visibilityState` = 'hidden', `document.hidden` = true, `visibilitychange` 발생,
 *   (2) `requestAnimationFrame` 콜백이 오지 않는다(숨겨진 탭은 프레임을 그리지 않는다),
 *   (3) `setTimeout`·`setInterval` 이 최소 1초 뒤에야 깨어난다(백그라운드 타이머 스로틀의 최악의 경우).
 * 오디오 스레드(워클릿)와 MessagePort 는 실제 숨김에서도 그대로 도는 부분이라 건드리지 않는다.
 * 이 흉내로 확인되는 것은 '하울링 감시와 차단 경로가 화면 상태·rAF·짧은 타이머에 기대지 않는다' 까지다.
 * 실제로 다른 탭·화면 꺼짐 상태에서 같은지는 사람이 실기기에서 본다.
 */
export async function emulateHiddenDocument(page: Page, timerFloorMs = HIDDEN_TIMER_FLOOR_MS): Promise<void> {
  await page.evaluate((floor) => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__hiddenEmulation) return;
    w.__hiddenEmulation = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => undefined;
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeSetInterval = window.setInterval.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => nativeSetTimeout(handler, Math.max(Number(timeout) || 0, floor), ...args)) as typeof window.setTimeout;
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => nativeSetInterval(handler, Math.max(Number(timeout) || 0, floor), ...args)) as typeof window.setInterval;
    document.dispatchEvent(new Event('visibilitychange'));
  }, timerFloorMs);
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

// ---------------------------------------------------------------------------------------------
// 입출력 장치 모의(E-17)
// ---------------------------------------------------------------------------------------------
export interface MockedDevice {
  kind: 'audioinput' | 'audiooutput';
  deviceId: string;
  label: string;
}

/** 장치 모의의 상태. 새로고침해도 이어지게 sessionStorage 에 둔다(앱의 localStorage 와 겹치지 않는다). */
export interface DeviceMockState {
  /** 목록에서 숨기는 장치의 고정 id(`audioinput:Fake Audio Input 2` 처럼 종류:이름, 옵션의 value 와 같다). 숨긴 장치를 지정한 getUserMedia·setSinkId 는 거부한다. */
  hidden: string[];
  /** 진짜 가짜 장치 목록 뒤에 덧붙이는 장치(열 수는 없는 장치다) */
  added: MockedDevice[];
  /** 장치 id 를 바꿔서 보이게 한다(같은 장치가 사이트 데이터 삭제 뒤 새 id 를 받은 상황). 키는 고정 id, 값은 보여 줄 id */
  renamed: Record<string, string>;
  /** true 면 마이크 권한을 받기 전 브라우저처럼 장치마다 id·이름을 비워서 준다 */
  blank: boolean;
}

export interface DeviceMockOptions {
  /** false 면 `AudioContext.prototype.setSinkId` 를 없앤다(Firefox·Safari 처럼). 기본은 그대로 둔다. */
  sinkId?: boolean;
}

export interface DeviceMock {
  /** 상태를 고치고 `devicechange` 를 보낸다 */
  change(patch: Partial<DeviceMockState>): Promise<void>;
  /** `devicechange` 를 `times` 번 연달아 보낸다(상태는 그대로) */
  burst(times: number): Promise<void>;
  /** 상태만 고친다(이벤트 없음). 새로고침 직전에 '그 사이 장치가 바뀌었다'를 만들 때 쓴다. */
  set(patch: Partial<DeviceMockState>): Promise<void>;
  /** 앱이 `setSinkId` 에 넘긴 id 들(새로고침하면 비워진다) */
  sinkCalls(): Promise<string[]>;
  /** 앱이 낸 getUserMedia 요청: 장치를 지정했으면 `exact:<id>`, 아니면 `default`(새로고침하면 비워진다) */
  userMediaRequests(): Promise<string[]>;
  /** `enumerateDevices` 호출 횟수(새로고침하면 0부터) */
  enumerateCalls(): Promise<number>;
}

const DEVICE_MOCK_KEY = 'e17-device-mock';

/**
 * `navigator.mediaDevices.enumerateDevices`·`getUserMedia` 와 `AudioContext.setSinkId` 를 감싸 장치가 꽂히고 빠지는 상황을 만든다.
 * 진짜 목록은 Chromium 의 가짜 장치(입력 3개: default·Fake Audio Input 1·2, 출력 3개)다. 이 가짜 장치의 id 는 문서를 새로 열 때마다 바뀌므로
 * (실제 브라우저에서는 사이트 데이터를 지우면 바뀌는 것과 같다) 모의가 종류·이름으로 만든 고정 id(`audioinput:Fake Audio Input 2`)로 바꿔 보여 준다.
 * 그 위에 숨기기·덧붙이기·id 바꾸기를 얹는다. 바꿔 보인 id 는 getUserMedia·setSinkId 에서 진짜 id 로 되돌려 열므로 연결은 실제로 된다.
 */
export async function mockDevices(page: Page, options: DeviceMockOptions = {}): Promise<DeviceMock> {
  await page.addInitScript(
    ({ key, keepSinkId }) => {
      interface State {
        hidden: string[];
        added: Array<{ kind: string; deviceId: string; label: string }>;
        renamed: Record<string, string>;
        blank: boolean;
      }
      const read = (): State => {
        try {
          const parsed = JSON.parse(sessionStorage.getItem(key) ?? '') as Partial<State>;
          return { hidden: parsed.hidden ?? [], added: parsed.added ?? [], renamed: parsed.renamed ?? {}, blank: parsed.blank ?? false };
        } catch {
          return { hidden: [], added: [], renamed: {}, blank: false };
        }
      };
      const log = { sink: [] as string[], gum: [] as string[], enumerate: 0 };
      const devices = navigator.mediaDevices;
      const nativeEnumerate = devices.enumerateDevices.bind(devices);
      const stableId = (device: { kind: string; label: string }): string => `${device.kind}:${device.label}`;

      /** 앱이 본 id → 진짜 id. 숨겼거나 덧붙인(열 수 없는) 장치면 null */
      const toRealId = async (shownId: string): Promise<string | null> => {
        const state = read();
        const stable = Object.keys(state.renamed).find((original) => state.renamed[original] === shownId) ?? shownId;
        if (state.hidden.includes(stable)) return null;
        const real = (await nativeEnumerate()).find((device) => stableId(device) === stable);
        return real ? real.deviceId : null;
      };

      Object.defineProperty(devices, 'enumerateDevices', {
        configurable: true,
        value: async () => {
          log.enumerate += 1;
          const state = read();
          const real = await nativeEnumerate();
          if (state.blank) {
            return real.map((device) => ({ kind: device.kind, label: '', groupId: '', deviceId: '', toJSON: () => ({}) }));
          }
          const shown = real
            .filter((device) => !state.hidden.includes(stableId(device)))
            .map((device) => ({
              kind: device.kind,
              label: device.label,
              groupId: device.groupId,
              deviceId: state.renamed[stableId(device)] ?? stableId(device),
              toJSON: () => ({}),
            }));
          return [...shown, ...state.added.map((device) => ({ ...device, groupId: '', toJSON: () => ({}) }))];
        },
      });

      const nativeGetUserMedia = devices.getUserMedia.bind(devices);
      Object.defineProperty(devices, 'getUserMedia', {
        configurable: true,
        value: async (constraints?: MediaStreamConstraints) => {
          const audio = constraints?.audio;
          const wanted = typeof audio === 'object' && audio !== null ? (audio.deviceId as ConstrainDOMStringParameters | string | undefined) : undefined;
          const exact = typeof wanted === 'string' ? wanted : (wanted?.exact as string | undefined);
          log.gum.push(exact ? `exact:${exact}` : 'default');
          if (!exact) return nativeGetUserMedia(constraints);
          const real = await toRealId(exact);
          if (real === null) {
            const error = new DOMException('Requested device not found', 'OverconstrainedError');
            Object.defineProperty(error, 'constraint', { value: 'deviceId' });
            throw error;
          }
          return nativeGetUserMedia({ ...constraints, audio: { ...(audio as MediaTrackConstraints), deviceId: { exact: real } } });
        },
      });

      const proto = AudioContext.prototype as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (!keepSinkId) {
        delete proto.setSinkId;
      } else if (typeof proto.setSinkId === 'function') {
        const nativeSetSinkId = proto.setSinkId;
        proto.setSinkId = async function setSinkId(this: AudioContext, id: string) {
          log.sink.push(String(id));
          const real = id === '' ? '' : await toRealId(String(id));
          if (real === null) throw new DOMException('Device not found', 'NotFoundError');
          return nativeSetSinkId.call(this, real);
        };
      }

      Object.defineProperty(window, '__deviceMock', {
        configurable: true,
        value: {
          log,
          read,
          write: (state: State) => sessionStorage.setItem(key, JSON.stringify(state)),
        },
      });
    },
    { key: DEVICE_MOCK_KEY, keepSinkId: options.sinkId !== false },
  );

  type Hook = { log: { sink: string[]; gum: string[]; enumerate: number }; read: () => DeviceMockState; write: (state: DeviceMockState) => void };
  const merge = (patch: Partial<DeviceMockState>, notify: boolean) =>
    page.evaluate(
      ({ patch: next, notify: shouldNotify }) => {
        const hook = (window as unknown as { __deviceMock: Hook }).__deviceMock;
        hook.write({ ...hook.read(), ...next });
        if (shouldNotify) navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      },
      { patch, notify },
    );

  return {
    change: (patch) => merge(patch, true),
    set: (patch) => merge(patch, false),
    burst: (times) =>
      page.evaluate((count) => {
        for (let index = 0; index < count; index += 1) navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      }, times),
    sinkCalls: () => page.evaluate(() => [...(window as unknown as { __deviceMock: Hook }).__deviceMock.log.sink]),
    userMediaRequests: () => page.evaluate(() => [...(window as unknown as { __deviceMock: Hook }).__deviceMock.log.gum]),
    enumerateCalls: () => page.evaluate(() => (window as unknown as { __deviceMock: Hook }).__deviceMock.log.enumerate),
  };
}
