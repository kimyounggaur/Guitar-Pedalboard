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

function midiToFrequency(midi: number, referenceHz = 440): number {
  return referenceHz * Math.pow(2, (midi - 69) / 12);
}

function target(note: string, midi: number): TuningTarget {
  return { note, midi, frequency: midiToFrequency(midi) };
}

export const TUNING_PRESETS: Record<TuningPresetId, TuningPresetDefinition> = {
  chromatic: { id: 'chromatic', label: '크로매틱', targets: [] },
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

/** 기타 모드에서 고를 수 있는 튜닝(크로매틱은 모드 전환 버튼으로 따로 고른다) */
export const GUITAR_TUNING_OPTIONS = (['standard', 'drop-d', 'half-step-down', 'open-g'] as const).map(
  (id) => TUNING_PRESETS[id],
);

/** 어떤 줄의 목표음(또는 그 옥타브 위 음)에서 이만큼 안이면 '그 음'으로 본다 */
export const OCTAVE_MATCH_TOLERANCE_CENTS = 50;
/** 가장 가까운 줄이 이보다 멀면 어느 줄인지 알 수 없다 */
export const STRING_CHECK_CENTS = 600;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * 들린 주파수를 읽는다.
 *  - 크로매틱: 가장 가까운 반음(음이름 + 옥타브)과 센트 차이.
 *  - 기타: **옥타브를 접지 않고** 센트 거리가 가장 가까운 줄을 고른다(D2 → 6번 줄 E2, 200센트 낮음).
 *    줄의 목표음에서 한두 옥타브 위에 정확히 얹히면(E3 → 6번 줄 E2 의 한 옥타브 위) `octavesAbove` 로 알리고 cents 는 그 음과의 차이다.
 *    가장 가까운 줄과도 600센트 넘게 떨어지면 줄을 정하지 않고 `checkString` 으로 알린다.
 */
export function getPitchReading(
  frequency: number | null,
  presetId: TuningPresetId,
  referenceHz = 440,
): PitchReading {
  if (frequency === null || !Number.isFinite(frequency) || frequency <= 0) {
    return { frequency: null, note: null, cents: 0 };
  }

  const reference = Number.isFinite(referenceHz) && referenceHz >= 400 && referenceHz <= 480 ? referenceHz : 440;
  const midi = Math.round(69 + 12 * Math.log2(frequency / reference));
  const note = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  if (presetId === 'chromatic') {
    return { frequency, note, cents: 1200 * Math.log2(frequency / midiToFrequency(midi, reference)) };
  }

  const scale = reference / 440;
  const strings = TUNING_PRESETS[presetId].targets.map((candidate, index) => {
    const targetFrequency = candidate.frequency * scale;
    return {
      target: candidate,
      stringNumber: 6 - index,
      cents: 1200 * Math.log2(frequency / targetFrequency),
      distance: Math.abs(frequency - targetFrequency),
    };
  });

  let nearest = strings[0];
  for (let index = 1; index < strings.length; index += 1) {
    const candidate = strings[index];
    const centsDifference = Math.abs(candidate.cents) - Math.abs(nearest.cents);
    if (
      centsDifference < -CENTS_TIE_EPSILON ||
      (Math.abs(centsDifference) <= CENTS_TIE_EPSILON && candidate.distance < nearest.distance)
    ) {
      nearest = candidate;
    }
  }

  // 어느 줄의 목표음과도 가깝지 않은데 어떤 줄의 옥타브 위 음에는 얹혀 있으면 '옥타브가 다르다'고 알린다.
  // 위로만 본다: 6번 줄을 한 음 내린 D2 처럼 아래 음은 제 줄의 낮춘 튜닝일 수 있어서 줄 판독(위)이 맞다.
  if (Math.abs(nearest.cents) > OCTAVE_MATCH_TOLERANCE_CENTS) {
    let match: { string: (typeof strings)[number]; octaves: number; deviation: number } | null = null;
    for (const candidate of strings) {
      const octaves = Math.round(candidate.cents / 1200);
      if (octaves < 1) continue;

      const deviation = candidate.cents - octaves * 1200;
      if (Math.abs(deviation) > OCTAVE_MATCH_TOLERANCE_CENTS) continue;

      // 가장 적게 올라간 줄로 안내한다(E5 는 6번 줄 E2 의 세 옥타브 위이기도 하지만 1번 줄 E4 의 한 옥타브 위로 말한다).
      // 기본 튜닝들에서 두 줄이 같은 음 ±100센트 안에 겹치는 일은 없어서 같은 단계의 동률은 생기지 않는다.
      if (match === null || octaves < match.octaves) {
        match = { string: candidate, octaves, deviation };
      }
    }

    if (match) {
      return {
        frequency,
        note,
        cents: match.deviation,
        targetNote: match.string.target.note,
        stringNumber: match.string.stringNumber,
        octavesAbove: match.octaves,
      };
    }
  }

  if (Math.abs(nearest.cents) > STRING_CHECK_CENTS) {
    return { frequency, note, cents: nearest.cents, checkString: true };
  }

  return {
    frequency,
    note,
    cents: nearest.cents,
    targetNote: nearest.target.note,
    stringNumber: nearest.stringNumber,
  };
}
