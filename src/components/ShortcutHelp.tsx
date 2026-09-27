import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

interface ShortcutHelpProps {
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const shortcutItems = [
  { key: '1–9', description: '현재 순서의 N번째 페달 Bypass 전환' },
  { key: 'Space', description: '기타 입력 연결 또는 연결 해제' },
  { key: 'T', description: '탭 템포 입력' },
  { key: 'A / B', description: '저장된 프리셋 비교 슬롯 활성화' },
  { key: 'Esc', description: '긴급 정지 (도움말이 열려 있으면 도움말 닫기)' },
  { key: '?', description: '이 단축키 도움말 열기' },
] as const;

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
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
    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    const focusIsOutside = !dialog.contains(activeElement);

    if (event.shiftKey && (activeElement === firstElement || focusIsOutside)) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && (activeElement === lastElement || focusIsOutside)) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <div className="shortcut-help-backdrop">
      <section
        ref={dialogRef}
        className="shortcut-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        aria-describedby="shortcut-help-description"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="shortcut-help-header">
          <div>
            <p className="eyebrow">Keyboard</p>
            <h2 id="shortcut-help-title">키보드 단축키</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="shortcut-help-close"
            type="button"
            aria-label="키보드 단축키 도움말 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <p id="shortcut-help-description" className="shortcut-help-description">
          입력 중인 필드와 버튼·링크에 포커스가 있을 때는 전역 단축키가 실행되지 않습니다.
        </p>

        <dl className="shortcut-help-list">
          {shortcutItems.map((item) => (
            <div key={item.key}>
              <dt>
                <kbd>{item.key}</kbd>
              </dt>
              <dd>{item.description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
