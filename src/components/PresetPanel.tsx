import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import type { PedalState } from '../audio/types';
import { formatTrimDb } from '../audio/offline/loudnessSpec';
import { safeStorage, STORAGE_KEYS, type StorageKey } from '../persistence';
import { clonePedals, usePedalStore } from '../store/pedalStore';
import { formatImportSummary, type ConflictResolution, type ImportPlan } from '../persistence/exportFormat';
import { idsAfter, reinsertId } from '../persistence/presetUndo';
import {
  captureChainSnapshot,
  isDefaultChain,
  resetToDefaultChain,
  restoreChainSnapshot,
} from '../store/chainActions';
import { showToast } from '../store/toastStore';
import {
  applyPresetPedals,
  presetLibraries,
  usePresetStore,
  type PresetComparisonSlot,
  type PresetListItem,
} from '../store/presetStore';
import { ImportConflictDialog, PasteImportDialog } from './PresetImportDialogs';
import { SameNamePresetDialog } from './PresetSaveDialog';

const FAVORITES_KEY = STORAGE_KEYS.presetFavorites;
const RECENTS_KEY = STORAGE_KEYS.presetRecents;
/** 삭제·기본 설정 되돌리기 토스트가 떠 있는 시간(설계서 S2.8: 8초) */
const UNDO_TOAST_MS = 8000;

type LibraryFilter = {
  id: string;
  name: string;
  description: string;
  count: number;
};

/** 문자열 목록(즐겨찾기·최근). 배열이 아니면 깨진 값으로 보고 SafeStorage 가 보관한 뒤 빈 목록을 쓴다. 문자열이 아닌 항목은 걸러 낸다. */
function readStringList(key: StorageKey): string[] {
  return safeStorage.read<string[]>(
    key,
    (raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('저장된 목록의 모양이 올바르지 않습니다.');
      return parsed.filter((item): item is string => typeof item === 'string');
    },
    [],
  );
}

