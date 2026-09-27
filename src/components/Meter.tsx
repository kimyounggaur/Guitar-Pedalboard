import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { createRecordingFilename } from '../audio/recording';
import type { LevelReading, TuningPresetId } from '../audio/types';
import { TUNING_PRESETS, TUNING_PRESET_OPTIONS } from '../audio/utils/tunings';
import { useAudioStore } from '../store/audioStore';
import { ToggleSwitch } from './ToggleSwitch';
import { WaveformCanvas, type WaveformCanvasHandle } from './WaveformCanvas';

const STORE_REFRESH_INTERVAL_MS = 50;
const SILENT_LEVEL: LevelReading = {
  db: -120,
  linear: 0,
  peakDb: -120,
  peakLinear: 0,
  isClipping: false,
  clipHoldUntil: 0,
};

interface LevelBarHandle {
  update: (reading: LevelReading) => void;
  reset: () => void;
}

interface MeterProps {
  active?: boolean;
}

export function Meter({ active = true }: MeterProps) {
  const isRunning = useAudioStore((state) => state.isRunning);
  const activeEffectCount = useAudioStore((state) => state.activeEffectCount);
  const audioGlitchCount = useAudioStore((state) => state.audioGlitchCount);
  const pitch = useAudioStore((state) => state.pitch);
  const isTunerActive = useAudioStore((state) => state.isTunerActive);
  const tuningPreset = useAudioStore((state) => state.tuningPreset);
  const latency = useAudioStore((state) => state.latency);
  const masterVolume = useAudioStore((state) => state.masterVolume);
  const setMasterVolume = useAudioStore((state) => state.setMasterVolume);
  const setTunerActive = useAudioStore((state) => state.setTunerActive);
  const setTuningPreset = useAudioStore((state) => state.setTuningPreset);
  const refreshMeters = useAudioStore((state) => state.refreshMeters);
  const recordingSupported = useAudioStore((state) => state.recordingSupported);
  const recordingStatus = useAudioStore((state) => state.recordingStatus);
  const recordedUrl = useAudioStore((state) => state.recordedUrl);
  const recordingElapsed = useAudioStore((state) => state.recordingElapsed);
  const startRecording = useAudioStore((state) => state.startRecording);
  const stopRecording = useAudioStore((state) => state.stopRecording);
  const inputLevelRef = useRef<LevelBarHandle>(null);
  const outputLevelRef = useRef<LevelBarHandle>(null);
  const waveformRef = useRef<WaveformCanvasHandle>(null);
  const clipIndicatorRef = useRef<HTMLDivElement>(null);
  const outputWarningRef = useRef<HTMLParagraphElement>(null);
  const latencyTotal = latency.base + latency.output;
  const hasLatencyReading = latency.sampleRate > 0;
  const hasPitch = isTunerActive && pitch.frequency !== null && pitch.note !== null;
  const absoluteCents = Math.abs(pitch.cents);
  const tunerStatus = !hasPitch
    ? 'idle'
    : absoluteCents <= 5
      ? 'in-tune'
      : absoluteCents <= 15
        ? 'near'
        : 'far';
  const roundedCents = Math.round(pitch.cents);
  const centsLabel = hasPitch
    ? `${roundedCents > 0 ? '+' : ''}${roundedCents} ¢`
    : '-- ¢';
  const tuningStatusLabel = !isTunerActive
    ? '튜너 꺼짐'
    : !hasPitch
      ? '신호 대기'
      : tunerStatus === 'in-tune'
        ? '정확함'
        : `${Math.abs(roundedCents)}센트 ${roundedCents > 0 ? '높음' : '낮음'}`;
  const boundedCents = Math.round(Math.min(50, Math.max(-50, hasPitch ? pitch.cents : 0)));
  const centPosition = hasPitch ? Math.min(100, Math.max(0, 50 + pitch.cents)) : 50;
  const tuningTargets = TUNING_PRESETS[tuningPreset].targets;

  useEffect(() => {
    const engine = AudioEngine.getInstance();
    let animationFrame: number | null = null;
    let lastStoreRefreshAt = Number.NEGATIVE_INFINITY;

    const updateRealtimeStatus = (inputLevel: LevelReading, outputLevel: LevelReading) => {
      const isClipping = inputLevel.isClipping || outputLevel.isClipping;
      const clipIndicator = clipIndicatorRef.current;
      const outputWarning = outputWarningRef.current;

      if (clipIndicator) {
        clipIndicator.classList.toggle('is-active', isClipping);
        clipIndicator.textContent = isClipping ? '클리핑 발생' : '헤드룸 정상';
      }

      if (!outputWarning) return;

      if (outputLevel.isClipping) {
        outputWarning.hidden = false;
        outputWarning.className = 'level-warning is-danger';
        outputWarning.setAttribute('role', 'alert');
        outputWarning.textContent =
          '출력 클리핑이 발생했습니다. 마스터 볼륨이나 페달 레벨을 낮추세요.';
      } else if (outputLevel.peakDb > -1) {
        outputWarning.hidden = false;
        outputWarning.className = 'level-warning is-warning';
        outputWarning.setAttribute('role', 'status');
        outputWarning.textContent =
          '마스터 출력이 0dBFS에 근접했습니다. 페달 레벨이나 인터페이스 출력을 낮추세요.';
      } else {
        outputWarning.hidden = true;
        outputWarning.className = 'level-warning';
        outputWarning.removeAttribute('role');
        outputWarning.textContent = '';
      }
    };

    const resetRealtimeUi = () => {
      inputLevelRef.current?.reset();
      outputLevelRef.current?.reset();
      waveformRef.current?.clear();
      updateRealtimeStatus(SILENT_LEVEL, SILENT_LEVEL);
    };

    const cancelFrame = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };

    const renderFrame = (timestamp: number) => {
      animationFrame = null;
      if (!active || !isRunning || document.visibilityState !== 'visible') return;

      const inputLevel = engine.readInputLevel();
      const outputLevel = engine.readOutputLevel();

      inputLevelRef.current?.update(inputLevel);
      outputLevelRef.current?.update(outputLevel);
      waveformRef.current?.draw(engine.readInputWaveform(), engine.readOutputWaveform());
      updateRealtimeStatus(inputLevel, outputLevel);

      if (timestamp - lastStoreRefreshAt >= STORE_REFRESH_INTERVAL_MS) {
        lastStoreRefreshAt = timestamp;
        refreshMeters(inputLevel, outputLevel);

        if (!useAudioStore.getState().isRunning) {
          resetRealtimeUi();
          return;
        }
      }

      animationFrame = window.requestAnimationFrame(renderFrame);
    };

    const syncAnimation = () => {
      if (!active || !isRunning || document.visibilityState !== 'visible') {
        cancelFrame();
        if (!isRunning) resetRealtimeUi();
        return;
      }

      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    document.addEventListener('visibilitychange', syncAnimation);
    syncAnimation();

    return () => {
      document.removeEventListener('visibilitychange', syncAnimation);
      cancelFrame();
    };
  }, [active, isRunning, refreshMeters]);

  return (
    <section className="side-panel meter-panel">
      <div className="panel-title">
        <p className="eyebrow">Monitor</p>
        <h2>미터 & 튜너</h2>
      </div>

      <label className="io-slider-control master-volume-control">
        <span className="control-row">
          <span>마스터 볼륨</span>
          <output>{Math.round(masterVolume * 100)}%</output>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          aria-label="마스터 볼륨"
          aria-valuetext={`마스터 볼륨 ${Math.round(masterVolume * 100)} 퍼센트`}
          onChange={(event) => setMasterVolume(Number(event.currentTarget.value))}
        />
      </label>

      <LevelBar ref={inputLevelRef} label="Input" />
      <LevelBar ref={outputLevelRef} label="Output" />

      <div ref={clipIndicatorRef} className="clip-indicator" role="status" aria-live="polite">
        헤드룸 정상
      </div>

      <p ref={outputWarningRef} className="level-warning" hidden />

      <WaveformCanvas ref={waveformRef} />

      <div className="recording-panel">
        <div className="recording-actions" role="group" aria-label="마스터 출력 녹음">
          <button
            className="secondary-button recording-start-button"
            type="button"
            disabled={!recordingSupported || !isRunning || recordingStatus === 'recording'}
            onClick={startRecording}
          >
            녹음
          </button>
          <button
            className="secondary-button recording-stop-button"
            type="button"
            disabled={recordingStatus !== 'recording'}
            onClick={() => void stopRecording()}
          >
            정지
          </button>
          <button
            className="secondary-button recording-download-button"
            type="button"
            disabled={!recordedUrl}
            onClick={() => {
              if (!recordedUrl) return;
              const link = document.createElement('a');
              link.href = recordedUrl;
              link.download = createRecordingFilename();
              link.click();
            }}
          >
            다운로드
          </button>
        </div>
        <p className="recording-status" aria-live="polite">
          {!recordingSupported
            ? '이 브라우저에서는 녹음을 지원하지 않습니다.'
            : recordingStatus === 'recording'
              ? `녹음 중 ${formatElapsed(recordingElapsed)}`
              : recordingStatus === 'ready'
                ? `녹음 완료 ${formatElapsed(recordingElapsed)}`
                : '녹음 대기'}
        </p>
      </div>

      <div className="latency-status" aria-live="polite">
        <span>
          {hasLatencyReading
            ? `지연시간 ${latencyTotal.toFixed(1)}ms @ ${(latency.sampleRate / 1000).toFixed(1)}kHz`
            : '지연시간 측정 대기'}
        </span>
        {hasLatencyReading && latencyTotal > 20 ? (
          <p>
            지연이 큽니다. ASIO/전용 드라이버 사용이나 버퍼 크기 조정을 검토하세요.
          </p>
        ) : null}
      </div>

      <div className="performance-status" aria-live="polite">
        <span>
          이펙트 <output>{activeEffectCount}개</output>
        </span>
        <i aria-hidden="true">·</i>
        <span>
          지연 <output>{hasLatencyReading ? `${latencyTotal.toFixed(1)}ms` : '--'}</output>
        </span>
        <i aria-hidden="true">·</i>
        <span>
          글리치 <output>{audioGlitchCount}</output>
        </span>
      </div>

      <div className="tuner-display">
        <div className="tuner-toolbar">
          <ToggleSwitch label="튜너" checked={isTunerActive} onChange={setTunerActive} />
          <label className="tuner-preset-control">
            <span>튜닝</span>
            <select
              value={tuningPreset}
              onChange={(event) =>
                setTuningPreset(event.currentTarget.value as TuningPresetId)
              }
            >
              {TUNING_PRESET_OPTIONS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tuner-targets" role="group" aria-label="현재 튜닝 목표음">
          {tuningTargets.map((target) => {
            const isTarget = hasPitch && pitch.note === target.note;
            return (
              <span
                className={isTarget ? 'is-target' : undefined}
                aria-current={isTarget ? 'true' : undefined}
                key={target.note}
              >
                {target.note}
              </span>
            );
          })}
        </div>

        <div className={`tuner-reading is-${tunerStatus}`} aria-live="polite">
          <span className="tuner-note">{hasPitch ? pitch.note : '--'}</span>
          <span className="tuner-pitch-detail">
            <span className="tuner-frequency">
              {hasPitch && pitch.frequency ? `${pitch.frequency.toFixed(1)} Hz` : '주파수 --'}
            </span>
            <strong className="tuner-status-text">{tuningStatusLabel}</strong>
          </span>
          <output className="tuner-cents">{centsLabel}</output>
        </div>

        <div
          className={`cent-strip is-${tunerStatus}`}
          style={{ '--cent-position': `${centPosition}%` } as CSSProperties}
          aria-label="튜닝 센트"
          aria-valuemax={50}
          aria-valuemin={-50}
          aria-valuenow={boundedCents}
          aria-valuetext={tuningStatusLabel}
          role="meter"
        >
          <span />
        </div>
      </div>
    </section>
  );
}

interface LevelBarProps {
  label: string;
}

const LevelBar = memo(
  forwardRef<LevelBarHandle, LevelBarProps>(function LevelBar({ label }, ref) {
    const outputRef = useRef<HTMLOutputElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLSpanElement>(null);
    const peakRef = useRef<HTMLElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        update: (reading) => {
          const level = Math.min(1, Math.max(0, reading.linear));
          const peak = Math.min(1, Math.max(0, reading.peakLinear));
          const dbText = formatDb(reading.db, 'dB');
          const peakText = formatDb(reading.peakDb, 'dBpk');

          if (outputRef.current) outputRef.current.textContent = `${dbText} / ${peakText}`;
          if (fillRef.current) fillRef.current.style.transform = `scaleX(${level})`;
          if (peakRef.current) peakRef.current.style.left = `${peak * 100}%`;
          if (trackRef.current) {
            trackRef.current.classList.toggle('is-clipping', reading.isClipping);
            trackRef.current.setAttribute('aria-valuenow', String(Math.round(level * 100)));
            trackRef.current.setAttribute('aria-valuetext', `${dbText}, peak ${peakText}`);
          }
        },
        reset: () => {
          if (outputRef.current) outputRef.current.textContent = '-inf dB / -inf dBpk';
          if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
          if (peakRef.current) peakRef.current.style.left = '0%';
          if (trackRef.current) {
            trackRef.current.classList.remove('is-clipping');
            trackRef.current.setAttribute('aria-valuenow', '0');
            trackRef.current.setAttribute('aria-valuetext', '-inf dB, peak -inf dBpk');
          }
        },
      }),
      [],
    );

    return (
      <div className="level-row">
        <span className="control-row">
          <span>{label}</span>
          <output ref={outputRef}>-inf dB / -inf dBpk</output>
        </span>
        <div
          ref={trackRef}
          className="meter-track"
          aria-label={`${label} 레벨`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          aria-valuetext="-inf dB, peak -inf dBpk"
          role="meter"
        >
          <span ref={fillRef} style={{ transform: 'scaleX(0)' }} />
          <i ref={peakRef} style={{ left: '0%' }} />
        </div>
      </div>
    );
  }),
);

function formatDb(value: number, unit: string): string {
  return value <= -100 ? `-inf ${unit}` : `${value.toFixed(1)} ${unit}`;
}

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
