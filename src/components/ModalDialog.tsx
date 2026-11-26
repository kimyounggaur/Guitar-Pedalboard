import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ModalDialogProps {
  /** 제목 요소의 id. `aria-labelledby` 가 가리킨다. */
  titleId: string;
  title: string;
  eyebrow?: string;
  /** 닫기(×)·Esc 가 부르는 함수 */
  onClose: () => void;
  closeLabel: string;
  /** 열릴 때 포커스를 줄 곳. 없으면 닫기 버튼. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * 가져오기 대화상자(S2.7)와 확인 대화상자(`ConfirmDialog`, S2.8)가 함께 쓰는 틀. 도움말 대화상자(`ShortcutHelp`)와 같은 규칙을 따른다 —
 * 포커스를 안에 가두고, 닫으면 열기 전 자리로 돌려주며, Esc 는 이 대화상자만 닫는다(긴급 정지로 새지 않는다).
 * 화면 맨 위에 그리려고 `document.body` 에 포털로 붙인다(패널의 변형·가림에 영향받지 않게).
 */
export function ModalDialog({ titleId, title, eyebrow, onClose, closeLabel, initialFocusRef, children }: ModalDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? closeButtonRef.current)?.focus();

    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    // 열릴 때 한 번만 포커스를 옮긴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.key === 'Escape' &&
      !event.repeat &&
      !event.nativeEvent.isComposing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const focusIsOutside = !dialog.contains(active);

    if (event.shiftKey && (active === first || focusIsOutside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || focusIsOutside)) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="modal-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" type="button" aria-label={closeLabel} onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
