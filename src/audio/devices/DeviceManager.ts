// 입력·출력 장치를 다루는 규칙(설계서 4.4 DeviceManager, S2.13). 브라우저 API·화면 저장소에 기대지 않는 순수 함수라 Node 에서 모든 경우를 시험한다.
//   - 마이크 권한을 받기 전에는 `enumerateDevices()` 가 장치마다 `deviceId`·`label` 을 비워서 준다. 그 목록으로는 '이 장치가 없다'고 말할 수 없다.
//   - 기억해 둔 장치는 id 로 찾고, 없으면 label 로 찾고, 그래도 없으면 기본 장치로 간다. id 는 브라우저가 사이트 데이터를 지우면 바뀐다.
//   - 연주 중에 고른 입력 장치가 목록에서 사라지면 세션을 끝낸다('device-lost').

/** `MediaDeviceInfo` 중 여기서 쓰는 부분 */
export interface DeviceLike {
  deviceId: string;
  label: string;
}

/** 저장해 두는 장치. label 은 id 가 바뀌었을 때 다시 찾는 데 쓰고, 목록에 없을 때 이름을 보여 주는 데도 쓴다 */
export interface RememberedDevice {
  id: string;
  label: string;
}

/** 목록이 장치를 구별할 만큼 채워져 있는가. 권한 전에는 deviceId 가 빈 항목이 섞여 있다(빈 목록은 '장치 없음'으로 확실하다). */
export function isListIdentified(list: readonly DeviceLike[]): boolean {
  return list.every((device) => device.deviceId !== '');
}

export function isDeviceListed(list: readonly DeviceLike[], deviceId: string): boolean {
  return list.some((device) => device.deviceId === deviceId);
}

/** 목록에서 id 의 이름을 찾는다. 없거나 비어 있으면 빈 문자열 */
export function labelOf(list: readonly DeviceLike[], deviceId: string): string {
  return list.find((device) => device.deviceId === deviceId)?.label ?? '';
}

export function makeRemembered(list: readonly DeviceLike[], deviceId: string, fallbackLabel = ''): RememberedDevice | null {
  if (!deviceId) return null;
  return { id: deviceId, label: labelOf(list, deviceId) || fallbackLabel };
}

export type RememberedResolution =
  /** 기억한 장치가 없다(기본 장치를 쓴다) */
  | { kind: 'none' }
  /** 목록이 아직 장치를 구별하지 못한다(권한 전). 기억한 id 를 그대로 쓰고 연결할 때 확인한다 */
  | { kind: 'unknown' }
  | { kind: 'found'; id: string; label: string; by: 'id' | 'label' }
  /** 목록은 확실한데 id 도 label 도 없다 */
  | { kind: 'missing' };

export function resolveRememberedDevice(list: readonly DeviceLike[], remembered: RememberedDevice | null): RememberedResolution {
  if (!remembered || !remembered.id) return { kind: 'none' };
  if (!isListIdentified(list)) return { kind: 'unknown' };

  const byId = list.find((device) => device.deviceId === remembered.id);
  if (byId) return { kind: 'found', id: byId.deviceId, label: byId.label || remembered.label, by: 'id' };

  // 이름이 비어 있는 것끼리 같다고 하면 아무 장치나 고르게 된다.
  if (remembered.label) {
    const byLabel = list.find((device) => device.label === remembered.label);
    if (byLabel) return { kind: 'found', id: byLabel.deviceId, label: byLabel.label, by: 'label' };
  }
  return { kind: 'missing' };
}

export interface InputReconcileArgs {
  list: readonly DeviceLike[];
  /** 지금 고른 입력 장치 id. 빈 문자열이면 기본 장치 */
  selectedDeviceId: string;
  /** 마지막으로 사용자가 직접 고른 장치(없으면 null) */
  remembered: RememberedDevice | null;
  /** 장치로 연결해서 소리를 내는 중인가 */
  running: boolean;
  /**
   * 기억해 둔 장치가 방금 목록에 다시 나타났는가(직전 목록에는 없었고 지금은 있다).
   * 이때만 기본 장치를 쓰던 선택을 기억한 장치로 되돌린다. 목록에 계속 있었는데 선택이 기본 장치로 돌아와 있다면
   * 연결 단계에서 그 장치를 열지 못해 내린 결정이므로 장치를 다시 꽂기 전에는 뒤집지 않는다.
   */
  reappeared: boolean;
}

export interface InputReconcileResult {
  selectedDeviceId: string;
  remembered: RememberedDevice | null;
  /** 연주 중에 고른 장치가 사라졌다 → 세션을 끝낸다 */
  lost: boolean;
}

/**
 * 장치 목록이 바뀌었을 때(또는 처음 읽었을 때) 선택을 맞춘다.
 *  - 목록이 장치를 구별하지 못하면(권한 전) 아무것도 바꾸지 않는다.
 *  - 고른 장치가 목록에 있으면 그대로. 없고 연주 중이면 분실. 없고 연주 중이 아니면 같은 이름의 장치로 갈아타고, 그것도 없으면 기본 장치로 둔다.
 *    기억해 둔 장치는 지우지 않는다 — 꽂는 순간 다시 고르기 위해서다.
 *  - 기본 장치를 쓰는 중이고 연주 중이 아닐 때 기억해 둔 장치가 목록에 다시 나타나면(`reappeared`) 그 장치를 다시 고른다.
 */
