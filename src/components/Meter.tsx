import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';

export function Meter() {
  const isRunning = useAudioStore((state) => state.isRunning);
  const inputLevel = useAudioStore((state) => state.inputLevel);
  const outputLevel = useAudioStore((state) => state.outputLevel);
  const cpuLoad = useAudioStore((state) => state.cpuLoad);
  const pitch = useAudioStore((state) => state.pitch);
  const refreshMeters = useAudioStore((state) => state.refreshMeters);
  const isClipping = inputLevel.isClipping || outputLevel.isClipping;
  const outputNearClip = outputLevel.peakDb > -1;

  useEffect(() => {
    if (!isRunning) return undefined;

    const timer = window.setInterval(refreshMeters, 90);
    return () => window.clearInterval(timer);
  }, [isRunning, refreshMeters]);

  return (
    <section className="side-panel meter-panel">
      <div className="panel-title">
        <p className="eyebrow">Monitor</p>
        <h2>미터 & 튜너</h2>
      </div>

      <LevelBar
        label="Input"
        db={inputLevel.db}
        peakDb={inputLevel.peakDb}
        value={inputLevel.linear}
        peak={inputLevel.peakLinear}
        clipping={inputLevel.isClipping}
      />
      <LevelBar
        label="Output"
        db={outputLevel.db}
        peakDb={outputLevel.peakDb}
        value={outputLevel.linear}
        peak={outputLevel.peakLinear}
        clipping={outputLevel.isClipping}
      />

      <div className={`clip-indicator${isClipping ? ' is-active' : ''}`}>
        {isClipping ? 'Clipping' : 'Headroom OK'}
      </div>

      {outputNearClip && (
        <p className="warning-message">
          Master output이 0 dBFS에 가깝습니다. pedal level 또는 interface output을 낮추세요.
        </p>
      )}

      <div className="cpu-meter">
        <span className="control-row">
          <span>CPU</span>
          <output>{cpuLoad}%</output>
        </span>
        <div className="meter-track">
          <span style={{ transform: `scaleX(${Math.min(1, cpuLoad / 100)})` }} />
        </div>
      </div>

      <div className="tuner-display">
        <span className="tuner-note">{pitch.note ?? '--'}</span>
        <span>{pitch.frequency ? `${pitch.frequency.toFixed(1)} Hz` : '신호 대기'}</span>
        <div className="cent-strip" aria-label="튜닝 센트">
          <span style={{ left: `${Math.min(100, Math.max(0, 50 + pitch.cents))}%` }} />
        </div>
      </div>
    </section>
  );
}

interface LevelBarProps {
  label: string;
  db: number;
  peakDb: number;
  value: number;
  peak: number;
  clipping: boolean;
}

function LevelBar({ label, db, peakDb, value, peak, clipping }: LevelBarProps) {
  return (
    <div className="level-row">
      <span className="control-row">
        <span>{label}</span>
        <output>
          {db <= -100 ? '-inf' : `${db.toFixed(1)} dB`} /{' '}
          {peakDb <= -100 ? '-inf' : `${peakDb.toFixed(1)} dBpk`}
        </output>
      </span>
      <div className={`meter-track${clipping ? ' is-clipping' : ''}`}>
        <span style={{ transform: `scaleX(${value})` }} />
        <i style={{ left: `${Math.min(100, Math.max(0, peak * 100))}%` }} />
      </div>
    </div>
  );
}
