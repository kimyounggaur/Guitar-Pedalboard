// 오류 경계가 잡지 못하는 오류(이벤트 핸들러, 타이머, 비동기 코드)를 토스트로 알린다(S1.7, 설계서 4.8절).
// 앱을 멈추지 않는다: 알리기만 하고 소리는 건드리지 않는다. 같은 키의 토스트는 하나만 남아 오류가 몰려도 화면이 가득 차지 않는다.
import { showToast } from '../store/toastStore';
import { ko } from '../i18n/ko';
import { buildErrorReport, copyText } from './errorReport';

export const UNEXPECTED_ERROR_MESSAGE: string = ko.notice.unexpectedError;
export const UNEXPECTED_ERROR_TOAST_KEY = 'app:unexpected-error';

/** 브라우저가 레이아웃 계산 중에 내는 무해한 알림. 앱의 오류가 아니다. */
const BENIGN_MESSAGE = /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i;

/** 끊긴 재생·취소된 요청처럼 사용자에게 알릴 필요가 없는 취소 신호 */
function isAbort(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'AbortError';
}

export function reportUnexpectedError(error: unknown): void {
  try {
    console.error('예기치 못한 오류가 발생했습니다.', error);
    showToast({
      message: UNEXPECTED_ERROR_MESSAGE,
      kind: 'error',
      key: UNEXPECTED_ERROR_TOAST_KEY,
      action: { label: ko.notice.copyErrorInfo, onAction: () => void copyText(buildErrorReport(error)) },
    });
  } catch {
    // 오류를 알리다 생긴 오류가 또 오류를 부르면 안 된다.
  }
}

/** window 의 error·unhandledrejection 을 듣기 시작한다. 돌려주는 함수를 부르면 듣기를 멈춘다. */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent): void => {
    if (BENIGN_MESSAGE.test(event.message ?? '')) return;
    reportUnexpectedError(event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    if (isAbort(event.reason)) return;
    reportUnexpectedError(event.reason);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
