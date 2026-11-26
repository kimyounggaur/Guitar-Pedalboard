import { createContext, useContext } from 'react';
import type { EffectType } from '../audio/types';
import { paramNames, type ParamNames } from '../i18n/paramName';

/** 지금 그리는 페달의 종류. 페달 카드가 감싸 주고, 노브는 이 종류의 스키마에서 한국어 이름을 찾는다(S4.6). */
const PedalTypeContext = createContext<EffectType | null>(null);

export const ParamScope = PedalTypeContext.Provider;

/** 노브·페이더에 인쇄된 약어(`label`) → 스크린 리더 이름과 툴팁. 페달 카드 밖이면 라벨 그대로다. */
export function useParamNames(label: string): ParamNames {
  return paramNames(useContext(PedalTypeContext), label);
}
