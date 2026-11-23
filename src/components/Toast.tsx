import { useToastStore } from '../store/toastStore';

/**
 * 토스트를 그리는 자리. 경고·오류는 role="alert"(바로 읽힘), 나머지는 role="status"(차분히 읽힘).
 * 닫기 버튼은 키보드로 갈 수 있다. 영역 자체는 클릭을 가로막지 않고 토스트 카드만 클릭을 받는다.
 */
export function ToastRegion() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div className="toast-region" role="region" aria-label="알림">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === 'warning' || toast.kind === 'error' ? 'alert' : 'status'}
          data-toast-kind={toast.kind}
          data-toast-key={toast.key}
        >
          <span className="toast-message">{toast.message}</span>
          <button type="button" className="toast-close" onClick={() => dismiss(toast.id)}>
            닫기
          </button>
        </div>
      ))}
    </div>
  );
}
