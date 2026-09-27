import { useId } from 'react';
import { useAudioStore } from '../store/audioStore';
import { SliderControl } from './SliderControl';

export function TapTempoControl() {
  const statusId = useId();
  const bpm = useAudioStore((state) => state.tapTempo.bpm);
  const tapCount = useAudioStore((state) => state.tapTempo.taps.length);
  const setGlobalBpm = useAudioStore((state) => state.setGlobalBpm);
  const tapTempoTap = useAudioStore((state) => state.tapTempoTap);

  return (
    <div className="tempo-control-row">
      <SliderControl
        label="BPM"
        value={bpm}
        min={40}
        max={240}
        step={1}
        displayValue={`${bpm}`}
        onChange={setGlobalBpm}
      />
      <div className="tap-tempo-action">
        <button
          className="tap-tempo-button"
          type="button"
          aria-describedby={statusId}
          title="탭 템포 (T)"
          onClick={tapTempoTap}
        >
          <span>TAP</span>
          <kbd aria-hidden="true">T</kbd>
        </button>
        <output className="tap-tempo-status" id={statusId}>
          {bpm} BPM · {tapCount}/4
        </output>
      </div>
    </div>
  );
}
