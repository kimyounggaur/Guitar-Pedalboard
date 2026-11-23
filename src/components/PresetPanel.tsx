import { notifyStorageFailure } from '../store/storageNotice';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { formatTrimDb } from '../audio/offline/loudnessSpec';
import { usePedalStore } from '../store/pedalStore';
import {
  applyPresetPedals,
  presetLibraries,
  usePresetStore,
  type PresetComparisonSlot,
  type PresetListItem,
} from '../store/presetStore';

const FAVORITES_KEY = 'guitar-pedalboard:preset-favorites';
const RECENTS_KEY = 'guitar-pedalboard:preset-recents';

type LibraryFilter = {
  id: string;
  name: string;
  description: string;
  count: number;
};

function canUseStorage(): boolean {
  try { return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'; } catch { return false; }
}

function readStringList(key: string): string[] {
  if (!canUseStorage()) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStringList(key: string, values: string[]): void {
  try {
    if (!canUseStorage()) throw new Error('Storage unavailable');
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch { notifyStorageFailure(); }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function PresetPanel() {
  const [name, setName] = useState('Clean Practice');
  const [message, setMessage] = useState<string | null>(null);
  const [presetJson, setPresetJson] = useState('');
  const [activeLibraryId, setActiveLibraryId] = useState('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readStringList(FAVORITES_KEY));
  const [recentIds, setRecentIds] = useState<string[]>(() => readStringList(RECENTS_KEY));
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const pedals = usePedalStore((state) => state.pedals);
  const presetTrimDb = usePedalStore((state) => state.presetTrimDb);
  const setPresetTrimDb = usePedalStore((state) => state.setPresetTrimDb);
  const resetPedalOrder = usePedalStore((state) => state.resetPedalOrder);
  const presets = usePresetStore((state) => state.presets);
  const savePreset = usePresetStore((state) => state.savePreset);
  const deletePreset = usePresetStore((state) => state.deletePreset);
  const exportPresets = usePresetStore((state) => state.exportPresets);
  const importPresets = usePresetStore((state) => state.importPresets);
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

  const saveCurrentPreset = () => {
    if (!name.trim()) { setMessage('프리셋 이름을 입력해 주세요.'); return; }
    if (presets.some((preset) => !preset.isFactory && preset.name === name.trim()) && !window.confirm('같은 이름의 프리셋이 있습니다. 덮어쓰시겠습니까?')) return;
    savePreset(name, pedals);
    setActiveLibraryId('user');
    setMessage('프리셋을 저장했습니다.');
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

  const removePreset = useCallback((presetId: string) => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset || !window.confirm(`'${preset.name}' 프리셋을 삭제하시겠습니까?`)) return;
    deletePreset(presetId);
    setFavoriteIds((currentIds) => {
      const nextIds = currentIds.filter((id) => id !== presetId);
      writeStringList(FAVORITES_KEY, nextIds);
      return nextIds;
    });
    setRecentIds((currentIds) => {
      const nextIds = currentIds.filter((id) => id !== presetId);
      writeStringList(RECENTS_KEY, nextIds);
      return nextIds;
    });
  }, [deletePreset, presets]);

  const reset = () => {
    if (!window.confirm('모든 페달 설정을 기본값으로 되돌리시겠습니까?')) return;
    AudioEngine.getInstance().clearAllCabinetIrs();
    resetPedalOrder();
    AudioEngine.getInstance().rebuildChain();
    setActivePresetId(null);
    setMessage('기본 페달 설정으로 되돌렸습니다.');
  };

  const exportJson = () => {
    const json = exportPresets();
    setPresetJson(json);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guitar-pedalboard-presets-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('내 프리셋을 내보냈습니다.');
  };

  const importJsonText = () => {
    if (!presetJson.trim()) { setMessage('가져올 JSON을 붙여 넣어 주세요.'); return; }

    try {
      const importedCount = importPresets(presetJson);
      setActiveLibraryId('user');
      setMessage(`${importedCount}개의 프리셋을 가져왔습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '프리셋을 가져오지 못했습니다.');
    }
  };

  const importJson = async (file: File) => {
    try {
      const importedCount = importPresets(await file.text());
      setActiveLibraryId('user');
      setMessage(`${importedCount}개의 프리셋을 가져왔습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '프리셋을 가져오지 못했습니다.');
    }
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
          <button type="button" className="secondary-button" onClick={importJsonText}>붙여넣은 JSON 가져오기</button>
          <textarea
            value={presetJson}
            onChange={(event) => setPresetJson(event.currentTarget.value)}
            placeholder="프리셋 JSON 붙여넣기"
            aria-label="가져올 프리셋 JSON"
            rows={4}
          />
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
