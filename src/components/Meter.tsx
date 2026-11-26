import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { formatLatency, UNDERRUN_UNAVAILABLE_REASON } from '../audio/engine/latency';
import { createRecordingFilename, WAV_BIT_DEPTHS, WAV_MAX_SECONDS_OPTIONS, type WavBitDepth } from '../audio/recording';
import type { LevelReading, TuningPresetId } from '../audio/types';
import { describeTuner } from '../audio/utils/tunerDisplay';
import { GUITAR_TUNING_OPTIONS, TUNING_PRESETS } from '../audio/utils/tunings';
import { useAudioStore } from '../store/audioStore';
import { readInputLevel, readOutputLevel, useMonitorStore } from '../store/monitorStore';
import { InputLevelNotice } from './InputLevelNotice';
import { ToggleSwitch } from './ToggleSwitch';
import { WaveformCanvas, type WaveformCanvasHandle } from './WaveformCanvas';
import { ko } from '../i18n/ko';

const STORE_REFRESH_INTERVAL_MS = 100;
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
  const pitch = useAudioStore((state) => state.pitch);
  const isTunerActive = useAudioStore((state) => state.isTunerActive);
  const tuningPreset = useAudioStore((state) => state.tuningPreset);
  const tuningReferenceHz = useAudioStore((state) => state.tuningReferenceHz);
  const latency = useAudioStore((state) => state.latency);
  const underrunCount = useAudioStore((state) => state.underrunCount);
  const masterVolume = useAudioStore((state) => state.masterVolume);
  const setMasterVolume = useAudioStore((state) => state.setMasterVolume);
  const setTunerActive = useAudioStore((state) => state.setTunerActive);
  const setTuningPreset = useAudioStore((state) => state.setTuningPreset);
  const setTuningReferenceHz = useAudioStore((state) => state.setTuningReferenceHz);
  const refreshMeters = useAudioStore((state) => state.refreshMeters);
  const recordingFormat = useAudioStore((state) => state.recordingFormat);
  const recordedFormat = useAudioStore((state) => state.recordedFormat);
  const setRecordingFormat = useAudioStore((state) => state.setRecordingFormat);
  const wavBitDepth = useAudioStore((state) => state.wavBitDepth);
  const setWavBitDepth = useAudioStore((state) => state.setWavBitDepth);
  const wavMaxSeconds = useAudioStore((state) => state.wavMaxSeconds);
  const setWavMaxSeconds = useAudioStore((state) => state.setWavMaxSeconds);
  const recordingLimitSeconds = useAudioStore((state) => state.recordingLimitSeconds);
  const wavSupported = typeof AudioContext !== 'undefined' && !!AudioContext.prototype.createScriptProcessor;
  const webmSupported = useAudioStore((state) => state.recordingSupported);
  const selectedRecordingSupported = recordingFormat === 'wav' ? wavSupported : webmSupported;
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
  const latencyDisplay = formatLatency(latency);
  const tuner = describeTuner(pitch, isTunerActive);
  const hasPitch = tuner.hasPitch;
  const tunerStatus = tuner.status;
  const isChromatic = tuningPreset === 'chromatic';
  // 크로매틱에서 기타로 돌아올 때 직전에 쓰던 기타 튜닝으로 간다(처음엔 표준)
  const lastGuitarPresetRef = useRef<TuningPresetId>('standard');
  if (!isChromatic) lastGuitarPresetRef.current = tuningPreset;
  const tuningTargets = TUNING_PRESETS[tuningPreset].targets;

  useEffect(() => {
    const engine = AudioEngine.getInstance();
    let animationFrame: number | null = null;

    const updateRealtimeStatus = (outputLevel: LevelReading) => {
      // 입력 쪽은 막대의 순간 클립 표시가 아니라 MonitorService 가 판정한 '너무 큼'(4.12)을 따른다. 입력 패널의 안내와 같은 값이라
      // 한쪽은 '클리핑 발생', 다른 쪽은 '헤드룸 정상'이라고 하는 어긋남이 없다(S2.5).
      const isClipping = useMonitorStore.getState().inputWarning === 'high' || outputLevel.isClipping;
      const clipIndicator = clipIndicatorRef.current;
      const outputWarning = outputWarningRef.current;

      if (clipIndicator) {
        clipIndicator.classList.toggle('is-active', isClipping);
        clipIndicator.textContent = isClipping ? ko.meter.clipped : ko.meter.headroomOk;
      }

      if (!outputWarning) return;

      if (outputLevel.isClipping) {
        outputWarning.hidden = false;
        outputWarning.className = 'level-warning is-danger';
        outputWarning.setAttribute('role', 'alert');
        outputWarning.textContent = ko.meter.outputClipping;
      } else if (outputLevel.peakDb > -1) {
        outputWarning.hidden = false;
        outputWarning.className = 'level-warning is-warning';
        outputWarning.setAttribute('role', 'status');
        outputWarning.textContent = ko.meter.outputNearFull;
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
      updateRealtimeStatus(SILENT_LEVEL);
    };

    const cancelFrame = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };

    const renderFrame = () => {
      animationFrame = null;
      if (!active || !isRunning || document.visibilityState !== 'visible') return;

      // 레벨은 오디오 스레드의 level-meter 가 재서 monitorStore 에 둔 값이다. 여기서는 읽어 그리기만 한다.
      const inputLevel = readInputLevel();
      const outputLevel = readOutputLevel();

      inputLevelRef.current?.update(inputLevel);
      outputLevelRef.current?.update(outputLevel);
      waveformRef.current?.draw(engine.readInputWaveform(), engine.readOutputWaveform());
      updateRealtimeStatus(outputLevel);

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
  }, [active, isRunning]);

  // Meter readings and file position must not depend on the selected panel.
  useEffect(() => {
    if (!isRunning) return;
    const update = () => refreshMeters(readInputLevel(), readOutputLevel());
    update();
    const timer = window.setInterval(update, STORE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isRunning, refreshMeters]);

  return (
    <section className="side-panel meter-panel">
      <div className="panel-title">
        <p className="eyebrow">{ko.app.eyebrow.monitor}</p>
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

      <LevelBar ref={inputLevelRef} label={ko.meter.inputBar} />
      <LevelBar ref={outputLevelRef} label={ko.meter.outputBar} />

      <div ref={clipIndicatorRef} className="clip-indicator" role="status" aria-live="polite">
        헤드룸 정상
      </div>

      <InputLevelNotice />

      <p ref={outputWarningRef} className="level-warning" hidden />

      <WaveformCanvas ref={waveformRef} />

      <div className="recording-panel">
        <label>녹음 형식
          <select value={recordingFormat} disabled={recordingStatus === 'recording'} onChange={(event) => setRecordingFormat(event.currentTarget.value as 'webm' | 'wav')}>
            <option value="wav">WAV (원본 음질, 길이 정확)</option>
            <option value="webm">작은 파일 (브라우저 지원 압축 형식)</option>
          </select>
        </label>
        {recordingFormat === 'wav' ? (
          <div className="recording-wav-options">
            <label>비트 깊이
              <select value={wavBitDepth} disabled={recordingStatus === 'recording'} onChange={(event) => setWavBitDepth(Number(event.currentTarget.value) as WavBitDepth)}>
                {WAV_BIT_DEPTHS.map((depth) => <option key={depth} value={depth}>{depth}비트</option>)}
              </select>
            </label>
            <label>최대 길이
              <select value={wavMaxSeconds} disabled={recordingStatus === 'recording'} onChange={(event) => setWavMaxSeconds(Number(event.currentTarget.value))}>
                {WAV_MAX_SECONDS_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds / 60}분</option>)}
              </select>
            </label>
          </div>
        ) : null}
        {recordingFormat === 'webm' ? <p>압축 녹음 형식은 브라우저에 따라 WebM, MP4 또는 기타 형식으로 저장됩니다.</p> : null}
        {recordingFormat === 'wav' ? <p>WAV 녹음은 고른 최대 길이나 메모리 제한에 도달하면 자동 저장됩니다. 길수록 메모리를 많이 씁니다. 녹음 중에는 화면을 열어 두세요. 기기가 바쁘거나 백그라운드 상태일 때 소리가 끊길 수 있습니다.</p> : null}
        <div className="recording-actions" role="group" aria-label="마스터 출력 녹음">
          <button
            className="secondary-button recording-start-button"
            type="button"
            disabled={!selectedRecordingSupported || !isRunning || recordingStatus === 'recording'}
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
              link.download = createRecordingFilename(new Date(), recordedFormat);
              link.click();
            }}
          >
            다운로드
          </button>
        </div>
        <p className="recording-status" aria-live="polite">
          {!selectedRecordingSupported
            ? ko.meter.recordingUnsupported
            : recordingStatus === 'recording'
              ? `녹음 중 ${formatElapsed(recordingElapsed)}${recordingFormat === 'wav' ? ` · 남은 시간 ${formatElapsed(recordingLimitSeconds - recordingElapsed)}` : ''}`
              : recordingStatus === 'ready'
                ? `녹음 완료 ${formatElapsed(recordingElapsed)} · ${recordedFormat === 'unknown' ? '파일 형식 확인 불가 (확장자 없음)' : recordedFormat.toUpperCase()}`
                : '녹음 대기'}
        </p>
      </div>

      <div className="latency-status" aria-live="polite">
        <span>{latencyDisplay.headline}</span>
        {latencyDisplay.items.length > 0 ? (
          <>
            <p className="latency-items">
              {latencyDisplay.items.map((item) => (
                <span key={item.key} className={`latency-item latency-item-${item.key}`}>
                  {item.text}
                </span>
              ))}
            </p>
            <p>입력·출력은 브라우저가 알려 주는 값이고 실제 왕복 지연을 잰 값이 아닙니다. 처리는 켜진 페달과 리미터가 더하는 고정 지연입니다.</p>
          </>
        ) : null}
        {latencyDisplay.advice ? <p className="latency-advice">지연이 큽니다. {latencyDisplay.advice}</p> : null}
      </div>

      <div className="performance-status" aria-live="polite">
        <span>
          이펙트 <output>{activeEffectCount}개</output>
        </span>
        <i aria-hidden="true">·</i>
        <span>
          지연 <output>{latencyDisplay.totalMs === null ? '--' : `${latencyDisplay.totalMs.toFixed(1)}ms`}</output>
        </span>
        <i aria-hidden="true">·</i>
        <span title={isRunning && underrunCount === null ? UNDERRUN_UNAVAILABLE_REASON : '세션을 시작한 뒤 출력 버퍼가 모자라 소리가 끊긴 횟수'}>
          끊김{' '}
          <output className="underrun-count">{!isRunning ? '--' : underrunCount === null ? '측정 불가' : `${underrunCount}회`}</output>
        </span>
      </div>

      <div className="tuner-display">
        <div className="tuner-toolbar">
          <ToggleSwitch label="튜너" checked={isTunerActive} onChange={setTunerActive} />
          <div className="tuner-mode-switch" role="group" aria-label="튜너 방식">
            <button
              type="button"
              aria-pressed={!isChromatic}
              onClick={() => setTuningPreset(lastGuitarPresetRef.current)}
            >
              기타
            </button>
            <button type="button" aria-pressed={isChromatic} onClick={() => setTuningPreset('chromatic')}>
              크로매틱
            </button>
          </div>
          <label className="tuner-preset-control">
            <span>튜닝</span>
            <select
              value={isChromatic ? lastGuitarPresetRef.current : tuningPreset}
              disabled={isChromatic}
              onChange={(event) =>
                setTuningPreset(event.currentTarget.value as TuningPresetId)
              }
            >
              {GUITAR_TUNING_OPTIONS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tuner-preset-control">
            <span>기준음 A4</span>
            <select value={tuningReferenceHz} onChange={(event) => setTuningReferenceHz(Number(event.currentTarget.value))}>
              {Array.from({ length: 81 }, (_, index) => 400 + index).map((hz) => <option key={hz} value={hz}>{hz} Hz</option>)}
            </select>
          </label>
        </div>

        <div className="tuner-targets" role="group" aria-label="현재 튜닝 목표음" hidden={isChromatic}>
          {tuningTargets.map((target) => {
            const isTarget = hasPitch && pitch.targetNote === target.note;
            return (
              <span
                className={isTarget ? 'is-target' : undefined}
                aria-current={isTarget ? 'true' : undefined}
                key={target.note}
              >
                {6 - tuningTargets.indexOf(target)}번 {target.note}
              </span>
            );
          })}
        </div>

        <div className={`tuner-reading is-${tunerStatus}`} aria-live="polite">
          <span className="tuner-note">{tuner.note}</span>
          <span className="tuner-pitch-detail">
            {tuner.stringLabel ? <span className="tuner-string">{tuner.stringLabel}</span> : null}
            <span className="tuner-frequency">{tuner.frequencyText}</span>
            <strong className="tuner-status-text">{tuner.statusText}</strong>
          </span>
          <output className="tuner-cents">{tuner.centsText}</output>
        </div>

        <div
          className={`cent-strip is-${tunerStatus}`}
          style={{ '--cent-position': `${tuner.needlePercent}%` } as CSSProperties}
          aria-label="튜닝 센트"
          aria-valuemax={50}
          aria-valuemin={-50}
          aria-valuenow={tuner.boundedCents}
          aria-valuetext={tuner.statusText}
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
            trackRef.current.setAttribute('aria-valuetext', ko.meter.valueText(dbText, peakText));
          }
        },
        reset: () => {
          if (outputRef.current) outputRef.current.textContent = '-inf dB / -inf dBpk';
          if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
          if (peakRef.current) peakRef.current.style.left = '0%';
          if (trackRef.current) {
            trackRef.current.classList.remove('is-clipping');
            trackRef.current.setAttribute('aria-valuenow', '0');
            trackRef.current.setAttribute('aria-valuetext', ko.meter.valueTextEmpty);
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
          aria-valuetext={ko.meter.valueTextEmpty}
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
