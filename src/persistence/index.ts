// 앱 전체가 함께 쓰는 하나의 저장소. 저장 문제는 종류마다 한 번만 토스트로 알린다(S1.7).
// 이 파일만 토스트(zustand)에 기댄다 — SafeStorage.ts 자체는 React·zustand 와 무관하게 시험된다.
import { showToast } from '../store/toastStore';
import { createSafeStorage } from './SafeStorage';

export { STORAGE_KEYS, APP_STORAGE_PREFIX, CORRUPT_KEY_INFIX, KEPT_ON_RESET_KEYS, type StorageKey } from './keys';
export { STORAGE_NOTICE_MESSAGES, createSafeStorage } from './SafeStorage';
export type { SafeStorage, StorageNoticeKind, WriteResult } from './SafeStorage';

export const safeStorage = createSafeStorage({
  notify: (kind, message) => showToast({ message, kind: 'warning', key: `storage:${kind}` }),
});
