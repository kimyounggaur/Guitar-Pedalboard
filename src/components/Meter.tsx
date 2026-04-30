import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';

export function Meter() {
  const isRunning = useAudioStore((state) => state.isRunning);
  const inputLevel = useAudioStore((state) => state.inputLevel);
  const outputLevel = useAudioStore((state) => state.outputLevel);
  const pitch = useAudioStore((state) => state.pitch);
  const refreshMeters = useAudioStore((state) => state.refreshMeters);

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

      <LevelBar label="Input" db={inputLevel.db} value={inputLevel.linear} />
      <LevelBar label="Output" db={outputLevel.db} value={outputLevel.linear} />

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
  value: number;
}

function LevelBar({ label, db, value }: LevelBarProps) {
  return (
    <div className="level-row">
      <span className="control-row">
        <span>{label}</span>
        <output>{db <= -100 ? '-inf' : `${db.toFixed(1)} dB`}</output>
      </span>
      <div className="meter-track">
        <span style={{ transform: `scaleX(${value})` }} />
      </div>
    </div>
  );
}
