// 파라미터 스키마 모음(설계서 4.9). 이름·범위·단위·기본값·표시 형식은 여기서만 정의한다.
import type { EffectType } from '../types';
import { autoWahSchema } from './definitions/autoWah';
import { cabSchema } from './definitions/cab';
import { chorusSchema } from './definitions/chorus';
import { compressorSchema } from './definitions/compressor';
import { crunchSchema } from './definitions/crunch';
import { delaySchema } from './definitions/delay';
import { driveSchema } from './definitions/drive';
import { eqSchema } from './definitions/eq';
import { flangerSchema } from './definitions/flanger';
import { fuzzSchema } from './definitions/fuzz';
import { graphicEQSchema } from './definitions/graphicEQ';
import { noiseGateSchema } from './definitions/noiseGate';
import { phaserSchema } from './definitions/phaser';
import { reverbSchema } from './definitions/reverb';
import { tremoloSchema } from './definitions/tremolo';
import type { ChoiceDef, EffectSchema, ParamDef } from './types';

export type { ChoiceDef, ChoiceOption, EffectSchema, ParamDef, ParamTaper, ParamUnit } from './types';

/** 기본 페달 순서(설계서 4.x)와 같다. */
export const effectSchemas: Readonly<Record<EffectType, EffectSchema>> = {
  noiseGate: noiseGateSchema,
  compressor: compressorSchema,
  autoWah: autoWahSchema,
  drive: driveSchema,
  crunch: crunchSchema,
  fuzz: fuzzSchema,
  graphicEQ: graphicEQSchema,
  eq: eqSchema,
  cab: cabSchema,
  chorus: chorusSchema,
  flanger: flangerSchema,
  phaser: phaserSchema,
  tremolo: tremoloSchema,
  delay: delaySchema,
  reverb: reverbSchema,
};

export function getEffectSchema(type: EffectType): EffectSchema {
  return effectSchemas[type];
}

/** 정의가 없으면 undefined(알 수 없는 키는 그대로 두어야 하는 곳에서 쓴다). */
export function findParamDef(type: EffectType, key: string): ParamDef | undefined {
  return effectSchemas[type]?.params.find((definition) => definition.key === key);
}

/** 정의가 없으면 오류. 화면이 이미 있는 조절기의 정의를 읽을 때 쓴다. */
export function getParamDef(type: EffectType, key: string): ParamDef {
  const definition = findParamDef(type, key);
  if (!definition) throw new Error(`파라미터 정의가 없습니다: ${type}.${key}`);
  return definition;
}

export function findChoiceDef(type: EffectType, key: string): ChoiceDef | undefined {
  return effectSchemas[type]?.choices.find((definition) => definition.key === key);
}

/** 저장값을 화면에 보이는 문자열로 바꾼다. format 이 없으면 `${값}${단위}`. */
export function formatParamValue(definition: ParamDef, value: number): string {
  return definition.format ? definition.format(value) : `${Number(value.toFixed(2))}${definition.unit}`;
}

/** 값을 정의의 범위 안으로 자른다(눈금에 맞추지는 않는다). 숫자가 아니면 기본값. */
export function clampToParamDef(definition: ParamDef, value: number): number {
  if (!Number.isFinite(value)) return definition.default;
  return Math.min(definition.max, Math.max(definition.min, value));
}

/**
 * 한 이펙트의 저장 params 에서 범위를 벗어난 숫자를 정의의 범위 안으로 맞춘다(M3).
 *   · 정의가 있는 키의 **유한한 숫자**만 건드린다. 문자열·불리언·알 수 없는 키(M7)는 그대로 둔다.
 *   · 아무것도 바꿀 게 없으면 받은 객체를 그대로 돌려준다.
 */
export function clampParamsToSchema<T extends Record<string, unknown>>(type: EffectType, params: T): T {
  const schema = effectSchemas[type];
  if (!schema) return params;

  let next: Record<string, unknown> | null = null;
  for (const definition of schema.params) {
    const value = params[definition.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const clamped = clampToParamDef(definition, value);
    if (clamped === value) continue;
    next ??= { ...params };
    next[definition.key] = clamped;
  }
  return (next ?? params) as T;
}
