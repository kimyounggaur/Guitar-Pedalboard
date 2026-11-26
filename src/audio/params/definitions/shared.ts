// 정의 파일들이 같이 쓰는 만들기 도우미와 화면 표시 형식.
// 표시 형식(fmt*)은 지금 화면이 그리는 문자열과 글자 하나까지 같아야 한다(e2e 가 화면과 맞춰 본다).
import type { ChoiceDef, ChoiceOption, ParamDef } from '../types';

type ParamInput = Omit<ParamDef, 'taper'> & { taper?: ParamDef['taper'] };

/** 숫자 조절기 정의를 만든다. 노브 곡선(taper)을 적지 않으면 지금 화면과 같은 'linear' 다. */
export function param(def: ParamInput): ParamDef {
  return { taper: 'linear', ...def };
}

export function choice(def: ChoiceDef): ChoiceDef {
  return def;
}

/** 화면 글자와 저장값이 같은 선택지(예: sine → 'sine'). */
export function sameLabelOptions(values: readonly (string | number)[]): ChoiceOption[] {
  return values.map((value) => ({ value, label: String(value) }));
}

// ── 화면 표시 형식 ────────────────────────────────────────────────────────────
/** 정수 퍼센트: 45 → '45%' */
export const fmtPercent = (value: number): string => `${Math.round(value)}%`;
/** SliderControl 의 기본 표시: 소수 둘째 자리까지 쓰고 뒤에 단위를 붙인다. 예: ' dB' → '-80 dB' */
export const fmtSlider = (unit: string) => (value: number): string => `${Number(value.toFixed(2))}${unit}`;
/** 정수에 단위: ' ms' → '180 ms' */
export const fmtRounded = (unit: string) => (value: number): string => `${Math.round(value)}${unit}`;
/** 소수 n 자리에 단위: (1, ' Hz') → '0.8 Hz' */
export const fmtFixed = (digits: number, unit: string) => (value: number): string => `${value.toFixed(digits)}${unit}`;
/** 부호를 붙이는 dB: 3 → '+3 dB', 0 → '0 dB' (Graphic EQ) */
export const fmtSignedDb = (value: number): string => {
  const rounded = Number(value.toFixed(1));
  return `${rounded > 0 ? '+' : ''}${rounded} dB`;
};

// ── 모든 이펙트에 있는 공통 조절기 ─────────────────────────────────────────────
/** 모든 이펙트의 Mix 는 0~100 % 다. 기본값과 화면 이름만 이펙트마다 다르다. */
export function mixParam(defaultValue: number, label = 'Mix'): ParamDef {
  return param({
    key: 'mix',
    label,
    name: '믹스(원음과 섞는 비율)',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: defaultValue,
    format: fmtPercent,
  });
}

/** 이펙트의 출력 음량. 화면 범위는 이펙트마다 0~100 또는 0~200 이다. */
export function levelParam(defaultValue: number, max: 100 | 200, label = 'Level', hidden = false): ParamDef {
  return param({
    key: 'level',
    label,
    name: '출력 레벨',
    unit: '%',
    min: 0,
    max,
    step: 1,
    default: defaultValue,
    format: fmtPercent,
    ...(hidden ? { hidden: true } : {}),
  });
}

/** 0~100 % 인 일반 조절기 */
export function percentParam(key: string, label: string, name: string, defaultValue: number): ParamDef {
  return param({ key, label, name, unit: '%', min: 0, max: 100, step: 1, default: defaultValue, format: fmtPercent });
}
