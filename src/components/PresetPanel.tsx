import { useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { usePedalStore, clonePedals, initialPedals } from '../store/pedalStore';
import { presetLibraries, usePresetStore, type PresetListItem } from '../store/presetStore';

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
  const [activeLibraryId, setActiveLibraryId] = useState('all');
  const [query, setQuery] = useState('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readStringList(FAVORITES_KEY));
  const [recentIds, setRecentIds] = useState<string[]>(() => readStringList(RECENTS_KEY));
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pedals = usePedalStore((state) => state.pedals);
  const setPedals = usePedalStore((state) => state.setPedals);
  const resetPedalOrder = usePedalStore((state) => state.resetPedalOrder);
  const presets = usePresetStore((state) => state.presets);
  const savePreset = usePresetStore((state) => state.savePreset);
  const deletePreset = usePresetStore((state) => state.deletePreset);
  const exportPresets = usePresetStore((state) => state.exportPresets);
  const importPresets = usePresetStore((state) => state.importPresets);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const recentSet = useMemo(() => new Set(recentIds), [recentIds]);

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
  const normalizedQuery = normalizeText(query);

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

  const rememberRecent = (presetId: string) => {
    setRecentIds((currentIds) => {
      const nextIds = [presetId, ...currentIds.filter((id) => id !== presetId)].slice(0, 16);
      writeStringList(RECENTS_KEY, nextIds);
      return nextIds;
    });
  };

  const toggleFavorite = (presetId: string) => {
    setFavoriteIds((currentIds) => {
      const nextIds = currentIds.includes(presetId)
        ? currentIds.filter((id) => id !== presetId)
        : [presetId, ...currentIds].slice(0, 80);

      writeStringList(FAVORITES_KEY, nextIds);
      return nextIds;
    });
  };

  const loadPreset = (preset: PresetListItem) => {
    const nextPedals = clonePedals(preset.pedals);
    setPedals(nextPedals);
    void AudioEngine.getInstance().rebuildChain(nextPedals);
    setName(preset.name);
    setActivePresetId(preset.id);
    rememberRecent(preset.id);
    setMessage(`${preset.name} loaded`);
  };

  const saveCurrentPreset = () => {
    savePreset(name, pedals);
    setActiveLibraryId('user');
    setMessage('Preset saved');
  };

  const removePreset = (presetId: string) => {
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
  };

  const reset = () => {
    const nextPedals = clonePedals(initialPedals);
    resetPedalOrder();
    void AudioEngine.getInstance().rebuildChain(nextPedals);
    setActivePresetId(null);
    setMessage('Default chain restored');
  };

  const exportJson = () => {
    const blob = new Blob([exportPresets()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guitar-pedalboard-presets-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('Preset JSON exported');
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
      <div className="preset-library-column">
        <div className="panel-title">
          <p className="eyebrow">Library</p>
          <h2>라이브러리</h2>
        </div>
        <div className="preset-library-list" role="list">
          {libraryFilters.map((library) => (
            <button
              type="button"
              className={library.id === activeLibraryId ? 'is-active' : ''}
              key={library.id}
              onClick={() => setActiveLibraryId(library.id)}
            >
              <span>
                <strong>{library.name}</strong>
                <small>{library.description}</small>
              </span>
              <em>{library.count}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="preset-browser-main">
        <div className="preset-browser-heading">
          <div>
            <p className="eyebrow">Presets ({visiblePresets.length})</p>
            <h2>{activeLibrary.name}</h2>
          </div>
          <label className="preset-search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="tone, genre, effect..."
            />
          </label>
        </div>

        <div className="preset-browser-toolbar">
          <div className="preset-form">
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Preset name"
            />
            <button type="button" className="secondary-button" onClick={saveCurrentPreset}>
              저장
            </button>
          </div>

          <div className="preset-actions">
            <button type="button" className="secondary-button" onClick={exportJson}>
              JSON Export
            </button>
            <button type="button" className="secondary-button" onClick={() => importInputRef.current?.click()}>
              JSON Import
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
        </div>

        {message && <p className="preset-message">{message}</p>}

        <div className="preset-list" role="list" aria-label="프리셋 목록">
          {visiblePresets.length > 0 ? (
            visiblePresets.map((preset) => (
              <div className={`preset-item${preset.id === activePresetId ? ' is-active' : ''}`} key={preset.id}>
                <button type="button" className="preset-load-button" onClick={() => loadPreset(preset)}>
                  <strong>{preset.name}</strong>
                  <span>{preset.libraryName ?? (preset.isFactory ? 'Factory Preset' : 'My Presets')}</span>
                  {preset.description && <small>{preset.description}</small>}
                </button>
                <div className="preset-item-actions">
                  <button
                    type="button"
                    className={`icon-button favorite-button${favoriteSet.has(preset.id) ? ' is-active' : ''}`}
                    aria-label={`${preset.name} 즐겨찾기`}
                    onClick={() => toggleFavorite(preset.id)}
                  >
                    {favoriteSet.has(preset.id) ? '★' : '☆'}
                  </button>
                  {!preset.isFactory && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`${preset.name} 삭제`}
                      onClick={() => removePreset(preset.id)}
                    >
                      x
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="empty-copy preset-empty">조건에 맞는 프리셋이 없습니다.</p>
          )}
        </div>

        <button type="button" className="text-button preset-reset-button" onClick={reset}>
          기본 체인으로 재설정
        </button>
      </div>
    </section>
  );
}
