import { useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { usePedalStore, clonePedals, initialPedals } from '../store/pedalStore';
import { usePresetStore } from '../store/presetStore';

export function PresetPanel() {
  const [name, setName] = useState('Clean Practice');
  const [message, setMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pedals = usePedalStore((state) => state.pedals);
  const setPedals = usePedalStore((state) => state.setPedals);
  const resetPedalOrder = usePedalStore((state) => state.resetPedalOrder);
  const presets = usePresetStore((state) => state.presets);
  const savePreset = usePresetStore((state) => state.savePreset);
  const deletePreset = usePresetStore((state) => state.deletePreset);
  const exportPresets = usePresetStore((state) => state.exportPresets);
  const importPresets = usePresetStore((state) => state.importPresets);

  const loadPreset = (presetPedals: typeof pedals) => {
    const nextPedals = clonePedals(presetPedals);
    setPedals(nextPedals);
    void AudioEngine.getInstance().rebuildChain(nextPedals);
    setMessage('Preset loaded');
  };

  const saveCurrentPreset = () => {
    savePreset(name, pedals);
    setMessage('Preset saved');
  };

  const reset = () => {
    const nextPedals = clonePedals(initialPedals);
    resetPedalOrder();
    void AudioEngine.getInstance().rebuildChain(nextPedals);
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
      setMessage(`${importedCount} presets imported`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preset import failed');
    }
  };

  return (
    <section className="side-panel preset-panel">
      <div className="panel-title">
        <p className="eyebrow">Preset</p>
        <h2>프리셋</h2>
      </div>

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

      {message && <p className="preset-message">{message}</p>}

      <div className="preset-list">
        {presets.map((preset) => (
          <div className="preset-item" key={preset.id}>
            <button type="button" onClick={() => loadPreset(preset.pedals)}>
              <strong>{preset.name}</strong>
              <span>{preset.isFactory ? 'Default Preset' : new Date(preset.updatedAt).toLocaleDateString('ko-KR')}</span>
            </button>
            {!preset.isFactory && (
              <button
                type="button"
                className="icon-button"
                aria-label={`${preset.name} 삭제`}
                onClick={() => deletePreset(preset.id)}
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>

      <button type="button" className="text-button" onClick={reset}>
        기본 체인으로 재설정
      </button>
    </section>
  );
}