export function reconcileInputSelection(args: InputReconcileArgs): InputReconcileResult {
  const { list, selectedDeviceId, remembered, running, reappeared } = args;
  const unchanged: InputReconcileResult = { selectedDeviceId, remembered, lost: false };
  if (!isListIdentified(list)) return unchanged;

  if (selectedDeviceId) {
    if (isDeviceListed(list, selectedDeviceId)) {
      // 기억해 둔 id 와 같은 장치면 이름이 달라졌을 수 있으니 최신 이름으로 맞춘다.
      if (remembered && remembered.id === selectedDeviceId) {
        const label = labelOf(list, selectedDeviceId);
        if (label && label !== remembered.label) return { ...unchanged, remembered: { id: selectedDeviceId, label } };
      }
      return unchanged;
    }
    if (running) return { selectedDeviceId: '', remembered, lost: true };

    const resolved = resolveRememberedDevice(list, remembered && remembered.id === selectedDeviceId ? remembered : null);
    if (resolved.kind === 'found') {
      return { selectedDeviceId: resolved.id, remembered: { id: resolved.id, label: resolved.label }, lost: false };
    }
    return { selectedDeviceId: '', remembered, lost: false };
  }

  if (!running && reappeared) {
    const resolved = resolveRememberedDevice(list, remembered);
    if (resolved.kind === 'found') {
      return { selectedDeviceId: resolved.id, remembered: { id: resolved.id, label: resolved.label }, lost: false };
    }
  }
  return unchanged;
}

/**
 * 기억해 둔 장치가 지금 목록에 있는가. 있으면 true, 없으면 false, 판단할 수 없으면(기억한 장치가 없거나 목록이 권한 전이라 비어 있음) null.
 * 직전 값과 견주어 '다시 나타났다'(false → true)를 알아내는 데 쓴다.
 */
export function rememberedPresence(list: readonly DeviceLike[], remembered: RememberedDevice | null): boolean | null {
  const resolved = resolveRememberedDevice(list, remembered);
  if (resolved.kind === 'found') return true;
  if (resolved.kind === 'missing') return false;
  return null;
}

/**
 * 연결할 때 '저장된 장치를 찾지 못해 기본 장치로 연결했습니다' 안내를 띄워야 하는가: 기본 장치를 쓰는데(선택이 비어 있다)
 * 기억해 둔 장치가 목록에 확실히 없고, 그 장치에 대해 이미 알린 적이 없을 때. 같은 장치에 대해서는 한 번만 알린다.
 */
export function shouldAnnounceMissing(
  list: readonly DeviceLike[],
  remembered: RememberedDevice | null,
  selectedDeviceId: string,
  announcedId: string | null,
): boolean {
  if (selectedDeviceId !== '' || !remembered) return false;
  if (announcedId === remembered.id) return false;
  return resolveRememberedDevice(list, remembered).kind === 'missing';
}

/** `devicechange` 를 받는 쪽(`navigator.mediaDevices`) 중 여기서 쓰는 부분 */
export interface DeviceChangeTarget {
  addEventListener(type: 'devicechange', listener: () => void): void;
  removeEventListener(type: 'devicechange', listener: () => void): void;
}

export interface WatchOptions {
  /** 이벤트가 연달아 올 때 마지막 것 하나만 처리하려고 기다리는 시간(ms). 장치를 하나 꽂으면 브라우저가 여러 번 보내기도 한다 */
  delayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const DEVICE_CHANGE_DELAY_MS = 120;

/** `devicechange` 를 지켜보다가 연달아 온 것을 하나로 묶어 `onChange` 를 부른다. 돌려주는 함수가 감시를 끝낸다. */
export function watchDeviceChanges(
  target: DeviceChangeTarget | null | undefined,
  onChange: () => void,
  options: WatchOptions = {},
): () => void {
  if (!target?.addEventListener) return () => undefined;

  const delayMs = options.delayMs ?? DEVICE_CHANGE_DELAY_MS;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let pending: unknown = null;

  const handle = () => {
    if (pending !== null) clearTimer(pending);
    pending = setTimer(() => {
      pending = null;
      onChange();
    }, delayMs);
  };
  target.addEventListener('devicechange', handle);

  return () => {
    target.removeEventListener('devicechange', handle);
    if (pending !== null) clearTimer(pending);
    pending = null;
  };
}

/** 저장된 값을 장치로 읽는다. 모양이 틀리면 null */
export function parseRememberedDevice(value: unknown): RememberedDevice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, label } = value as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return null;
  return { id, label: typeof label === 'string' ? label.slice(0, 200) : '' };
}

/**
 * 저장된 출력 장치를 고른다. 예전 빌드는 출력 장치 id 만 문자열 그대로 따로 저장했고(`legacyRaw`, 시스템 기본 출력이면 빈 문자열, 한 번도 안 골랐으면 null),
 * 지금은 id·이름을 입출력 설정(`fromIo`)에 함께 저장하면서 예전 키도 같은 값으로 계속 쓴다. 두 값이 어긋나면 옛 빌드로 돌아가 다시 고른 것이므로 예전 키를 따른다.
 */
export function chooseRememberedOutput(fromIo: RememberedDevice | null, legacyRaw: string | null): RememberedDevice | null {
  if (legacyRaw === null) return fromIo;
  if (legacyRaw === (fromIo?.id ?? '')) return fromIo;
  return legacyRaw === '' ? null : { id: legacyRaw, label: '' };
}
