// 브라우저 저장소(localStorage)를 감싸는 안전한 저장소(S1.7, 설계서 4.8절, 보고서 R2-1).
//
// 앱의 저장·읽기는 모두 이 파일을 지난다. 이 파일만 `localStorage` 를 직접 건드린다(ESLint 가 다른 곳의 직접 참조를 막는다).
// 어떤 경우에도 던지지 않는다 — 사이트 데이터가 차단돼도, 저장 공간이 가득 차도, 값이 깨져 있어도 앱은 계속 동작한다.
//
//   상황               | 감지                              | 동작                                   | 안내(한 번)
//   사이트 데이터 차단 | localStorage 접근이 SecurityError | memory 모드, 값은 이번 방문 동안만 유지 | blocked
//   저장 공간 가득 참  | setItem 의 QuotaExceededError     | 값은 메모리에 유지, 조작 계속          | quota
//   깨진 값            | 해석 실패 또는 검증 실패          | 원문을 `{키}:corrupt-{시각}` 에 보관, 기본값 | corrupt
//
// 이 파일은 React·zustand 에 기대지 않는다. 안내를 보여 주는 방법은 `notify` 로 받는다(앱에서는 토스트, 시험에서는 기록).
import { APP_STORAGE_PREFIX, CORRUPT_KEY_INFIX, KEPT_ON_RESET_KEYS, STORAGE_KEYS, type StorageKey } from './keys';
import { ko } from '../i18n/ko';

export type WriteFailureReason = 'blocked' | 'quota' | 'unknown';
export type WriteResult = { ok: true } | { ok: false; reason: WriteFailureReason };

/** 사용자에게 한 번만 알리는 저장 문제의 종류 */
export type StorageNoticeKind = 'blocked' | 'quota' | 'corrupt' | 'unknown';

/** 안내 문구(설계서 4.8절 표 그대로, unknown 만 이 Step 에서 더했다 — REFACTOR_LOG). */
export const STORAGE_NOTICE_MESSAGES: Readonly<Record<StorageNoticeKind, string>> = {
  blocked: ko.storage.blocked,
  quota: ko.storage.quota,
  corrupt: ko.storage.corrupt,
  unknown: ko.storage.unknown,
};

/** localStorage 가 가진 표면 중 이 파일이 쓰는 것. 시험에서는 가짜를 꽂는다. `removeItem`·`key`·`length` 는 없어도 된다. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
}

export interface SafeStorageOptions {
  /**
   * 저장소를 얻는다. 얻는 순간 SecurityError 를 던질 수 있다(사이트 데이터 차단).
   * `undefined`·`null` 은 '저장소가 없는 환경'(Node 시험 등)이며 조용히 메모리로만 동작한다.
   * 부를 때마다 새로 얻으므로 시험이 `window.localStorage` 를 바꿔 끼워도 따라간다.
   */
  getBackend?: () => StorageBackend | null | undefined;
  /** 저장 문제를 사용자에게 알릴 때 종류마다 한 번만 불린다. 던져도 무시한다. */
  notify?: (kind: StorageNoticeKind, message: string) => void;
  /** 시각(깨진 값 보관 키에 쓴다). 시험에서 고정한다. */
  now?: () => number;
  /** 페이지가 가려지거나 닫힐 때 밀린 저장을 바로 쓰도록 `flush` 를 걸어 준다. 기본은 pagehide·visibilitychange(hidden). */
  subscribeToPageHide?: (flush: () => void) => void;
  /** 이름이 같은 깨진 값 보관본을 몇 개까지 남길지. 기본 3 */
  maxCorruptArchives?: number;
}

