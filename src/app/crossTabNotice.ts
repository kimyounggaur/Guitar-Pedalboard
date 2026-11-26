// 다른 탭에서 옛 버전 앱이 열려 있는 것을 알아챈다(S2.4, 설계서 4.7절 변환 절차 6 '여러 탭').
//
// v2 앱은 저장 형식을 옮긴 뒤 v1 키(`guitar-pedalboard:pedals`, `web-guitar-pedalboard-presets`)를 백업으로만 두고 다시 쓰지 않는다.
// 같은 주소에 옛 버전 탭이 열려 있으면 그 탭은 계속 v1 키에 쓰는데, v2 쪽은 그 키를 더는 읽지 않으므로 그 수정은 다음 시작 때 사라진 것처럼 보인다.
// 브라우저는 다른 탭이 저장소에 쓸 때 이 탭에 `storage` 이벤트를 보낸다. v1 키에 값이 쓰이면 닫고 새로고침하라고 한 번 알린다.
//
//   · 이 탭이 직접 쓴 값에는 이벤트가 오지 않는다(브라우저 규칙). 그래서 v2 키에 쓰는 이 앱의 저장은 경고를 일으키지 않는다.
//   · v1 키를 지우는 일(`newValue` 가 null)이나 저장소 전체 삭제(`key` 가 null)는 옛 탭이 저장한 것이 아니므로 무시한다.
//   · 옛 탭은 노브를 돌릴 때마다 쓴다. 연주 중에 같은 경고가 계속 끼어들지 않도록 한 번 띄운 뒤에는 일정 시간 다시 띄우지 않는다.
//   · 이 안내는 v2 모드로 열린 탭에서만 의미가 있다. 옛 방식(v1) 모드로 연 탭은 v1 키에 쓰는 것이 정상이다 — 설치 여부는 main.tsx 가 정한다.
import { STORAGE_KEYS } from '../persistence/keys';
import { ko } from '../i18n/ko';
import { showToast, type ToastInput } from '../store/toastStore';

export const OLD_VERSION_TAB_MESSAGE: string = ko.notice.oldVersionTab;
export const OLD_VERSION_TAB_TOAST_KEY = 'storage:old-version-tab';
/** 한 번 띄운 뒤 같은 안내를 다시 띄우지 않는 시간 */
export const OLD_VERSION_TAB_COOLDOWN_MS = 5 * 60 * 1000;

const OLD_VERSION_KEYS: readonly string[] = [STORAGE_KEYS.v1Pedals, STORAGE_KEYS.v1Presets];

/** 옛 버전 탭이 v1 키에 값을 쓴 것인가(지우기·전체 삭제는 아니다) */
export function isOldVersionWrite(event: Pick<StorageEvent, 'key' | 'newValue'>): boolean {
  return event.key !== null && OLD_VERSION_KEYS.includes(event.key) && event.newValue !== null;
}

export interface CrossTabNoticeOptions {
  /** 기본은 window. 시험은 가짜 이벤트 대상을 넘긴다. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  show?: (input: ToastInput) => unknown;
  now?: () => number;
  cooldownMs?: number;
}

/** `storage` 이벤트를 듣기 시작한다. 돌려주는 함수를 부르면 듣기를 멈춘다. */
export function installCrossTabNotice(options: CrossTabNoticeOptions = {}): () => void {
  const target = options.target ?? window;
  const show = options.show ?? showToast;
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? OLD_VERSION_TAB_COOLDOWN_MS;

  let lastShownAt: number | undefined;
  const onStorage = (event: StorageEvent): void => {
    if (!isOldVersionWrite(event)) return;
    const at = now();
    if (lastShownAt !== undefined && at - lastShownAt < cooldownMs) return;
    try {
      // 닫을 때까지 남는다: 연주 중에 놓쳐도 나중에 볼 수 있어야 한다.
      show({ message: OLD_VERSION_TAB_MESSAGE, kind: 'warning', key: OLD_VERSION_TAB_TOAST_KEY, durationMs: 0 });
      lastShownAt = at;
    } catch (error) {
      // 안내를 못 띄웠다고 오류 화면을 부르지 않는다. 띄우지 못했으니 다음 쓰기에서 다시 시도한다.
      console.warn('다른 탭 안내를 띄우지 못했습니다.', error);
    }
  };

  target.addEventListener('storage', onStorage);
  return () => target.removeEventListener('storage', onStorage);
}
