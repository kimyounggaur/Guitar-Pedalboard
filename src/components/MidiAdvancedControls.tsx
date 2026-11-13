import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { MIDI_ADVANCED_KEY, dispatchAdvancedMessage, parseAdvancedMessage, readMidiAdvanced, validateMidiAdvanced, type MidiAdvancedConfig } from '../audio/midiAdvanced';
import { registerMidiAdvancedHandler, useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';
import { applyPresetPedals, usePresetStore } from '../store/presetStore';
import { notifyStorageFailure } from '../store/storageNotice';

export function MidiAdvancedControls() {
  const [config, setConfig] = useState(readMidiAdvanced);
  const configRef = useRef(config);
  const [program, setProgram] = useState(0);
  const [presetId, setPresetId] = useState('');
  const [notice, setNotice] = useState('');
  const presets = usePresetStore((state) => state.presets);
  const mappings = useAudioStore((state) => state.midiMappings);
  const supported = useAudioStore((state) => state.midiSupported);
  const error = useAudioStore((state) => state.midiError);

  const save = (next: MidiAdvancedConfig) => {
    const checked = validateMidiAdvanced(next);
    const collision = Object.values(mappings).some((mapping) => mapping.channel === checked.channel && 'cc' in mapping && (mapping.cc === checked.volumeCc || mapping.cc === checked.wahCc));
    if (collision) { setNotice('선택한 채널과 CC가 페달 MIDI 스위치와 겹칩니다. 다른 CC를 선택하세요.'); return; }
    if (next.volumeCc !== null && next.volumeCc === next.wahCc) { setNotice('볼륨과 와우에는 서로 다른 CC를 지정하세요.'); return; }
    setNotice('설정을 저장했습니다.');
    configRef.current = checked;
    setConfig(checked);
    try { localStorage.setItem(MIDI_ADVANCED_KEY, JSON.stringify(checked)); } catch { notifyStorageFailure(); }
    if (checked.volumeCc !== null || checked.wahCc !== null || Object.keys(checked.programs).length) void useAudioStore.getState().connectSavedMidi(true);
  };

  useEffect(() => {
    const match = (data: Uint8Array) => Boolean(parseAdvancedMessage(data, configRef.current));
    let volumeSaveTimer: ReturnType<typeof setTimeout> | undefined;
    const handle = (data: Uint8Array) => dispatchAdvancedMessage(data, configRef.current, {
      program: (id) => {
        const preset = usePresetStore.getState().presets.find((item) => item.id === id);
        if (!preset) { setNotice('지정된 프리셋을 찾을 수 없습니다. 매핑을 다시 설정하세요.'); return; }
        applyPresetPedals(preset.pedals);
        setNotice(`MIDI: ${preset.name} 프리셋을 불러왔습니다.`);
      },
      volume: (value) => {
        AudioEngine.getInstance().setMasterVolume(value);
        useAudioStore.setState({ masterVolume: value });
        clearTimeout(volumeSaveTimer);
        volumeSaveTimer = setTimeout(() => {
          if (useAudioStore.getState().masterVolume === value) useAudioStore.getState().setMasterVolume(value);
        }, 250);
      },
      wah: (value) => {
        const pedal = usePedalStore.getState().pedals.find((item) => item.type === 'autoWah');
        if (!pedal) { setNotice('와우 페달이 없어 익스프레션을 적용할 수 없습니다.'); return; }
        const pedalStore = usePedalStore.getState();
        if ('mode' in pedal.params && pedal.params.mode !== 'manual') {
          pedalStore.updatePedalParam(pedal.id, 'mode', 'manual');
          AudioEngine.getInstance().setPedalParam(pedal.id, 'mode', 'manual');
        }
        pedalStore.updatePedalParam(pedal.id, 'manual', value);
        AudioEngine.getInstance().setPedalParam(pedal.id, 'manual', value);
      },
    });
    registerMidiAdvancedHandler(handle, match);
    if (configRef.current.volumeCc !== null || configRef.current.wahCc !== null || Object.keys(configRef.current.programs).length) void useAudioStore.getState().connectSavedMidi(true);
    return () => { clearTimeout(volumeSaveTimer); registerMidiAdvancedHandler(null, null); };
  }, []);

  if (!supported) return null;
  const ccOptions = Array.from({ length: 128 }, (_, index) => <option key={index} value={index}>CC {index}</option>);
  const ccValue = (value: string) => value === '' ? null : Number(value);
  return (
    <details className="midi-advanced-controls">
      <summary>MIDI 프리셋·익스프레션 설정</summary>
      <p>Program Change 번호는 0–127 기준입니다. 와우 CC 입력 시 와우가 수동 모드로 전환됩니다. 페달을 켜야 소리가 바뀝니다.</p>
      <button type="button" className="secondary-button" onClick={() => void useAudioStore.getState().connectSavedMidi(true)}>MIDI 연결</button>
      <label>채널 <select value={config.channel} onChange={(event) => save({ ...config, channel: Number(event.currentTarget.value) })}>
        {Array.from({ length: 16 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select></label>
      <label>마스터 볼륨 <select value={config.volumeCc ?? ''} onChange={(event) => save({ ...config, volumeCc: ccValue(event.currentTarget.value) })}>
        <option value="">사용 안 함</option>{ccOptions}
      </select></label>
      <label>수동 와우 <select value={config.wahCc ?? ''} onChange={(event) => save({ ...config, wahCc: ccValue(event.currentTarget.value) })}>
        <option value="">사용 안 함</option>{ccOptions}
      </select></label>
      <label>Program 번호 <input type="number" min={0} max={127} value={program} onChange={(event) => setProgram(Math.min(127, Math.max(0, Math.trunc(Number(event.currentTarget.value) || 0))))} /></label>
      <label>연결할 프리셋 <select value={presetId} onChange={(event) => setPresetId(event.currentTarget.value)}><option value="">선택</option>
        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></label>
      <button type="button" className="secondary-button" disabled={!presetId} onClick={() => save({ ...config, programs: { ...config.programs, [program]: presetId } })}>프리셋 매핑</button>
      <ul>{Object.entries(config.programs).map(([number, id]) => <li key={number}>PC {number}: {presets.find((preset) => preset.id === id)?.name ?? '삭제된 프리셋'} <button type="button" onClick={() => { const programs = { ...config.programs }; delete programs[number]; save({ ...config, programs }); }} aria-label={`Program ${number} 매핑 삭제`}>삭제</button></li>)}</ul>
      <p role="status" aria-live="polite">{error || notice}</p>
    </details>
  );
}
