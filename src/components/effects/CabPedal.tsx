import { knobDefault } from '../knobDefaults';
import { KnobNumberInput } from '../KnobNumberInput';
import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../../audio/AudioEngine';
import type { CabParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';
import { useParamNames } from '../ParamScope';
import { ko } from '../../i18n/ko';

interface CabPedalProps {
  params: CabParams;
  onChange: (key: keyof CabParams, value: PedalParamValue) => void;
}

const cabModels: Array<{ value: CabParams['model']; label: string }> = [
  { value: 'v30-4x12', label: 'Modern 4×12' },
  { value: 'greenback-4x12', label: 'Vintage 4×12' },
  { value: 'blue-1x12', label: 'Blue 1×12' },
  { value: 'jensen-1x12', label: 'American 1×12' },
  { value: 'tweed-1x10', label: 'Tweed 1×10' },
  { value: 'my-ir', label: '내 IR' },
  { value: 'off', label: 'IR 끄기' },
];

/** 지우고 나서 '내 IR' 을 고른 채로 두면 화면과 소리가 어긋나므로 돌아갈 모델. 이펙트가 IR 없을 때 대신 쓰는 모델과 같다. */
const MODEL_AFTER_IR_DELETE: CabParams['model'] = 'v30-4x12';

export function CabPedal({ params, onChange }: CabPedalProps) {
  const [irInfo, setIrInfo] = useState(() => AudioEngine.getInstance().getCabinetIrInfo());
  const [irError, setIrError] = useState('');
  const [irNotPersisted, setIrNotPersisted] = useState(false);
  const [irLoading, setIrLoading] = useState(false);
  const irInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const engine = AudioEngine.getInstance();
    const refresh = () => setIrInfo(engine.getCabinetIrInfo());
    window.addEventListener('cab-ir-change', refresh);
    // 저장소에 남은 내 IR 을 읽는다(새로고침 뒤에도 이름이 보이도록). 읽기가 끝나면 'cab-ir-change' 로 다시 그린다.
    void engine.loadStoredCabinetIr().then(refresh);
    refresh();
    return () => window.removeEventListener('cab-ir-change', refresh);
  }, []);
  const usesMyIr = params.model === 'my-ir';
  // '내 IR' 을 쓰기 시작할 때(고르거나, 저장된 모델이 '내 IR' 인 채로 열 때) 저장소를 다시 읽는다. 다른 탭이 그 사이에 올리거나 지웠을 수 있어서,
  // 저장돼 있는 IR 을 없다고 안내하거나 지워진 IR 을 '저장되어 유지된다' 고 안내하는 일이 없게 한다.
  useEffect(() => {
    if (!usesMyIr) return;
    const engine = AudioEngine.getInstance();
    void engine.syncCabinetIrFromStore().then(() => setIrInfo(engine.getCabinetIrInfo()));
  }, [usesMyIr]);
  return (
    <div className="cab-sim-ui" role="group" aria-label={ko.pedal.cab.controls}>
      <div className="cab-grille" aria-hidden="true">
        <span />
        <strong>CAB SIM</strong>
        <em>Speaker &amp; Mic</em>
      </div>

      <label className="cab-model-control">
        <span>캐비닛 모델</span>
        <select
          value={params.model}
          onChange={(event) => onChange('model', event.currentTarget.value as CabParams['model'])}
        >
          {cabModels.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      </label>

      <div className="cab-custom-ir">
        {/* 브라우저 기본 파일 버튼('Choose File / No file chosen')은 브라우저 언어를 따라 영어로 나온다. 입력은 숨기고 한국어 버튼이 대신 연다(S4.6). */}
        <button type="button" className="secondary-button" disabled={irLoading} onClick={() => irInputRef.current?.click()}>
          {ko.cabinetIr.ui.loadButton}
        </button>
        <input ref={irInputRef} className="hidden-file-input" type="file" accept=".wav,audio/wav" disabled={irLoading}
          aria-label={ko.cabinetIr.ui.fileLabel} tabIndex={-1} onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setIrError(''); setIrNotPersisted(false); setIrLoading(true);
            try {
              const { persisted } = await AudioEngine.getInstance().importCabinetIr(file);
              setIrNotPersisted(!persisted);
              // 올리자마자 적용: 새 IR 을 쓰도록 모델을 '내 IR' 로 바꾼다(이미 '내 IR' 이면 IR 만 바뀐다).
              if (params.model !== 'my-ir') onChange('model', 'my-ir');
            }
            catch (error) { setIrError(error instanceof Error ? error.message : ko.cabinetIr.loadFailed); }
            finally { setIrLoading(false); }
          }} />
        {irInfo && <p>{ko.cabinetIr.ui.inUse(irInfo.name)}</p>}
        {irInfo?.cut && <small role="status">{ko.cabinetIr.ui.cutNotice(irInfo.originalSeconds)}</small>}
        {irInfo && <small>{irNotPersisted ? ko.cabinetIr.ui.notPersisted : ko.cabinetIr.ui.stored}</small>}
        {usesMyIr && !irInfo && <small role="status">{ko.cabinetIr.ui.missing}</small>}
        {usesMyIr && irInfo && <small>{ko.cabinetIr.ui.knobsNote}</small>}
        {irInfo && (
          <button type="button" onClick={async () => {
            setIrNotPersisted(false);
            await AudioEngine.getInstance().removeCabinetIr();
            if (usesMyIr) onChange('model', MODEL_AFTER_IR_DELETE);
          }}>{ko.cabinetIr.ui.deleteButton}</button>
        )}
        <small>{ko.cabinetIr.ui.limits}</small>
        <small>{ko.cabinetIr.ui.licenseNotice}</small>
        {irError && <p role="alert">{irError}</p>}
      </div>

      <div className="cab-knob-grid">
        <SliderControl
          label="마이크 위치"
          value={params.micPosition}
          defaultValue={knobDefault('cab', 'micPosition')}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.micPosition)}%`}
          onChange={(value) => onChange('micPosition', value)}
        />
        <SliderControl
          label="거리"
          value={params.distance}
          defaultValue={knobDefault('cab', 'distance')}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.distance)}%`}
          onChange={(value) => onChange('distance', value)}
        />
        <SliderControl
          label="프레즌스"
          value={params.presence}
          defaultValue={knobDefault('cab', 'presence')}
          min={-6}
          max={6}
          step={0.1}
          displayValue={`${params.presence > 0 ? '+' : ''}${params.presence.toFixed(1)} dB`}
          onChange={(value) => onChange('presence', value)}
        />
        <SliderControl
          label="믹스"
          value={params.mix}
          defaultValue={knobDefault('cab', 'mix')}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.mix)}%`}
          onChange={(value) => onChange('mix', value)}
        />
        <SliderControl
          label="레벨"
          value={params.level}
          defaultValue={knobDefault('cab', 'level')}
          min={0}
          max={200}
          step={1}
          displayValue={`${Math.round(params.level)}%`}
          onChange={(value) => onChange('level', value)}
        />
      </div>

      <div className="cab-filter-grid">
        <CabRangeControl
          label="로우 컷"
          value={params.lowCut}
          defaultValue={knobDefault('cab', 'lowCut')}
          min={40}
          max={200}
          step={1}
          displayValue={`${Math.round(params.lowCut)} Hz`}
          onChange={(value) => onChange('lowCut', value)}
        />
        <CabRangeControl
          label="하이 컷"
          value={params.highCut}
          defaultValue={knobDefault('cab', 'highCut')}
          min={3000}
          max={12000}
          step={100}
          displayValue={`${(params.highCut / 1000).toFixed(1)} kHz`}
          onChange={(value) => onChange('highCut', value)}
        />
      </div>

      <p className="cab-mic-legend">
        <span>가장자리 · 부드러움</span>
        <span>중앙 · 선명함</span>
      </p>
    </div>
  );
}

interface CabRangeControlProps {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}

function CabRangeControl({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  displayValue,
  onChange,
}: CabRangeControlProps) {
  const { name: accessibleName, tip } = useParamNames(label);
  return (
    <div className="cab-range-control">
      <span>
        <strong title={tip}>{label}</strong>
        <output>{displayValue}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={accessibleName}
        aria-valuetext={`${accessibleName} ${displayValue}`}
        onDoubleClick={() => onChange(defaultValue)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <KnobNumberInput label={accessibleName} value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}