export interface SafeStorage {
  /** 저장소에 닿을 수 있으면 'persistent', 막혔거나 없으면 'memory' */
  readonly mode: 'persistent' | 'memory';
  /** 원문 그대로 읽는다. 없으면 null. 던지지 않는다. 저장에 실패해 메모리에만 있는 값이 있으면 그것이 우선한다. */
  getRaw(key: StorageKey): string | null;
  /**
   * 원문을 `parse` 로 해석한다. 키가 없거나 비어 있으면 `fallback`. `parse` 가 던지면 '깨진 값'으로 보고
   * 원문을 보관한 뒤 `fallback` 을 돌려 주고 안내를 한 번 보여 준다. 던지지 않는다.
   */
  read<T>(key: StorageKey, parse: (raw: string) => T, fallback: T): T;
  /** JSON 으로 읽는다. 해석 실패나 `validate` 실패는 깨진 값이다. 던지지 않는다. */
  get<T>(key: StorageKey, fallback: T, validate?: (value: unknown) => value is T): T;
  /** 원문 그대로 쓴다(JSON 이 아닌 값, 이미 직렬화한 값). 던지지 않는다. */
  setRaw(key: StorageKey, raw: string): WriteResult;
  /** JSON 으로 쓴다. 던지지 않는다. 같은 키에 밀려 있던 디바운스 저장은 이 값으로 대신한다. */
  set(key: StorageKey, value: unknown): WriteResult;
  /**
   * 마지막 호출로부터 `ms`(기본 300) 뒤에 한 번 쓴다. 노브를 돌리는 동안에는 쓰지 않는다.
   * `value` 가 함수면 쓰는 순간에 부른다(그 사이 바뀐 최신 값을 읽도록). pagehide·visibilitychange(hidden) 에서는 바로 쓴다.
   */
  setDebounced(key: StorageKey, value: unknown | (() => unknown), ms?: number): void;
  /** 밀려 있는 디바운스 저장을 지금 쓴다. */
  flush(): void;
  /** 지운다. 저장소를 못 쓰면 이번 방문 동안만 지운 것으로 본다. 던지지 않는다. */
  remove(key: StorageKey): void;
  /** 이 앱의 키(깨진 값 보관본 포함)가 저장소에 차지하는 바이트 수. UTF-16 글자 하나를 2바이트로 센 근삿값이다. */
  usageBytes(): number;
  /**
   * 이 앱의 설정 키(`guitar-pedalboard:` 로 시작하는 것, 깨진 값 보관본 포함)를 지우고 지운 개수를 돌려 준다.
   * 사용자 프리셋은 지우지 않는다: v2 프리셋 키(`v2:presets`, 보관본 포함)와 그것을 가리키는 `schema` 키, 접두사가 다른 v1 프리셋 키(백업).
   * 접두사는 고정이다 — 같은 주소(kimyounggaur.github.io)의 다른 앱 데이터는 건드리지 않는다.
   * 오류 화면의 '설정을 초기화하고 다시 시작'이 쓴다. 던지지 않는다.
   */
  clearAppSettings(): number;
}

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MAX_CORRUPT_ARCHIVES = 3;

/** 실제 브라우저의 localStorage. 접근하는 순간 던질 수 있다. 이 파일 밖에서는 `localStorage` 를 참조하지 않는다. */
export function browserBackend(): StorageBackend | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

/** 예외를 쓰기 실패의 이유로 분류한다. */
export function classifyStorageError(error: unknown): WriteFailureReason {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : '';
  const code = typeof record.code === 'number' ? record.code : undefined;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014 || /quota/i.test(message)) {
    return 'quota';
  }
  if (name === 'SecurityError' || code === 18 || /insecure|access is denied/i.test(message)) return 'blocked';
  return 'unknown';
}

/** 설정 초기화가 지키는 키인가: 사용자 프리셋(v2)과 그것을 가리키는 schema 키, 그리고 그 깨진 값 보관본(S2.4). */
function isKeptOnReset(name: string): boolean {
  return KEPT_ON_RESET_KEYS.some((key) => name === key || name.startsWith(`${key}${CORRUPT_KEY_INFIX}`));
}

/** 이 앱의 키인가: `guitar-pedalboard:` 로 시작하거나(앞으로 생길 키 포함), 접두사가 다른 기존 키(사용자 프리셋)와 그 깨진 값 보관본 */
function isAppKey(name: string): boolean {
  if (name.startsWith(APP_STORAGE_PREFIX)) return true;
  const known = Object.values(STORAGE_KEYS) as string[];
  return known.some((key) => name === key || name.startsWith(`${key}${CORRUPT_KEY_INFIX}`));
}

function defaultSubscribeToPageHide(flush: () => void): void {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flush);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
}

interface PendingWrite {
  timer: ReturnType<typeof setTimeout>;
  produce: () => unknown;
}