function writeStringList(key: StorageKey, values: string[]): void {
  safeStorage.set(key, values);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function PresetPanel() {
  const [name, setName] = useState('Clean Practice');
  const [message, setMessage] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  /** 충돌을 하나씩 묻는 중인 가져오기. `resolutions` 는 지금까지 고른 것(충돌 순서대로). */
  const [pendingImport, setPendingImport] = useState<{ plan: ImportPlan; resolutions: ConflictResolution[] } | null>(null);
  /** 같은 이름이 있어 묻는 중인 저장. 누른 순간의 체인·음량 보정을 들고 있다(대화상자가 열린 사이에 바뀌어도 누른 때의 것을 저장한다). */
  const [pendingSave, setPendingSave] = useState<{ name: string; pedals: PedalState[]; trimDb: number } | null>(null);
  const [activeLibraryId, setActiveLibraryId] = useState('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readStringList(FAVORITES_KEY));
  const [recentIds, setRecentIds] = useState<string[]>(() => readStringList(RECENTS_KEY));
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const presetTrimDb = usePedalStore((state) => state.presetTrimDb);
  const setPresetTrimDb = usePedalStore((state) => state.setPresetTrimDb);
  const presets = usePresetStore((state) => state.presets);
  const savePreset = usePresetStore((state) => state.savePreset);
  const deletePreset = usePresetStore((state) => state.deletePreset);
  const restoreDeletedPreset = usePresetStore((state) => state.restoreDeletedPreset);
  const exportPresets = usePresetStore((state) => state.exportPresets);
  const planImport = usePresetStore((state) => state.planImport);
  const commitImport = usePresetStore((state) => state.commitImport);
  const slotA = usePresetStore((state) => state.slotA);
  const slotB = usePresetStore((state) => state.slotB);
  const activeSlot = usePresetStore((state) => state.activeSlot);
  const captureCurrentToSlot = usePresetStore((state) => state.captureCurrentToSlot);
  const activateSlot = usePresetStore((state) => state.activateSlot);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const recentSet = useMemo(() => new Set(recentIds), [recentIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const libraryFilters = useMemo<LibraryFilter[]>(() => {
    const userCount = presets.filter((preset) => !preset.isFactory).length;
    const recentCount = presets.filter((preset) => recentSet.has(preset.id)).length;
    const favoriteCount = presets.filter((preset) => favoriteSet.has(preset.id)).length;

    return [
      { id: 'all', name: '전체 프리셋', description: '모든 팩토리/사용자 프리셋', count: presets.length },
      ...presetLibraries.map((library) => ({
        ...library,
        count: presets.filter((preset) => preset.libraryId === library.id).length,
      })),
      { id: 'user', name: '내 프리셋', description: '직접 저장한 사용자 프리셋', count: userCount },
      { id: 'recent', name: '최근 사용', description: '최근 불러온 프리셋', count: recentCount },
      { id: 'favorites', name: '즐겨찾기', description: '별표로 표시한 프리셋', count: favoriteCount },
    ];
  }, [favoriteSet, presets, recentSet]);

  const activeLibrary = libraryFilters.find((library) => library.id === activeLibraryId) ?? libraryFilters[0];
  const normalizedQuery = useMemo(() => normalizeText(debouncedQuery), [debouncedQuery]);

  const visiblePresets = useMemo(() => {
    const filtered = presets.filter((preset) => {
      const matchesLibrary =
        activeLibraryId === 'all' ||
        (activeLibraryId === 'user' && !preset.isFactory) ||
        (activeLibraryId === 'recent' && recentSet.has(preset.id)) ||
        (activeLibraryId === 'favorites' && favoriteSet.has(preset.id)) ||
        preset.libraryId === activeLibraryId;

      if (!matchesLibrary) return false;
      if (!normalizedQuery) return true;

      const searchable = [
        preset.name,
        preset.libraryName ?? '',
        preset.description ?? '',
        ...(preset.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(normalizedQuery);
    });

    if (activeLibraryId !== 'recent') return filtered;
    return filtered.sort((left, right) => recentIds.indexOf(left.id) - recentIds.indexOf(right.id));
  }, [activeLibraryId, favoriteSet, normalizedQuery, presets, recentIds, recentSet]);

  const rememberRecent = useCallback((presetId: string) => {
    setRecentIds((currentIds) => {
      const nextIds = [presetId, ...currentIds.filter((id) => id !== presetId)].slice(0, 16);
      writeStringList(RECENTS_KEY, nextIds);
      return nextIds;
    });
  }, []);

  const toggleFavorite = useCallback((presetId: string) => {
    setFavoriteIds((currentIds) => {
      const nextIds = currentIds.includes(presetId)
        ? currentIds.filter((id) => id !== presetId)
        : [presetId, ...currentIds].slice(0, 80);

      writeStringList(FAVORITES_KEY, nextIds);
      return nextIds;
    });
  }, []);

  const loadPreset = useCallback((preset: PresetListItem) => {
    applyPresetPedals(preset.pedals, preset.trimDb);
    setName(preset.name);
    setActivePresetId(preset.id);
    rememberRecent(preset.id);
    setMessage(`${preset.name} 프리셋을 불러왔습니다.`);
  }, [rememberRecent]);

  const captureComparisonSlot = useCallback((slot: PresetComparisonSlot) => {
    captureCurrentToSlot(slot);
    setActivePresetId(null);
    setMessage(`${slot} 슬롯에 현재 체인을 저장했습니다.`);
  }, [captureCurrentToSlot]);

  const activateComparisonSlot = useCallback((slot: PresetComparisonSlot) => {
    if (!activateSlot(slot)) return;
    setActivePresetId(null);
    setMessage(`${slot} 슬롯을 활성화했습니다.`);
  }, [activateSlot]);

  const finishSave = () => {
    setActiveLibraryId('user');
    setMessage('프리셋을 저장했습니다.');
  };

  // 같은 이름이 있으면 스토어가 저장하지 않고 'exists' 를 돌려 준다(덮어쓰려면 `overwrite: true`). 그때 대화상자로 묻는다(S2.8).
  const saveCurrentPreset = () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setMessage('프리셋 이름을 입력해 주세요.'); return; }
    const trimDb = presetTrimDb;
    // 지금 보드는 저장하는 순간에 읽는다(구독하지 않는다 — 노브를 돌릴 때마다 이 패널이 다시 그려지지 않게, S4.3).
    const snapshot = clonePedals(usePedalStore.getState().pedals);
    if (savePreset(trimmedName, snapshot, trimDb) === 'exists') {
      setPendingSave({ name: trimmedName, pedals: snapshot, trimDb });
      return;
    }
    finishSave();
  };

  const overwritePendingSave = () => {
    if (!pendingSave) return;
    savePreset(pendingSave.name, pendingSave.pedals, pendingSave.trimDb, { overwrite: true });
    setPendingSave(null);
    finishSave();
  };

  const savePendingAs = (newName: string) => {
    if (!pendingSave) return;
    const result = savePreset(newName, pendingSave.pedals, pendingSave.trimDb);
    setPendingSave(null);
    if (result !== 'saved') {
      setMessage('같은 이름의 프리셋이 생겨 저장하지 못했습니다. 다시 저장해 주세요.');
      return;
    }
    setName(newName);
    finishSave();
  };

  // '음량 맞추기': 지금 체인에 기준 신호(REF-PC)를 4초 흘려 보내 평균 음량과 피크를 재고, 목표(−20 dBFS)에 맞는 보정값을 정한다.
  // 순간 피크가 커서 목표까지 올리면 리미터가 1 dB 넘게 눌러야 하면 거기서 멈춘다(GS-7).
  // 오프라인 렌더라 스피커로는 아무 소리도 나가지 않는다. 렌더 코드는 이 버튼을 누를 때만 불러온다.
  const matchLoudness = async () => {
    if (measuring) return;
    setMeasuring(true);
    setMessage('현재 체인의 음량을 재는 중입니다…');
    try {
      const { computeTrimForChain } = await import('../audio/offline/measureLoudness');
      const sampleRate = AudioEngine.getInstance().readLatency().sampleRate || 48000;
      const result = await computeTrimForChain(usePedalStore.getState().pedals, { sampleRate });
      if (!result.audible) {
        setMessage('소리가 거의 나오지 않아 음량을 맞출 수 없습니다. 노이즈 게이트와 볼륨 설정을 확인해 주세요.');
        return;
      }
      setPresetTrimDb(result.trimDb);
      setMessage(
        result.headroomLimited
          ? `음량 보정을 ${formatTrimDb(result.trimDb)} 로 맞췄습니다. 순간 소리가 커서 평균 ${result.resultRmsDb.toFixed(1)} dBFS 까지만 올렸습니다(리미터를 아끼려고 −20 dBFS 까지는 올리지 않았습니다). 프리셋으로 저장하면 이 값도 함께 저장됩니다.`
          : `음량 보정을 ${formatTrimDb(result.trimDb)} 로 맞췄습니다. 프리셋으로 저장하면 이 값도 함께 저장됩니다.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? `음량을 재지 못했습니다: ${error.message}` : '음량을 재지 못했습니다.');
    } finally {
      setMeasuring(false);
    }
  };

  /**
   * 즐겨찾기·최근 목록에서 `presetId` 를 빼고, 되돌릴 때 같은 자리에 넣을 기록을 돌려 준다(목록에 없었으면 null).
   * 저장소를 기준으로 읽고 쓴다 — 되돌리기는 토스트에서 불리므로 그때 이 패널이 사라져 있을 수 있다.
   */
  const takeOutOfList = useCallback((key: StorageKey, setIds: (ids: string[]) => void, presetId: string): string[] | null => {
    const ids = readStringList(key);
    if (!ids.includes(presetId)) return null;
    const following = idsAfter(ids, presetId);
    const next = ids.filter((id) => id !== presetId);
    writeStringList(key, next);
    setIds(next);
    return following;
  }, []);

  const putBackInList = useCallback((key: StorageKey, setIds: (ids: string[]) => void, presetId: string, following: string[] | null) => {
    if (following === null) return;
    const next = reinsertId(readStringList(key), presetId, following);
    writeStringList(key, next);
    setIds(next);
  }, []);

  // 내 프리셋 삭제: 확인을 묻지 않고 바로 지우고, 8초 동안 '실행 취소' 를 둔다(S2.8). 지움은 저장소에 바로 반영돼
  // 창을 닫아도 그대로이고, 되돌리기는 원래 자리에 다시 끼운다(즐겨찾기·최근 목록의 자리도 함께).
  const removePreset = useCallback((presetId: string) => {
    const deleted = deletePreset(presetId);
    if (!deleted) return;
    const favoriteFollowing = takeOutOfList(FAVORITES_KEY, setFavoriteIds, presetId);
    const recentFollowing = takeOutOfList(RECENTS_KEY, setRecentIds, presetId);

    showToast({
      message: `프리셋을 삭제했습니다: ${deleted.preset.name}`,
      kind: 'info',
      key: `preset-deleted:${presetId}`,
      durationMs: UNDO_TOAST_MS,
      action: {
        label: '실행 취소',
        onAction: () => {
          const result = restoreDeletedPreset(deleted);
          if (!result.restored || !result.preset) {
            showToast({ message: '되돌리지 못했습니다. 같은 프리셋이 이미 있습니다.', kind: 'warning', key: `preset-restore-failed:${presetId}` });
            return;
          }
          putBackInList(FAVORITES_KEY, setFavoriteIds, presetId, favoriteFollowing);
          putBackInList(RECENTS_KEY, setRecentIds, presetId, recentFollowing);
          setMessage(
            result.renamed
              ? `같은 이름의 프리셋이 있어 '${result.preset.name}' 이름으로 되돌렸습니다.`
              : `'${result.preset.name}' 프리셋을 되돌렸습니다.`,
          );
        },
      },
    });
  }, [deletePreset, putBackInList, restoreDeletedPreset, takeOutOfList]);

  // 기본 페달 설정: 확인을 묻지 않고 바로 되돌리고, 직전 상태(노브·켜짐·순서·음량 보정·불러 둔 IR)를 기억해 8초 동안 '실행 취소' 를 둔다(S2.8).
  const reset = () => {
    const before = captureChainSnapshot();
    if (isDefaultChain(before)) {
      setMessage('이미 기본 페달 설정입니다.');
      return;
    }
    const previousPresetId = activePresetId;
    resetToDefaultChain();
    setActivePresetId(null);
    setMessage('기본 페달 설정으로 되돌렸습니다.');
    showToast({
      message: '모든 노브를 처음 값으로 되돌렸습니다',
      kind: 'info',
      key: 'chain-reset',
      durationMs: UNDO_TOAST_MS,
      action: {
        label: '실행 취소',
        onAction: () => {
          const { cabinetIrsLost } = restoreChainSnapshot(before);
          setActivePresetId(previousPresetId);
          setMessage(
            cabinetIrsLost > 0
              ? `기본 페달 설정 전으로 되돌렸습니다. 불러 둔 IR 파일 ${cabinetIrsLost}개는 오디오를 다시 시작해서 사라졌으니 다시 불러와 주세요.`
              : '기본 페달 설정 전으로 되돌렸습니다.',
          );
        },
      },
    });
  };

  const exportJson = () => {
    // 파일로만 내보낸다. 내 프리셋이 없으면 빈 파일을 만들지 않는다(S2.7).
    const json = exportPresets();
    if (json === null) {
      setMessage('내보낼 내 프리셋이 없습니다.');
      return;
    }
    const count = presets.filter((preset) => !preset.isFactory).length;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guitar-pedalboard-presets-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`내 프리셋 ${count}개를 내보냈습니다.`);
  };

  const finishImport = (plan: ImportPlan, resolutions: readonly ConflictResolution[]) => {
    const result = commitImport(plan, resolutions);
    if (result.imported > 0) setActiveLibraryId('user');
    setMessage(formatImportSummary(result));
  };

  /** 가져올 글을 읽어 계획을 세운다. 충돌이 없으면 바로 저장하고, 있으면 하나씩 묻는다. 틀렸으면 메시지를 돌려 준다. */
  const startImport = (text: string): string | null => {
    try {
      const plan = planImport(text);
      if (plan.conflicts.length === 0) finishImport(plan, []);
      else setPendingImport({ plan, resolutions: [] });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '프리셋을 가져오지 못했습니다.';
    }
  };

  const importJson = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setMessage('파일을 읽지 못했습니다.');
      return;
    }
    const error = startImport(text);
    if (error) setMessage(error);
  };

  const submitPastedJson = (text: string): string | null => {
    const error = startImport(text);
    if (error === null) setPasteOpen(false);
    return error;
  };

  const resolveConflict = (resolution: ConflictResolution, applyToRest: boolean) => {
    if (!pendingImport) return;
    const { plan, resolutions } = pendingImport;
    const chosen = [...resolutions, resolution];
    const done = applyToRest || chosen.length >= plan.conflicts.length;
    if (!done) {
      setPendingImport({ plan, resolutions: chosen });
      return;
    }
    const all = plan.conflicts.map((_, index) => chosen[index] ?? resolution);
    setPendingImport(null);
    finishImport(plan, all);
  };

  const cancelImport = () => {
    setPendingImport(null);
    setMessage('가져오기를 취소했습니다.');
  };

  return (
    <section className="side-panel preset-panel preset-browser" aria-label="프리셋 브라우저">
      <div className="preset-ab-toolbar" role="group" aria-label="프리셋 A/B 비교">
        <div className="preset-ab-buttons" role="group" aria-label="A/B 슬롯 컨트롤">
          <button
            type="button"
            disabled={!slotA}
            aria-pressed={slotA !== null && activeSlot === 'A'}
            onClick={() => activateComparisonSlot('A')}
          >
            A
          </button>
          <button
            type="button"
            disabled={!slotB}
            aria-pressed={slotB !== null && activeSlot === 'B'}
            onClick={() => activateComparisonSlot('B')}
          >
            B
          </button>
          <button type="button" onClick={() => captureComparisonSlot('A')}>
            A←현재
          </button>
          <button type="button" onClick={() => captureComparisonSlot('B')}>
            B←현재
          </button>
        </div>
        <p role="status" aria-live="polite">
          {slotA || slotB
            ? `${activeSlot} 슬롯 활성 · A ${slotA ? '저장됨' : '비어 있음'} · B ${slotB ? '저장됨' : '비어 있음'}`
            : 'A/B 비교 슬롯이 비어 있습니다.'}
        </p>
      </div>
      <div className="preset-library-column">
        <div className="preset-tabs" role="group" aria-label="프리셋 라이브러리 탭">
          <button type="button" className="is-active">
            라이브러리
          </button>
          <em>{presets.length}</em>
        </div>

        <ul className="preset-library-list" aria-label="프리셋 라이브러리">
          {libraryFilters.map((library) => (
            <li key={library.id}>
              <button
                type="button"
                className={library.id === activeLibraryId ? 'is-active' : ''}
                onClick={() => setActiveLibraryId(library.id)}
              >
                <span>
                  <strong>{library.name}</strong>
                </span>
                <em>{library.count}</em>
              </button>
            </li>
          ))}
        </ul>

        <div className="preset-tools">
          <div className="preset-tool-title">프리셋 관리</div>
          <div className="preset-form">
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="프리셋 이름"
              aria-label="프리셋 이름"
            />
            <button type="button" className="secondary-button" onClick={saveCurrentPreset}>
              저장
            </button>
          </div>
          <div className="preset-loudness" role="group" aria-label="프리셋 음량 보정">
            <p className="preset-loudness-value" data-testid="preset-trim-value">
              음량 보정 <strong>{formatTrimDb(presetTrimDb)}</strong>
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void matchLoudness()}
              disabled={measuring}
              aria-busy={measuring}
              title="기준 신호로 현재 체인의 음량을 재서 −20 dBFS 에 맞춥니다"
            >
              {measuring ? '재는 중…' : '음량 맞추기'}
            </button>
          </div>
          <div className="preset-actions">
            <button type="button" className="secondary-button" onClick={exportJson}>
              내보내기
            </button>
            <button type="button" className="secondary-button" onClick={() => importInputRef.current?.click()}>
              파일 가져오기
            </button>
            <input
              ref={importInputRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importJson(file);
                event.currentTarget.value = '';
              }}
            />
          </div>
          <button type="button" className="secondary-button" onClick={() => setPasteOpen(true)}>텍스트로 붙여넣기</button>
          {pasteOpen ? <PasteImportDialog onSubmit={submitPastedJson} onClose={() => setPasteOpen(false)} /> : null}
          {pendingSave ? (
            <SameNamePresetDialog
              name={pendingSave.name}
              takenNames={new Set(presets.filter((preset) => !preset.isFactory).map((preset) => preset.name))}
              onOverwrite={overwritePendingSave}
              onSaveAs={savePendingAs}
              onCancel={() => setPendingSave(null)}
            />
          ) : null}
          {pendingImport ? (
            <ImportConflictDialog
              conflict={pendingImport.plan.conflicts[pendingImport.resolutions.length]}
              position={pendingImport.resolutions.length + 1}
              total={pendingImport.plan.conflicts.length}
              onResolve={resolveConflict}
              onCancel={cancelImport}
            />
          ) : null}
        </div>


      </div>

      <div className="preset-browser-main">
        <div className="preset-browser-heading">
          <div>
            <p className="eyebrow">프리셋</p>
            <h2>{activeLibrary.name}</h2>
          </div>
          <strong className="preset-sound-count">{visiblePresets.length}개</strong>
        </div>

        <div className="preset-active-library">
          <strong>{activeLibrary.name}</strong>
          <span>{visiblePresets.length}개</span>
        </div>

        <div className="preset-browser-toolbar">
          <label className="preset-search">
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="프리셋 검색"
              aria-label="프리셋 검색"
            />
          </label>
        </div>

        {message && <p role="status" className="preset-message">{message}</p>}

        {visiblePresets.length > 0 ? (
          <ul className="preset-list" aria-label="프리셋 목록">
            {visiblePresets.map((preset) => (
              <PresetItem
                key={preset.id}
                preset={preset}
                isActive={preset.id === activePresetId}
                isFavorite={favoriteSet.has(preset.id)}
                onLoad={loadPreset}
                onToggleFavorite={toggleFavorite}
                onDelete={removePreset}
              />
            ))}
          </ul>
        ) : (
          <p className="empty-copy preset-empty">조건에 맞는 프리셋이 없습니다.</p>
        )}
        <button type="button" className="text-button preset-reset-button" onClick={reset}>
          기본 페달 설정
        </button>
      </div>
    </section>
  );
}

interface PresetItemProps {
  preset: PresetListItem;
  isActive: boolean;
  isFavorite: boolean;
  onLoad: (preset: PresetListItem) => void;
  onToggleFavorite: (presetId: string) => void;
  onDelete: (presetId: string) => void;
}

const PresetItem = memo(function PresetItem({
  preset,
  isActive,
  isFavorite,
  onLoad,
  onToggleFavorite,
  onDelete,
}: PresetItemProps) {
  return (
    <li className={`preset-item${isActive ? ' is-active' : ''}`}>
      <button type="button" className="preset-load-button" onClick={() => onLoad(preset)}>
        <strong>{preset.name}</strong>
        <span>
          {(preset.tags?.[0] ?? preset.libraryName ?? 'preset').toUpperCase()} /{' '}
          {preset.isFactory ? '기본' : '사용자'}
        </span>
      </button>
      <div className="preset-item-actions">
        <button
          type="button"
          className={`icon-button favorite-button${isFavorite ? ' is-active' : ''}`}
          aria-label={`${preset.name} 즐겨찾기`}
          onClick={() => onToggleFavorite(preset.id)}
        >
          {isFavorite ? '★' : '☆'}
        </button>
        {!preset.isFactory && (
          <button
            type="button"
            className="icon-button"
            aria-label={`${preset.name} 삭제`}
            onClick={() => onDelete(preset.id)}
          >
            x
          </button>
        )}
      </div>
    </li>
  );
});
