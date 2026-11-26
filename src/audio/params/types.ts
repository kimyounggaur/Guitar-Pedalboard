// 파라미터 스키마(설계서 4.9, S2.2) — 이펙트 조절기의 이름·범위·단위·기본값·표시 형식을 한 곳에서 정의한다.
//
// 값의 단위에 관해(헷갈리기 쉬운 곳):
//   · min·max·step·default 는 **저장값**의 단위다(프리셋·저장소·엔진이 보는 값).
//   · unit 과 format 은 **화면**이 보여 주는 단위·문자열이다.
//   · 둘이 다른 곳은 format 이 바꿔 준다. 예: Compressor attack 은 초(0.006)로 저장하고 '6 ms' 로 보인다.
//     Delay feedback 은 0~0.95 로 저장하고 '34%' 로 보인다(그리고 그 슬라이더만 화면 값이 저장값의 100배다: sliderScale).
//   · 저장 키(key)는 어떤 경우에도 바꾸지 않는다. 바꾸면 저장된 프리셋이 깨진다. 이름(label)만 바꿀 수 있다.
import type { EffectType } from '../types';

/** 화면에 보이는 단위. 단위가 없는 값(Drive Bias, EQ Mid Q 등)은 ''. */
export type ParamUnit = 'dB' | 'Hz' | 'ms' | 's' | '%' | ':1' | '';

/**
 * 노브 위치 ↔ 값 곡선. 지금 화면의 노브는 모두 선형이라 모든 정의가 'linear' 다(소리·조작감 변화 0).
 * 'log'·'audio' 는 S3.1(Drive Bias)·S4.4(노브 조작법)가 이 값을 바꾸면서 쓰기 시작한다.
 */
export type ParamTaper = 'linear' | 'log' | 'audio';

export interface ParamDef {
  /** 저장 키 — 바꾸지 않는다. */
  key: string;
  /** 화면에 그려지는 이름(슬라이더의 접근 가능한 이름과 같다). 예: 'Low Cut' */
  label: string;
  /** 전체 이름(툴팁·설명용 한국어). 예: '로우컷 주파수' */
  name: string;
  unit: ParamUnit;
  min: number;
  max: number;
  step: number;
  default: number;
  taper: ParamTaper;
  /** 저장값 → 화면에 보이는 값 문자열. 없으면 `${값}${unit}` 으로 보인다. */
  format?: (value: number) => string;
  /** 이 조건이면 조절기를 막는다(흐리게 + 조작 불가). 예: Delay Sync 가 켜지면 D.Time. */
  disabledWhen?: (params: Record<string, unknown>) => boolean;
  /**
   * 화면의 슬라이더 값 = 저장값 × sliderScale (기본 1). 지금은 Delay F.Back(저장 0~0.95, 슬라이더 0~95) 하나뿐이다.
   * S4.4 에서 노브가 스키마를 직접 읽게 되면 사라질 값이다.
   */
  sliderScale?: number;
  /** true 면 화면에 조절기가 없다(프리셋·엔진만 쓰는 값). 예: Delay level. */
  hidden?: boolean;
}

export interface ChoiceOption {
  /** 저장값 */
  value: string | number;
  /** 화면에 보이는 글자 */
  label: string;
}

/** 고르는 값(select·버튼·스위치)의 정의. 숫자 조절기가 아니라 ParamDef 와 따로 둔다. */
export interface ChoiceDef {
  key: string;
  label: string;
  name: string;
  kind: 'enum' | 'boolean';
  /** enum 일 때만 있다. 순서는 화면의 순서다. */
  options?: readonly ChoiceOption[];
  default: string | number | boolean;
  hidden?: boolean;
}

export interface EffectSchema {
  type: EffectType;
  params: readonly ParamDef[];
  /** select·버튼·스위치로 고르는 값. 없으면 빈 배열이다. */
  choices: readonly ChoiceDef[];
  /** 꺼진 페달의 Mix 가 0 이면 이 값으로 되돌린다(M2). mix 정의의 기본값과 같다. */
  defaultMix?: number;
}
