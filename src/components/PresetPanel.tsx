import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore, clonePedals } from '../store/pedalStore';
import {
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
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(values));
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
  const pedals = usePedalStore((state) => state.pedals);
  const setPedals = usePedalStore((state) => state.setPedals);
  const resetPedalOrder = usePedalStore((state) => state.resetPedalOrder);
  const adoptTempoFromPedals = useAudioStore((state) => state.adoptTempoFromPedals);
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
      { id: 'all', name: 'All Presets', description: '모든 팩토리/사용자 프리셋', count: presets.length },
      ...presetLibraries.map((library) => ({
        ...library,
        count: presets.filter((preset) => preset.libraryId === library.id).length,
      })),
      { id: 'user', name: 'My Presets', description: '직접 저장한 사용자 프리셋', count: userCount },
      { id: 'recent', name: 'Recent', description: '최근 불러온 프리셋', count: recentCount },
      { id: 'favorites', name: 'Favorites', description: '별표로 표시한 프리셋', count: favoriteCount },
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
    const nextPedals = clonePedals(preset.pedals);
    setPedals(nextPedals);
    adoptTempoFromPedals();
    AudioEngine.getInstance().rebuildChain();
    setName(preset.name);
    setActivePresetId(preset.id);
    rememberRecent(preset.id);
    setMessage(`${preset.name} loaded`);
  }, [adoptTempoFromPedals, rememberRecent, setPedals]);

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
    savePreset(name, pedals);
    setActiveLibraryId('user');
    setMessage('Preset saved');
  };

  const removePreset = useCallback((presetId: string) => {
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
  }, [deletePreset]);

  const reset = () => {
    resetPedalOrder();
    AudioEngine.getInstance().rebuildChain();
    setActivePresetId(null);
    setMessage('Default chain restored');
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
    setMessage('Preset JSON exported');
  };

  const importJsonText = () => {
    if (!presetJson.trim()) {
      importInputRef.current?.click();
      return;
    }

    try {
      const importedCount = importPresets(presetJson);
      setActiveLibraryId('user');
      setMessage(`${importedCount} presets imported`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preset import failed');
    }
  };

  const importJson = async (file: File) => {
    try {
      const importedCount = importPresets(await file.text());
      setActiveLibraryId('user');
      setMessage(`${importedCount} presets imported`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preset import failed');
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
            Library
          </button>
          <button type="button">Store</button>
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
          <div className="preset-tool-title">Preset Tools</div>
          <div className="preset-form">
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Preset name"
            />
            <button type="button" className="secondary-button" onClick={saveCurrentPreset}>
              Save
            </button>
          </div>
          <div className="preset-actions">
            <button type="button" className="secondary-button" onClick={exportJson}>
              Export
            </button>
            <button type="button" className="secondary-button" onClick={importJsonText}>
              Import
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
          <textarea
            value={presetJson}
            onChange={(event) => setPresetJson(event.currentTarget.value)}
            placeholder="Preset JSON"
            rows={4}
          />
        </div>

        <div className="preset-output">
          <div>
            <strong>Output</strong>
            <em>OK</em>
          </div>
          <label>
            <span>Peak</span>
            <i><b style={{ width: '46%' }} /></i>
          </label>
          <label>
            <span>RMS</span>
            <i><b style={{ width: '32%' }} /></i>
          </label>
        </div>
      </div>

      <div className="preset-browser-main">
        <div className="preset-browser-heading">
          <div>
            <p className="eyebrow">Presets</p>
            <h2>{activeLibrary.name}</h2>
          </div>
          <strong className="preset-sound-count">{visiblePresets.length} Sounds</strong>
        </div>

        <div className="preset-active-library">
          <strong>{activeLibrary.name}</strong>
          <span>{visiblePresets.length} Sounds</span>
        </div>

        <div className="preset-browser-toolbar">
          <label className="preset-search">
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search presets"
            />
          </label>
        </div>

        {message && <p className="preset-message">{message}</p>}

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
          Default Chain
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
          {preset.isFactory ? 'FACTORY' : 'USER'}
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
