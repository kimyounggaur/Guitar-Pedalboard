import { initialPedals } from '../store/pedalStore';
import type { PedalType } from '../audio/types';

export function knobDefault(type: PedalType, key: string): number {
  const params = initialPedals.find((pedal) => pedal.type === type)?.params as unknown as Record<string, unknown> | undefined;
  const value = params?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid knob default: ${type}.${key}`);
  return value;
}
