import type { DriveParams, PedalParamValue } from '../../audio/types';
import { useAudioStore } from '../../store/audioStore';
import { SliderControl } from '../SliderControl';
import { WaveformCanvas } from '../WaveformCanvas';

interface DrivePedalProps {
  params: DriveParams;
  onChange: (key: keyof DriveParams, value: PedalParamValue) => void;
}

const presets: Record<string, Pick<DriveParams, 'mode' | 'drive' | 'tone' | 'level' | 'mix' | 'bias'>> = {
  'Blues OD': { mode: 'overdrive', drive: 36, tone: 58, level: 96, mix: 84, bias: 0.12 },
  'Classic Crunch': { mode: 'crunch', drive: 56, tone: 62, level: 94, mix: 88, bias: 0.04 },
  'Hard Rock': { mode: 'distortion', drive: 76, tone: 68, level: 90, mix: 92, bias: 0 },
  'Vintage Fuzz': { mode: 'fuzz', drive: 88, tone: 48, level: 86, mix: 100, bias: -0.08 },
};

export function DrivePedal({ params, onChange }: DrivePedalProps) {
  const inputWaveform = useAudioStore((state) => state.inputWaveform);
  const outputWaveform = useAudioStore((state) => state.outputWaveform);

  const applyPreset = (name: string) => {
    const preset = presets[name];
    Object.entries(preset).forEach(([key, value]) => onChange(key as keyof DriveParams, value));
  };

  return (
    <>
      <WaveformCanvas input={inputWaveform} output={outputWaveform} />
      <label className="select-control">
        <span>Mode</span>
        <select value={params.mode} onChange={(event) => onChange('mode', event.currentTarget.value)}>
          <option value="overdrive">Overdrive</option>
          <option value="crunch">Crunch</option>
          <option value="distortion">Distortion</option>
          <option value="fuzz">Fuzz</option>
        </select>
      </label>
      <div className="preset-buttons">
        {Object.keys(presets).map((name) => (
          <button type="button" className="text-button" key={name} onClick={() => applyPreset(name)}>
            {name}
          </button>
        ))}
      </div>
      <SliderControl
        label="Drive"
        value={params.drive}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(value) => onChange('drive', value)}
      />
      <SliderControl
        label="Tone"
        value={params.tone}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(value) => onChange('tone', value)}
      />
      <SliderControl
        label="Bias"
        value={params.bias}
        min={-1}
        max={1}
        step={0.01}
        onChange={(value) => onChange('bias', value)}
      />
    </>
  );
}
