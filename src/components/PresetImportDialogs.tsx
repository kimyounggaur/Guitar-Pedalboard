import { useRef, useState } from 'react';
import type { ConflictResolution, ImportConflict } from '../persistence/exportFormat';
import { ModalDialog } from './ModalDialog';

interface PasteImportDialogProps {
  /** 붙여넣은 글을 가져온다. 틀렸으면 화면에 보일 메시지를 돌려 주고(대화상자는 열어 둔다), 잘 처리했으면 null. */
  onSubmit: (text: string) => string | null;
  onClose: () => void;
}

/** '텍스트로 붙여넣기'(S2.7): 파일 선택 창 대신 JSON 글을 직접 붙여 넣어 가져온다. */
export function PasteImportDialog({ onSubmit, onClose }: PasteImportDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!text.trim()) {
      setError('가져올 JSON을 붙여 넣어 주세요.');
      return;
    }
    setError(onSubmit(text));
  };

  return (
    <ModalDialog
      titleId="paste-import-title"
      title="텍스트로 붙여넣기"
      eyebrow="프리셋 가져오기"
      onClose={onClose}
      closeLabel="붙여넣기 창 닫기"
      initialFocusRef={textareaRef}
    >
      <p className="modal-description">내보낸 프리셋 파일의 내용을 붙여 넣으세요. 예전 형식 파일도 받습니다.</p>
      <textarea
        ref={textareaRef}
        className="modal-textarea"
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setError(null);
        }}
        placeholder="프리셋 JSON 붙여넣기"
        aria-label="가져올 프리셋 JSON"
        rows={8}
      />
      {error ? <p className="modal-error" role="alert">{error}</p> : null}
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>취소</button>
        <button type="button" className="primary-button" onClick={submit}>가져오기</button>
      </div>
    </ModalDialog>
  );
}

interface ImportConflictDialogProps {
  conflict: ImportConflict;
  /** 몇 번째 충돌인지(1부터)와 전체 수 */
  position: number;
  total: number;
  /** `applyToRest` 가 true 면 남은 충돌 모두에 같은 선택을 적용한다. */
  onResolve: (resolution: ConflictResolution, applyToRest: boolean) => void;
  /** 가져오기 전체를 취소한다(아무것도 저장하지 않는다). */
  onCancel: () => void;
}

/**
 * 같은 프리셋이 이미 있고 내용이 다를 때 묻는다(설계서 4.7절): 덮어쓰기 / 사본으로 추가 / 건너뛰기.
 * 처음 포커스는 아무것도 잃지 않는 '사본으로 추가' 에 둔다 — 파일을 고르고 반사적으로 Enter 를 눌러도 기존 프리셋이 바뀌지 않게(L-142).
 */
export function ImportConflictDialog({ conflict, position, total, onResolve, onCancel }: ImportConflictDialogProps) {
  const copyRef = useRef<HTMLButtonElement | null>(null);
  const [applyToRest, setApplyToRest] = useState(false);
  const remaining = total - position;

  return (
    <ModalDialog
      titleId="import-conflict-title"
      title="같은 프리셋이 이미 있습니다"
      eyebrow={`프리셋 가져오기 · ${position}/${total}`}
      onClose={onCancel}
      closeLabel="가져오기 취소"
      initialFocusRef={copyRef}
    >
      <p className="modal-description">
        {conflict.reason === 'id'
          ? `파일의 '${conflict.incoming.name}'은(는) 이미 가진 프리셋과 같은 프리셋(같은 id)이지만 내용이 다릅니다.`
          : `'${conflict.incoming.name}' 이름의 프리셋이 이미 있고 내용이 다릅니다.`}
      </p>
      <p className="modal-hint">덮어쓰면 기존 프리셋의 내용이 파일의 내용으로 바뀝니다(되돌릴 수 없습니다). 사본으로 추가하면 둘 다 남습니다.</p>
      {remaining > 0 ? (
        <label className="modal-check">
          <input type="checkbox" checked={applyToRest} onChange={(event) => setApplyToRest(event.currentTarget.checked)} />
          남은 {remaining}개에도 같은 선택 적용
        </label>
      ) : null}
      <div className="modal-actions modal-actions-wrap">
        <button type="button" className="secondary-button" onClick={() => onResolve('overwrite', applyToRest)}>덮어쓰기</button>
        <button ref={copyRef} type="button" className="primary-button" onClick={() => onResolve('copy', applyToRest)}>사본으로 추가</button>
        <button type="button" className="secondary-button" onClick={() => onResolve('skip', applyToRest)}>건너뛰기</button>
        <button type="button" className="secondary-button" onClick={onCancel}>가져오기 취소</button>
      </div>
    </ModalDialog>
  );
}
