import type { PitchReading, TuningPresetId } from '../types';

const CENTS_TIE_EPSILON = 1e-7;

export interface TuningTarget {
  note: string;
  midi: number;
  frequency: number;
}

export interface TuningPresetDefinition {
  id: TuningPresetId;
  label: string;
  targets: readonly TuningTarget[];
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function target(note: string, midi: number): TuningTarget {
  return { note, midi, frequency: midiToFrequency(midi) };
}

export const TUNING_PRESETS: Record<TuningPresetId, TuningPresetDefinition> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    targets: [
      target('E2', 40),
      target('A2', 45),
      target('D3', 50),
      target('G3', 55),
      target('B3', 59),
      target('E4', 64),
    ],
  },
  'drop-d': {
    id: 'drop-d',
    label: 'Drop D',
    targets: [
      target('D2', 38),
      target('A2', 45),
      target('D3', 50),
      target('G3', 55),
      target('B3', 59),
      target('E4', 64),
    ],
  },
  'half-step-down': {
    id: 'half-step-down',
    label: 'Half Step Down',
    targets: [
      target('D#2', 39),
      target('G#2', 44),
      target('C#3', 49),
      target('F#3', 54),
      target('A#3', 58),
      target('D#4', 63),
    ],
  },
  'open-g': {
    id: 'open-g',
    label: 'Open G',
    targets: [
      target('D2', 38),
      target('G2', 43),
      target('D3', 50),
      target('G3', 55),
      target('B3', 59),
      target('D4', 62),
    ],
  },
};

export const TUNING_PRESET_OPTIONS = (
  ['standard', 'drop-d', 'half-step-down', 'open-g'] as const
).map((id) => TUNING_PRESETS[id]);

export function getPitchReading(
  frequency: number | null,
  presetId: TuningPresetId,
): PitchReading {
  if (frequency === null || !Number.isFinite(frequency) || frequency <= 0) {
    return { frequency: null, note: null, cents: 0 };
  }

  const targets = TUNING_PRESETS[presetId].targets;
  let nearest = targets[0];
  let nearestCents = getOctaveWrappedCents(frequency, nearest.frequency);
  let nearestFrequencyDistance = Math.abs(frequency - nearest.frequency);

  for (let index = 1; index < targets.length; index += 1) {
    const candidate = targets[index];
    const candidateCents = getOctaveWrappedCents(frequency, candidate.frequency);
    const candidateFrequencyDistance = Math.abs(frequency - candidate.frequency);
    const centsDifference = Math.abs(candidateCents) - Math.abs(nearestCents);

    if (
      centsDifference < -CENTS_TIE_EPSILON ||
      (Math.abs(centsDifference) <= CENTS_TIE_EPSILON &&
        candidateFrequencyDistance < nearestFrequencyDistance)
    ) {
      nearest = candidate;
      nearestCents = candidateCents;
      nearestFrequencyDistance = candidateFrequencyDistance;
    }
  }

  return {
    frequency,
    note: nearest.note,
    cents: nearestCents,
  };
}

function getOctaveWrappedCents(frequency: number, targetFrequency: number): number {
  const rawCents = 1200 * Math.log2(frequency / targetFrequency);
  return rawCents - Math.round(rawCents / 1200) * 1200;
}
