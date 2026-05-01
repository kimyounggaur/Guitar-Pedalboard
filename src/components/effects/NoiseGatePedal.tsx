import { useEffect, useState } from 'react';
import type { NoiseGateParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface NoiseGatePedalProps {
  params: NoiseGateParams;
  onChange: (key: keyof NoiseGateParams, value: PedalParamValue) => void;
}

export function NoiseGatePedal({ params, onChange }: NoiseGatePedalProps) {
  const [gateState, setGateState] = useState('Closed');

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ state: string }>).detail;
      if (detail?.state) setGateState(detail.state);
    };

    window.addEventListener('noise-gate-state', listener);
    return () => window.removeEventListener('noise-gate-state', listener);
  }, []);

  return (
    <>
      <div className={`effect-status state-${gateState.toLowerCase()}`}>Gate: {gateState}</div>
      <SliderControl
        label="Threshold"
        value={params.thresholdDb}
        min={-80}
        max={-20}
        step={1}
        unit=" dB"
        onChange={(value) => onChange('thresholdDb', value)}
      />
      <SliderControl
        label="Reduction"
        value={params.reductionDb}
        min={-80}
        max={0}
        step={1}
        unit=" dB"
        onChange={(value) => onChange('reductionDb', value)}
      />
      <SliderControl
        label="Attack"
        value={params.attackMs}
        min={1}
        max={50}
        step={1}
        unit=" ms"
        onChange={(value) => onChange('attackMs', value)}
      />
      <SliderControl
        label="Hold"
        value={params.holdMs}
        min={0}
        max={300}
        step={5}
        unit=" ms"
        onChange={(value) => onChange('holdMs', value)}
      />
      <SliderControl
        label="Release"
        value={params.releaseMs}
        min={20}
        max={1000}
        step={10}
        unit=" ms"
        onChange={(value) => onChange('releaseMs', value)}
      />
      <SliderControl
        label="Hysteresis"
        value={params.hysteresisDb}
        min={0}
        max={10}
        step={0.5}
        unit=" dB"
        onChange={(value) => onChange('hysteresisDb', value)}
      />
    </>
  );
}
