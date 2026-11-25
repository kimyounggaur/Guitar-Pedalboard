import { useRef, type ReactNode, type RefObject } from 'react';
import { ModalDialog } from './ModalDialog';

export interface ConfirmDialogAction {
  /** 목록의 key */
  key: string;
  label: string;
  onSelect: () => void;
  /**
   * 'primary' 는 강조 버튼, 'danger' 는 되돌릴 수 없는 일(붉은 테두리), 없으면 보통 버튼.
   * 버튼의 순서는 `actions` 의 순서대로다.
   */
  tone?: 'primary' | 'danger';
  /** 열릴 때 처음 포커스를 받는다. 하나만 켠다. 어느 것도 켜지 않으면 `initialFocusRef`, 그것도 없으면 닫기(×) 버튼. */
  initialFocus?: boolean;
}

interface ConfirmDialogProps {
  titleId: string;
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  /** 설명 아래의 작은 글씨(되돌릴 수 없음 같은 주의) */
  hint?: ReactNode;
  /** 설명과 버튼 사이에 넣을 것(입력 칸 등). 그 안의 입력에 처음 포커스를 주려면 `initialFocusRef` 를 쓴다. */
  children?: ReactNode;
  actions: ConfirmDialogAction[];
  /** 닫기(×)·Esc 가 부른다. 보통 '취소' 와 같다. */
  onCancel: () => void;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * 확인 대화상자(S2.8). 공용 틀(`ModalDialog`) 위에 설명과 버튼 줄만 얹는다 — 포커스 가둠·Esc·포커스 복귀는 틀이 한다.
 * 파괴적인 선택(덮어쓰기)에는 처음 포커스를 주지 않는 것이 이 앱의 규칙이다(L-142): 열린 직후 Enter 한 번으로 무언가를 잃으면 안 된다.
 */
export function ConfirmDialog({
  titleId,
  title,
  eyebrow,
  description,
  hint,
  children,
  actions,
  onCancel,
  closeLabel = '닫기',
  initialFocusRef,
}: ConfirmDialogProps) {
  const focusedActionRef = useRef<HTMLButtonElement | null>(null);
  const hasFocusedAction = actions.some((action) => action.initialFocus);

  return (
    <ModalDialog
      titleId={titleId}
      title={title}
      eyebrow={eyebrow}
      onClose={onCancel}
      closeLabel={closeLabel}
      initialFocusRef={hasFocusedAction ? focusedActionRef : initialFocusRef}
    >
      {description ? <p className="modal-description">{description}</p> : null}
      {hint ? <p className="modal-hint">{hint}</p> : null}
      {children}
      <div className="modal-actions modal-actions-wrap">
        {actions.map((action) => (
          <button
            key={action.key}
            ref={action.initialFocus ? focusedActionRef : undefined}
            type="button"
            className={`${action.tone === 'primary' ? 'primary-button' : 'secondary-button'}${action.tone === 'danger' ? ' is-danger' : ''}`}
            onClick={action.onSelect}
          >
            {action.label}
          </button>
        ))}
      </div>
    </ModalDialog>
  );
}
