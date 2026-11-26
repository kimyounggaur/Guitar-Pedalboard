// 노브·페이더·숫자 입력의 접근성 이름(S4.6). 화면에 인쇄된 약어(`Threshold`, `D.Time` …)는 그대로 두고,
// 스크린 리더가 읽는 이름과 툴팁은 파라미터 스키마(설계서 4.9)의 한국어 `name` 에서 가져온다.
//   · 이름(aria-label) — `name` 의 괄호 앞 부분. 예: '문턱값(게이트가 열리는 세기)' → '문턱값'. 포커스할 때마다 읽히니 짧게 둔다.
//   · 툴팁(title) — `name` 전체. 괄호 안의 설명까지 보인다.
// 이미 한국어인 라벨(캐비닛의 '마이크 위치', 노이즈 게이트의 '간격')은 그대로 쓴다. 스키마에 없는 라벨은 라벨 글자 그대로다.
import { effectSchemas } from '../audio/params';
import type { EffectType } from '../audio/types';

const HANGUL = /[가-힣]/;

export interface ParamNames {
  /** 스크린 리더가 읽는 이름(짧게) */
  name: string;
  /** 마우스를 올렸을 때 나오는 풀이(전체) */
  tip: string;
}

/** `문턱값(게이트가 열리는 세기)` → `문턱값`. 괄호가 없으면 그대로. */
export function shortParamName(fullName: string): string {
  const short = fullName.replace(/\s*[(（].*$/, '').trim();
  return short === '' ? fullName : short;
}

export function paramNames(type: EffectType | null, label: string): ParamNames {
  if (type === null || HANGUL.test(label)) return { name: label, tip: label };
  const schema = effectSchemas[type];
  const definition = schema.params.find((item) => item.label === label) ?? schema.choices.find((item) => item.label === label);
  if (!definition) return { name: label, tip: label };
  return { name: shortParamName(definition.name), tip: definition.name };
}
