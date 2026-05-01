import type { CompressorParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface CompressorPedalProps {
  params: CompressorParams;
  onChange: (key: keyof CompressorParams, value: PedalParamValue) => void;
}

export function CompressorPedal({ params, onChange }: CompressorPedalProps) {
  const estimatedReduction = Math.min(24, Math.max(0, (params.sustain / 100) * 14 + (params.ratio - 1) * 0.35));

  return (
    <>
      <div className="gain-reduction-meter">
        <span className="control-row">
          <span>Gain Reduction</span>
          <output>-{estimatedReduction.toFixed(1)} dB</output>
        </span>
        <div className="meter-track">
          <span style={{ transform: `scaleX(${estimatedReduction / 24})` }} />
        </div>
      </div>
      <SliderControl
        label="Threshold"
        value={params.threshold}
        min={-60}
        max={-10}
        step={1}
        unit=" dB"
        onChange={(value) => onChange('threshold', value)}
      />
      <SliderControl
        label="Ratio"
        value={params.ratio}
        min={1}
        max={20}
        step={0.5}
        displayValue={`${params.ratio.toFixed(1)}:1`}
        onChange={(value) => onChange('ratio', value)}
      />
      <SliderControl
        label="Attack"
        value={params.attack}
        min={0.001}
        max={0.1}
        step={0.001}
        displayValue={`${Math.round(params.attack * 1000)} ms`}
        onChange={(value) => onChange('attack', value)}
      />
      <SliderControl
        label="Release"
        value={params.release}
        min={0.05}
        max={1}
        step={0.01}
        displayValue={`${Math.round(params.release * 1000)} ms`}
        onChange={(value) => onChange('release', value)}
      />
      <SliderControl
        label="Knee"
        value={params.knee}
        min={0}
        max={40}
        step={1}
        unit=" dB"
        onChange={(value) => onChange('knee', value)}
      />
      <SliderControl
        label="Sustain"
        value={params.sustain}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(value) => onChange('sustain', value)}
      />
    </>
  );
}
