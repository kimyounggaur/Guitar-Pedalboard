import { useRef, useState } from 'react';
import { uniqueNumberedName } from '../persistence/presetUndo';
import { ConfirmDialog } from './ConfirmDialog';

interface SameNamePresetDialogProps {
  /** 저장하려던 이름 */
  name: string;
  /** 지금 내 프리셋의 이름들. 새 이름이 겹치지 않는지 본다. */
  takenNames: ReadonlySet<string>;
  /** 기존 프리셋을 지금 체인으로 덮어쓴다 */
  onOverwrite: () => void;
  /** 고른 새 이름으로 따로 저장한다 */
  onSaveAs: (newName: string) => void;
  onCancel: () => void;
}

/**
 * 같은 이름으로 저장할 때 묻는다(S2.8): [덮어쓰기] [새 이름으로 저장] [취소].
 * 처음 포커스는 새 이름 칸이고 거기서 Enter 는 '새 이름으로 저장' 이다 — 열린 직후 Enter 한 번으로 기존 프리셋을 잃지 않게(L-142와 같은 규칙).
 * 새 이름은 '이름 (2)' 처럼 겹치지 않는 값을 제안하고 고칠 수 있다.
 */
export function SameNamePresetDialog({ name, takenNames, onOverwrite, onSaveAs, onCancel }: SameNamePresetDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [newName, setNewName] = useState(() => uniqueNumberedName(name, takenNames));
  const [error, setError] = useState<string | null>(null);

  const saveAs = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setError('새 이름을 입력해 주세요.');
      return;
    }
    if (takenNames.has(trimmed)) {
      setError('그 이름의 프리셋도 이미 있습니다. 다른 이름을 입력해 주세요.');
      return;
    }
    onSaveAs(trimmed);
  };

  return (
    <ConfirmDialog
      titleId="same-name-title"
      title="같은 이름의 프리셋이 있습니다"
      eyebrow="프리셋 저장"
      description={`'${name}' 이름의 프리셋이 이미 있습니다.`}
      hint="덮어쓰면 기존 프리셋의 내용이 지금 체인으로 바뀝니다(되돌릴 수 없습니다). 새 이름으로 저장하면 둘 다 남습니다."
      onCancel={onCancel}
      closeLabel="저장 취소"
      initialFocusRef={inputRef}
      actions={[
        { key: 'overwrite', label: '덮어쓰기', tone: 'danger', onSelect: onOverwrite },
        { key: 'save-as', label: '새 이름으로 저장', tone: 'primary', onSelect: saveAs },
        { key: 'cancel', label: '취소', onSelect: onCancel },
      ]}
    >
      <input
        ref={inputRef}
        className="modal-input"
        value={newName}
        aria-label="새 이름"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setNewName(event.currentTarget.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          saveAs();
        }}
      />
      {error ? <p className="modal-error" role="alert">{error}</p> : null}
    </ConfirmDialog>
  );
}