export function createSafeStorage(options: SafeStorageOptions = {}): SafeStorage {
  const getBackend = options.getBackend ?? browserBackend;
  const now = options.now ?? Date.now;
  const subscribeToPageHide = options.subscribeToPageHide ?? defaultSubscribeToPageHide;
  const maxCorruptArchives = options.maxCorruptArchives ?? DEFAULT_MAX_CORRUPT_ARCHIVES;

  /** 저장에 실패했거나 저장소를 못 쓸 때 값을 들고 있는 곳. null 은 '이번 방문 동안 지워짐'. */
  const overlay = new Map<string, string | null>();
  const pending = new Map<string, PendingWrite>();
  const notified = new Set<StorageNoticeKind>();
  let blocked = false;
  let hooksInstalled = false;

  function notifyOnce(kind: StorageNoticeKind): void {
    if (notified.has(kind)) return;
    notified.add(kind);
    try {
      options.notify?.(kind, STORAGE_NOTICE_MESSAGES[kind]);
    } catch {
      // 안내를 못 띄워도 저장 흐름은 계속된다.
    }
  }

  function markBlocked(): void {
    blocked = true;
    notifyOnce('blocked');
  }

  /** 저장소를 얻는다. 접근이 막혔으면 한 번 안내하고 이후에는 다시 시도하지 않는다. 저장소가 없는 환경이면 null(안내 없음). */
  function backend(): StorageBackend | null {
    if (blocked) return null;
    try {
      return getBackend() ?? null;
    } catch {
      markBlocked();
      return null;
    }
  }

  function writeRaw(key: string, raw: string): WriteResult {
    const target = backend();
    if (!target) {
      overlay.set(key, raw);
      return { ok: false, reason: 'blocked' };
    }
    try {
      target.setItem(key, raw);
      overlay.delete(key);
      return { ok: true };
    } catch (error) {
      overlay.set(key, raw);
      const reason = classifyStorageError(error);
      if (reason === 'blocked') markBlocked();
      else notifyOnce(reason);
      return { ok: false, reason };
    }
  }

  function cancelPending(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
  }

  function readRaw(key: string): string | null {
    if (overlay.has(key)) return overlay.get(key) ?? null;
    const target = backend();
    if (!target) return null;
    try {
      return target.getItem(key);
    } catch (error) {
      if (classifyStorageError(error) === 'blocked') markBlocked();
      return null;
    }
  }

  function removeKey(key: string): boolean {
    const target = backend();
    if (!target || typeof target.removeItem !== 'function') return false;
    try {
      target.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  /** 같은 키의 보관본 중 가장 새로운 `maxCorruptArchives` 개만 남긴다. */
  function pruneArchives(key: string): void {
    const target = backend();
    if (!target || typeof target.key !== 'function' || typeof target.length !== 'number') return;
    try {
      const prefix = `${key}${CORRUPT_KEY_INFIX}`;
      const archives: Array<{ name: string; stamp: number }> = [];
      for (let index = 0; index < target.length; index += 1) {
        const name = target.key(index);
        if (name && name.startsWith(prefix)) archives.push({ name, stamp: Number(name.slice(prefix.length)) || 0 });
      }
      archives.sort((left, right) => right.stamp - left.stamp);
      for (const stale of archives.slice(maxCorruptArchives)) removeKey(stale.name);
    } catch {
      // 정리에 실패해도 보관본이 조금 더 남을 뿐이다.
    }
  }

  /** 깨진 값을 보관하고(가능하면) 원래 키를 비운 뒤 안내한다. */
  function quarantine(key: string, raw: string, error: unknown): void {
    console.warn(`저장된 값(${key})을 읽지 못해 기본값을 사용합니다.`, error);
    const target = backend();
    if (target) {
      try {
        target.setItem(`${key}${CORRUPT_KEY_INFIX}${now()}`, raw);
        removeKey(key);
        pruneArchives(key);
      } catch {
        // 보관하지 못하면 원래 값을 그대로 둔다 — 지우면 되돌릴 길이 없다.
      }
    }
    notifyOnce('corrupt');
  }

  /** 밀려 있는 한 키의 저장을 지금 쓴다. 값을 만들다 던지면(직렬화 실패) 그 키는 건너뛴다. */
  function commitPending(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
    let raw: string | undefined;
    try {
      raw = JSON.stringify(entry.produce());
    } catch {
      raw = undefined;
    }
    if (raw !== undefined) writeRaw(key, raw);
  }

  function flush(): void {
    for (const key of [...pending.keys()]) commitPending(key);
  }

  function installHooks(): void {
    if (hooksInstalled) return;
    hooksInstalled = true;
    try {
      subscribeToPageHide(flush);
    } catch {
      // 훅을 걸지 못해도 타이머로는 저장된다.
    }
  }

  function getRaw(key: StorageKey): string | null {
    return readRaw(key);
  }

  function read<T>(key: StorageKey, parse: (raw: string) => T, fallback: T): T {
    const raw = readRaw(key);
    if (raw === null || raw === '') return fallback;
    try {
      return parse(raw);
    } catch (error) {
      quarantine(key, raw, error);
      return fallback;
    }
  }

  function get<T>(key: StorageKey, fallback: T, validate?: (value: unknown) => value is T): T {
    return read<T>(
      key,
      (raw) => {
        const value: unknown = JSON.parse(raw);
        if (validate && !validate(value)) throw new Error('저장된 값이 기대한 모양이 아닙니다.');
        return value as T;
      },
      fallback,
    );
  }

  function setRaw(key: StorageKey, raw: string): WriteResult {
    cancelPending(key);
    return writeRaw(key, raw);
  }

  function set(key: StorageKey, value: unknown): WriteResult {
    cancelPending(key);
    let raw: string | undefined;
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = undefined;
    }
    if (raw === undefined) return { ok: false, reason: 'unknown' };
    return writeRaw(key, raw);
  }

  function setDebounced(key: StorageKey, value: unknown | (() => unknown), ms: number = DEFAULT_DEBOUNCE_MS): void {
    cancelPending(key);
    installHooks();
    const produce = typeof value === 'function' ? (value as () => unknown) : () => value;
    const timer = setTimeout(() => commitPending(key), ms);
    // Node 시험이 이 타이머 때문에 끝나지 않는 일을 막는다. 브라우저의 숫자 타이머에는 unref 가 없다.
    (timer as unknown as { unref?: () => void }).unref?.();
    pending.set(key, { timer, produce });
  }

  function remove(key: StorageKey): void {
    cancelPending(key);
    if (removeKey(key)) overlay.delete(key);
    else overlay.set(key, null);
  }

  function usageBytes(): number {
    const target = backend();
    if (!target) return 0;
    try {
      const names = new Set<string>(Object.values(STORAGE_KEYS));
      if (typeof target.key === 'function' && typeof target.length === 'number') {
        for (let index = 0; index < target.length; index += 1) {
          const name = target.key(index);
          if (name && isAppKey(name)) names.add(name);
        }
      }
      let characters = 0;
      for (const name of names) {
        const value = target.getItem(name);
        if (value !== null) characters += name.length + value.length;
      }
      return characters * 2;
    } catch {
      return 0;
    }
  }

  function clearAppSettings(): number {
    // 지운 뒤에 밀려 있던 지연 저장이 되살아나지 않도록 먼저 취소한다.
    for (const key of [...pending.keys()]) cancelPending(key);

    const names = new Set<string>((Object.values(STORAGE_KEYS) as string[]).filter((name) => name.startsWith(APP_STORAGE_PREFIX) && !isKeptOnReset(name)));
    const target = backend();
    if (target && typeof target.key === 'function' && typeof target.length === 'number') {
      try {
        for (let index = 0; index < target.length; index += 1) {
          const name = target.key(index);
          if (name && name.startsWith(APP_STORAGE_PREFIX) && !isKeptOnReset(name)) names.add(name);
        }
      } catch {
        // 열거하지 못하면 알려진 키만 지운다.
      }
    }

    let removed = 0;
    for (const name of names) {
      let existed = false;
      try {
        existed = target?.getItem(name) != null;
      } catch {
        existed = false;
      }
      if (removeKey(name)) {
        overlay.delete(name);
        if (existed) removed += 1;
      } else {
        overlay.set(name, null);
      }
    }
    return removed;
  }

  return {
    get mode() {
      return backend() ? 'persistent' : 'memory';
    },
    getRaw,
    read,
    get,
    setRaw,
    set,
    setDebounced,
    flush,
    remove,
    usageBytes,
    clearAppSettings,
  };
}
