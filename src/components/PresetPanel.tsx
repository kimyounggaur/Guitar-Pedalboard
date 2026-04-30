import { useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { usePedalStore, clonePedals, initialPedals } from '../store/pedalStore';
import { usePresetStore } from '../store/presetStore';

export function PresetPanel() {
  const [name, setName] = useState('Clean Board');
  const pedals = usePedalStore((state) => state.pedals);
  const setPedals = usePedalStore((state) => state.setPedals);
  const resetPedalOrder = usePedalStore((state) => state.resetPedalOrder);
  const presets = usePresetStore((state) => state.presets);
  const savePreset = usePresetStore((state) => state.savePreset);
  const deletePreset = usePresetStore((state) => state.deletePreset);

  const loadPreset = (presetPedals: typeof pedals) => {
    const nextPedals = clonePedals(presetPedals);
    setPedals(nextPedals);
    void AudioEngine.getInstance().rebuildChain(nextPedals);
  };

  const reset = () => {
    const nextPedals = clonePedals(initialPedals);
    resetPedalOrder();
    void AudioEngine.getInstance().rebuildChain(nextPedals);
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
        <button type="button" className="secondary-button" onClick={() => savePreset(name, pedals)}>
          저장
        </button>
      </div>

      <div className="preset-list">
        {presets.length === 0 && <p className="empty-copy">저장된 프리셋이 없습니다.</p>}
        {presets.map((preset) => (
          <div className="preset-item" key={preset.id}>
            <button type="button" onClick={() => loadPreset(preset.pedals)}>
              <strong>{preset.name}</strong>
              <span>{new Date(preset.updatedAt).toLocaleDateString('ko-KR')}</span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${preset.name} 삭제`}
              onClick={() => deletePreset(preset.id)}
            >
              x
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="text-button" onClick={reset}>
        기본 체인으로 재설정
      </button>
    </section>
  );
}
