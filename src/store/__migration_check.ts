import {
  AUTO_WAH_MAX_DETUNE_CENTS,
  AUTO_WAH_MAX_FREQUENCY,
  AUTO_WAH_MAX_Q,
  AUTO_WAH_MIN_FREQUENCY,
  AUTO_WAH_MIN_Q,
  getAutoWahAutoMaximumFrequency,
  getAutoWahDetuneRange,
  getAutoWahManualFrequency,
  getAutoWahResonanceQ,
  normalizeAutoWahParams,
} from '../audio/nodes/AutoWahEffect';
import {
  CHORUS_LFO_BANK_SIZE,
  CHORUS_VOICE_BANK_SIZE,
  normalizeChorusParams,
} from '../audio/nodes/ChorusEffect';
import { FLANGER_MAX_FEEDBACK, normalizeFlangerParams } from '../audio/nodes/FlangerEffect';
import {
  GRAPHIC_EQ_BAND_KEYS,
  GRAPHIC_EQ_FREQUENCIES,
  GRAPHIC_EQ_Q,
  normalizeGraphicEQParams,
} from '../audio/nodes/GraphicEQEffect';
import {
  getPhaserSweep,
  getPhaserWetMakeup,
  normalizePhaserParams,
  PHASER_CENTER_FREQUENCY,
  PHASER_MAX_FEEDBACK,
  PHASER_MAX_FREQUENCY,
  PHASER_MIN_FREQUENCY,
  PHASER_STAGE_OPTIONS,
} from '../audio/nodes/PhaserEffect';
import {
  getTremoloGainBounds,
  getTremoloRate,
  normalizeTremoloParams,
  TREMOLO_LFO_BANK_SIZE,
  TREMOLO_SQUARE_SLEW_SECONDS,
} from '../audio/nodes/TremoloEffect';
import type {
  AutoWahParams,
  ChorusParams,
  PhaserParams,
  Preset,
  TremoloParams,
} from '../audio/types';
import {
  clonePedals,
  initialPedals,
  migrateStoredState,
  SCHEMA_VERSION,
  type StoredState,
} from './pedalStore';
import { defaultPresets, parsePresetJson, serializePresetPayload } from './presetStore';

const legacySamples = [
  JSON.stringify({
    version: 1,
    pedals: [
      {
        id: 'noise-gate',
        enabled: true,
        bypassed: false,
        params: { bypassed: false, mix: 1, level: 0.8, threshold: -48, release: 0.24 },
      },
    ],
  }),
  JSON.stringify({
    version: 1,
    pedals: [
      {
        id: 'eq',
        enabled: true,
        bypassed: false,
        params: { mix: 1, level: 1, low: 2, mid: -1, high: 3 },
      },
      {
        id: 'delay',
        enabled: true,
        bypassed: true,
        params: { mix: 0.3, level: 1, time: 0.42, tone: 0.5 },
      },
    ],
  }),
  JSON.stringify({
    version: 1,
    pedals: [
      {
        id: 'reverb',
        enabled: true,
        bypassed: true,
        params: { mix: 0.25, level: 1, tone: 0.6 },
      },
      {
        id: 'drive',
        enabled: true,
        bypassed: false,
        params: { mix: 0.88, level: 0.95, drive: 0.42, tone: 0.55 },
      },
      {
        id: 'fuzz',
        enabled: true,
        bypassed: true,
        params: { mix: 0.9, level: 0.9, fuzz: 0.6, tone: 0.55, bias: 0.5, gate: 0.15 },
      },
    ],
  }),
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`페달 마이그레이션 검증 실패: ${message}`);
}

function createCurrentPreset(): Preset {
  const pedals = clonePedals(initialPedals).map((pedal) => {
    if (pedal.id === 'compressor') {
      return {
        ...pedal,
        params: { ...pedal.params, mix: 1, level: 2, attack: 0.006 },
      } as typeof pedal;
    }

    if (pedal.id === 'delay') {
      return {
        ...pedal,
        params: { ...pedal.params, trails: false },
      } as typeof pedal;
    }

    if (pedal.id === 'graphic-eq') {
      return {
        ...pedal,
        params: {
          ...pedal.params,
          mix: 91,
          level: 111,
          band100: -7.5,
          band800: 3.5,
          band6400: 12,
        },
      } as typeof pedal;
    }

    return pedal;
  });

  return {
    id: 'migration-check-current',
    name: 'Migration Check Current',
    pedals,
    updatedAt: 1,
  };
}

function assertCurrentPresetPreserved(preset: Preset | undefined, label: string): void {
  const compressor = preset?.pedals.find((pedal) => pedal.id === 'compressor');
  const autoWah = preset?.pedals.find((pedal) => pedal.id === 'auto-wah');
  const cab = preset?.pedals.find((pedal) => pedal.id === 'cab');
  const chorus = preset?.pedals.find((pedal) => pedal.id === 'chorus');
  const flanger = preset?.pedals.find((pedal) => pedal.id === 'flanger');
  const graphicEQ = preset?.pedals.find((pedal) => pedal.id === 'graphic-eq');
  const phaser = preset?.pedals.find((pedal) => pedal.id === 'phaser');
  const tremolo = preset?.pedals.find((pedal) => pedal.id === 'tremolo');
  const delay = preset?.pedals.find((pedal) => pedal.id === 'delay');

  assert(compressor?.params.mix === 1, `${label} Mix 1% 보존`);
  assert(compressor?.params.level === 2, `${label} Level 2% 보존`);
  assert(compressor?.params.attack === 0.006, `${label} Attack 보존`);
  assert(
    autoWah?.bypassed === true &&
      autoWah.params.sensitivity === 55 &&
      autoWah.params.range === 60 &&
      autoWah.params.resonance === 45 &&
      autoWah.params.mode === 'auto' &&
      autoWah.params.manual === 50,
    `${label} Auto Wah 기본값 보존`,
  );
  assert(cab?.params.model === 'v30-4x12', `${label} Cab 보존`);
  assert(
    chorus?.bypassed === true &&
      chorus.params.voices === 3 &&
      chorus.params.depth === 45,
    `${label} Chorus 기본값 보존`,
  );
  assert(
    flanger?.bypassed === true &&
      flanger.params.rate === 0.25 &&
      flanger.params.feedback === 60,
    `${label} Flanger 기본값 보존`,
  );
  assert(
    graphicEQ?.bypassed === true &&
      graphicEQ.params.mix === 91 &&
      graphicEQ.params.level === 111 &&
      graphicEQ.params.band100 === -7.5 &&
      graphicEQ.params.band800 === 3.5 &&
      graphicEQ.params.band6400 === 12,
    `${label} Graphic EQ 값 보존`,
  );
  assert(
    phaser?.bypassed === true &&
      phaser.params.rate === 0.5 &&
      phaser.params.stages === 6 &&
      phaser.params.feedback === 40,
    `${label} Phaser 기본값 보존`,
  );
  assert(
    tremolo?.bypassed === true &&
      tremolo.params.rate === 5 &&
      tremolo.params.depth === 50 &&
      tremolo.params.shape === 'sine' &&
      tremolo.params.sync === false &&
      tremolo.params.bpm === 120 &&
      tremolo.params.division === '1/8',
    `${label} Tremolo 기본값 보존`,
  );
  assert(delay?.params.trails === false, `${label} Trails 보존`);
}

export function runMigrationChecks(): void {
  const [gateState, timingState, toneState] = legacySamples.map((sample) =>
    migrateStoredState(JSON.parse(sample) as StoredState),
  );

  const gate = gateState.pedals[0];
  assert(gateState.version === 10, '스키마 버전');
  assert(gate.params.thresholdDb === -48, 'Noise Gate threshold 변환');
  assert(gate.params.releaseMs === 240, 'Noise Gate release 변환');
  assert(gate.params.mix === 100 && gate.params.level === 80, '공통 퍼센트 변환');

  const eq = timingState.pedals.find((pedal) => pedal.id === 'eq');
  const delay = timingState.pedals.find((pedal) => pedal.id === 'delay');
  assert(eq?.params.bassGain === 2 && eq.params.midGain === -1, 'EQ 별칭 변환');
  assert(delay?.params.timeMs === 420 && delay.params.tone === 50, 'Delay 변환');
  assert(
    timingState.pedals.map((pedal) => pedal.id).join(',') ===
      'auto-wah,graphic-eq,eq,cab,chorus,flanger,phaser,tremolo,delay',
    'Auto Wah, Graphic EQ, Cab, Chorus, Flanger, Phaser 및 Tremolo 기본 위치 삽입',
  );

  const reverb = toneState.pedals.find((pedal) => pedal.id === 'reverb');
  const drive = toneState.pedals.find((pedal) => pedal.id === 'drive');
  const fuzz = toneState.pedals.find((pedal) => pedal.id === 'fuzz');
  assert(reverb?.params.highCut === 7600, 'Reverb tone 변환');
  assert(drive?.params.drive === 42 && drive.params.tone === 55, 'Drive 퍼센트 변환');
  assert(fuzz?.params.fuzz === 60 && fuzz.params.gate === 15, 'Fuzz 퍼센트 변환');

  [...gateState.pedals, ...timingState.pedals, ...toneState.pedals].forEach((pedal) => {
    assert(!('bypass' in pedal.params) && !('bypassed' in pedal.params), 'bypass 중복 필드 제거');
  });

  const versionTwoWithoutCab = migrateStoredState({
    version: 2,
    pedals: [
      { id: 'eq', enabled: true, bypassed: false, params: { mix: 100, level: 100 } },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });
  const versionTwoWithCab = migrateStoredState({
    version: 2,
    pedals: [
      { id: 'eq', enabled: true, bypassed: false, params: { mix: 100, level: 100 } },
      {
        id: 'cab',
        enabled: true,
        bypassed: false,
        params: { mix: 100, level: 100, model: 'blue-1x12' },
      },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });

  assert(versionTwoWithoutCab.version === 10, 'v2에서 최신 버전 전환');
  assert(
    versionTwoWithoutCab.pedals.map((pedal) => pedal.id).join(',') ===
      'auto-wah,graphic-eq,eq,cab,chorus,flanger,phaser,tremolo,delay',
    'v2 Auto Wah, Graphic EQ, Cab, Chorus, Flanger, Phaser 및 Tremolo 기본 위치',
  );
  assert(
    versionTwoWithoutCab.pedals.find((pedal) => pedal.id === 'cab')?.params.model === 'v30-4x12',
    'Cab 기본 파라미터',
  );
  assert(
    versionTwoWithCab.pedals.filter((pedal) => pedal.id === 'cab').length === 1 &&
      versionTwoWithCab.pedals.find((pedal) => pedal.id === 'cab')?.params.model === 'blue-1x12',
    '기존 Cab 보존 및 중복 방지',
  );

  const versionThreeTrails = migrateStoredState({
    version: 3,
    pedals: [
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
      {
        id: 'reverb',
        enabled: true,
        bypassed: true,
        params: { mix: 25, level: 100, trails: false },
      },
    ],
  });

  assert(versionThreeTrails.version === 10, 'v3에서 최신 버전 전환');
  assert(
    versionThreeTrails.pedals.find((pedal) => pedal.id === 'delay')?.params.trails === true,
    'Delay Trails 기본값',
  );
  assert(
    versionThreeTrails.pedals.find((pedal) => pedal.id === 'reverb')?.params.trails === false,
    '기존 Reverb Trails 값 보존',
  );

  const versionFourWithoutChorus = migrateStoredState({
    version: 4,
    pedals: [
      { id: 'cab', enabled: true, bypassed: false, params: { mix: 100, level: 100 } },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });
  const versionFourWithChorus = migrateStoredState({
    version: 4,
    pedals: [
      { id: 'cab', enabled: true, bypassed: false, params: { mix: 100, level: 100 } },
      {
        id: 'chorus',
        enabled: true,
        bypassed: false,
        params: { mix: 72, level: 91, rate: 2.4, depth: 80, voices: 4 },
      },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });

  assert(versionFourWithoutChorus.version === 10, 'v4에서 최신 버전 전환');
  assert(
    versionFourWithoutChorus.pedals.map((pedal) => pedal.id).join(',') ===
      'auto-wah,graphic-eq,cab,chorus,flanger,phaser,tremolo,delay',
    'Auto Wah, Graphic EQ, Chorus, Flanger, Phaser와 Tremolo 기본 위치 삽입',
  );
  const insertedChorus = versionFourWithoutChorus.pedals.find(
    (pedal) => pedal.id === 'chorus',
  );
  assert(
    insertedChorus?.bypassed === true &&
      insertedChorus.params.mix === 35 &&
      insertedChorus.params.level === 100 &&
      insertedChorus.params.rate === 0.8 &&
      insertedChorus.params.depth === 45 &&
      insertedChorus.params.voices === 3 &&
      insertedChorus.params.spread === 60 &&
      insertedChorus.params.tone === 60,
    'Chorus 기본 파라미터',
  );
  assert(
    versionFourWithChorus.pedals.filter((pedal) => pedal.id === 'chorus').length === 1 &&
      versionFourWithChorus.pedals.find((pedal) => pedal.id === 'chorus')?.params.rate === 2.4 &&
      versionFourWithChorus.pedals.find((pedal) => pedal.id === 'chorus')?.bypassed === false,
    '기존 Chorus 보존 및 중복 방지',
  );

  const versionFiveWithoutFlanger = migrateStoredState({
    version: 5,
    pedals: [
      { id: 'chorus', enabled: true, bypassed: true, params: { mix: 35, level: 100 } },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });
  const versionFiveWithFlanger = migrateStoredState({
    version: 5,
    pedals: [
      { id: 'chorus', enabled: true, bypassed: true, params: { mix: 35, level: 100 } },
      {
        id: 'flanger',
        enabled: true,
        bypassed: false,
        params: {
          mix: 72,
          level: 91,
          rate: 1.4,
          depth: 82,
          feedback: -72,
          manual: 7.5,
        },
      },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });

  assert(versionFiveWithoutFlanger.version === 10, 'v5에서 최신 버전 전환');
  assert(
    versionFiveWithoutFlanger.pedals.map((pedal) => pedal.id).join(',') ===
      'auto-wah,graphic-eq,chorus,flanger,phaser,tremolo,delay',
    'Auto Wah, Graphic EQ, Flanger, Phaser와 Tremolo 기본 위치 삽입',
  );
  const insertedFlanger = versionFiveWithoutFlanger.pedals.find(
    (pedal) => pedal.id === 'flanger',
  );
  assert(
    insertedFlanger?.bypassed === true &&
      insertedFlanger.params.mix === 35 &&
      insertedFlanger.params.level === 100 &&
      insertedFlanger.params.rate === 0.25 &&
      insertedFlanger.params.depth === 55 &&
      insertedFlanger.params.feedback === 60 &&
      insertedFlanger.params.manual === 2,
    'Flanger 기본 파라미터',
  );
  const preservedFlanger = versionFiveWithFlanger.pedals.find(
    (pedal) => pedal.id === 'flanger',
  );
  assert(
    versionFiveWithFlanger.pedals.filter((pedal) => pedal.id === 'flanger').length === 1 &&
      preservedFlanger?.bypassed === false &&
      preservedFlanger.params.feedback === -72 &&
      preservedFlanger.params.manual === 7.5,
    '기존 Flanger 값 보존 및 중복 방지',
  );

  const versionSixWithoutPhaser = migrateStoredState({
    version: 6,
    pedals: [
      { id: 'flanger', enabled: true, bypassed: true, params: { mix: 35, level: 100 } },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });
  const versionSixWithPhaser = migrateStoredState({
    version: 6,
    pedals: [
      { id: 'flanger', enabled: true, bypassed: true, params: { mix: 35, level: 100 } },
      {
        id: 'phaser',
        enabled: true,
        bypassed: false,
        params: {
          mix: 61,
          level: 92,
          rate: 2.75,
          depth: 83,
          stages: 12,
          feedback: 74,
        },
      },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });

  assert(versionSixWithoutPhaser.version === 10, 'v6에서 최신 버전 전환');
  assert(
    versionSixWithoutPhaser.pedals.map((pedal) => pedal.id).join(',') ===
      'auto-wah,graphic-eq,flanger,phaser,tremolo,delay',
    'Auto Wah, Graphic EQ, Phaser와 Tremolo 기본 위치 삽입',
  );
  const insertedPhaser = versionSixWithoutPhaser.pedals.find(
    (pedal) => pedal.id === 'phaser',
  );
  assert(
    insertedPhaser?.bypassed === true &&
      insertedPhaser.params.mix === 45 &&
      insertedPhaser.params.level === 100 &&
      insertedPhaser.params.rate === 0.5 &&
      insertedPhaser.params.depth === 70 &&
      insertedPhaser.params.stages === 6 &&
      insertedPhaser.params.feedback === 40,
    'Phaser 기본 파라미터',
  );
  const preservedPhaser = versionSixWithPhaser.pedals.find(
    (pedal) => pedal.id === 'phaser',
  );
  assert(
    versionSixWithPhaser.pedals.filter((pedal) => pedal.id === 'phaser').length === 1 &&
      preservedPhaser?.bypassed === false &&
      preservedPhaser.params.rate === 2.75 &&
      preservedPhaser.params.stages === 12 &&
      preservedPhaser.params.feedback === 74,
    '기존 Phaser 값 보존 및 중복 방지',
  );

  const versionSevenWithoutTremolo = migrateStoredState({
    version: 7,
    pedals: [
      { id: 'phaser', enabled: true, bypassed: true, params: { mix: 45, level: 100 } },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });
  const versionSevenWithTremolo = migrateStoredState({
    version: 7,
    pedals: [
      { id: 'phaser', enabled: true, bypassed: true, params: { mix: 45, level: 100 } },
      {
        id: 'tremolo',
        enabled: true,
        bypassed: false,
        params: {
          mix: 84,
          level: 93,
          rate: 7.5,
          depth: 72,
          shape: 'square',
          sync: true,
          bpm: 138,
          division: '1/16',
        },
      },
      { id: 'delay', enabled: true, bypassed: true, params: { mix: 30, level: 100 } },
    ],
  });

  assert(versionSevenWithoutTremolo.version === 10, 'v7에서 최신 버전 전환');
  assert(
    versionSevenWithoutTremolo.pedals.map((pedal) => pedal.id).join(',') ===
      'auto-wah,graphic-eq,phaser,tremolo,delay',
    'Auto Wah, Graphic EQ 및 Tremolo 기본 위치 삽입',
  );
  const insertedTremolo = versionSevenWithoutTremolo.pedals.find(
    (pedal) => pedal.id === 'tremolo',
  );
  assert(
    insertedTremolo?.bypassed === true &&
      insertedTremolo.params.mix === 100 &&
      insertedTremolo.params.level === 100 &&
      insertedTremolo.params.rate === 5 &&
      insertedTremolo.params.depth === 50 &&
      insertedTremolo.params.shape === 'sine' &&
      insertedTremolo.params.sync === false &&
      insertedTremolo.params.bpm === 120 &&
      insertedTremolo.params.division === '1/8',
    'Tremolo 기본 파라미터',
  );
  const preservedTremolo = versionSevenWithTremolo.pedals.find(
    (pedal) => pedal.id === 'tremolo',
  );
  assert(
    versionSevenWithTremolo.pedals.filter((pedal) => pedal.id === 'tremolo').length === 1 &&
      preservedTremolo?.bypassed === false &&
      preservedTremolo.params.rate === 7.5 &&
      preservedTremolo.params.shape === 'square' &&
      preservedTremolo.params.sync === true &&
      preservedTremolo.params.bpm === 138 &&
      preservedTremolo.params.division === '1/16',
    '기존 Tremolo 값 보존 및 중복 방지',
  );

  const versionEightWithoutAutoWah = migrateStoredState({
    version: 8,
    pedals: [
      { id: 'compressor', enabled: true, bypassed: false, params: { mix: 75, level: 100 } },
      { id: 'drive', enabled: true, bypassed: false, params: { mix: 88, level: 95 } },
    ],
  });
  const versionEightWithAutoWah = migrateStoredState({
    version: 8,
    pedals: [
      { id: 'compressor', enabled: true, bypassed: false, params: { mix: 75, level: 100 } },
      {
        id: 'auto-wah',
        enabled: false,
        bypassed: false,
        params: {
          mix: 72,
          level: 93,
          sensitivity: 81,
          range: 33,
          resonance: 76,
          mode: 'manual',
          manual: 67,
        },
      },
      { id: 'drive', enabled: true, bypassed: false, params: { mix: 88, level: 95 } },
    ],
  });

  assert(versionEightWithoutAutoWah.version === 10, 'v8에서 최신 버전 전환');
  assert(
    versionEightWithoutAutoWah.pedals.map((pedal) => pedal.id).join(',') ===
      'compressor,auto-wah,drive,graphic-eq',
    'Auto Wah 및 Graphic EQ 삽입',
  );
  const insertedAutoWah = versionEightWithoutAutoWah.pedals.find(
    (pedal) => pedal.id === 'auto-wah',
  );
  assert(
    insertedAutoWah?.enabled === true &&
      insertedAutoWah.bypassed === true &&
      insertedAutoWah.params.mix === 100 &&
      insertedAutoWah.params.level === 100 &&
      insertedAutoWah.params.sensitivity === 55 &&
      insertedAutoWah.params.range === 60 &&
      insertedAutoWah.params.resonance === 45 &&
      insertedAutoWah.params.mode === 'auto' &&
      insertedAutoWah.params.manual === 50,
    'Auto Wah 기본 파라미터',
  );
  const preservedAutoWah = versionEightWithAutoWah.pedals.find(
    (pedal) => pedal.id === 'auto-wah',
  );
  assert(
    versionEightWithAutoWah.pedals.filter((pedal) => pedal.id === 'auto-wah').length === 1 &&
      preservedAutoWah?.enabled === false &&
      preservedAutoWah.bypassed === false &&
      preservedAutoWah.params.sensitivity === 81 &&
      preservedAutoWah.params.mode === 'manual' &&
      preservedAutoWah.params.manual === 67,
    '기존 Auto Wah 값 보존 및 중복 방지',
  );

  const versionNineWithoutGraphicEQ = migrateStoredState({
    version: 9,
    pedals: [
      { id: 'fuzz', enabled: true, bypassed: false, params: { mix: 90, level: 90 } },
      { id: 'eq', enabled: true, bypassed: false, params: { mix: 100, level: 100 } },
    ],
  });
  const versionNineWithGraphicEQ = migrateStoredState({
    version: 9,
    pedals: [
      { id: 'fuzz', enabled: true, bypassed: false, params: { mix: 90, level: 90 } },
      {
        id: 'graphic-eq',
        enabled: false,
        bypassed: false,
        params: {
          mix: 83,
          level: 117,
          band100: -8,
          band200: -4,
          band400: 2,
          band800: 4,
          band1600: 6,
          band3200: 8,
          band6400: 10,
        },
      },
      { id: 'eq', enabled: true, bypassed: false, params: { mix: 100, level: 100 } },
    ],
  });

  assert(versionNineWithoutGraphicEQ.version === 10, 'v9에서 v10 전환');
  assert(
    versionNineWithoutGraphicEQ.pedals.map((pedal) => pedal.id).join(',') ===
      'fuzz,graphic-eq,eq',
    'Graphic EQ Fuzz 뒤 기존 EQ 앞 삽입',
  );
  const insertedGraphicEQ = versionNineWithoutGraphicEQ.pedals.find(
    (pedal) => pedal.id === 'graphic-eq',
  );
  assert(
    insertedGraphicEQ?.enabled === true &&
      insertedGraphicEQ.bypassed === true &&
      insertedGraphicEQ.params.mix === 100 &&
      insertedGraphicEQ.params.level === 100 &&
      GRAPHIC_EQ_BAND_KEYS.every((key) => insertedGraphicEQ.params[key] === 0),
    'Graphic EQ 기본 파라미터',
  );
  const preservedGraphicEQ = versionNineWithGraphicEQ.pedals.find(
    (pedal) => pedal.id === 'graphic-eq',
  );
  assert(
    versionNineWithGraphicEQ.pedals.filter((pedal) => pedal.id === 'graphic-eq').length === 1 &&
      preservedGraphicEQ?.enabled === false &&
      preservedGraphicEQ.bypassed === false &&
      preservedGraphicEQ.params.mix === 83 &&
      preservedGraphicEQ.params.level === 117 &&
      preservedGraphicEQ.params.band100 === -8 &&
      preservedGraphicEQ.params.band6400 === 10,
    '기존 Graphic EQ 값 보존 및 중복 방지',
  );

  const currentPreset = createCurrentPreset();
  const storageRoundTrip = parsePresetJson(serializePresetPayload([currentPreset]));
  const exportRoundTrip = parsePresetJson(
    serializePresetPayload([currentPreset], { exportedAt: 1, pretty: true }),
  );
  assertCurrentPresetPreserved(storageRoundTrip[0], '사용자 프리셋 저장/재로드');
  assertCurrentPresetPreserved(exportRoundTrip[0], '프리셋 Export/Import');

  const currentVersionPayload = JSON.stringify({
    version: SCHEMA_VERSION,
    presets: [currentPreset],
  });
  assertCurrentPresetPreserved(parsePresetJson(currentVersionPayload)[0], 'v10 프리셋');

  const legacyPreset = {
    id: 'migration-check-legacy',
    name: 'Migration Check Legacy',
    updatedAt: 1,
    pedals: [
      {
        id: 'compressor',
        enabled: true,
        bypassed: false,
        params: { mix: 0.5, level: 0.8, attack: 0.006 },
      },
    ],
  };
  const legacyArrayPreset = parsePresetJson(JSON.stringify([legacyPreset]))[0];
  const legacyVersionOnePreset = parsePresetJson(
    JSON.stringify({ version: 1, presets: [legacyPreset] }),
  )[0];

  [legacyArrayPreset, legacyVersionOnePreset].forEach((preset, index) => {
    const compressor = preset?.pedals.find((pedal) => pedal.id === 'compressor');
    const autoWah = preset?.pedals.find((pedal) => pedal.id === 'auto-wah');
    const cab = preset?.pedals.find((pedal) => pedal.id === 'cab');
    const chorus = preset?.pedals.find((pedal) => pedal.id === 'chorus');
    const flanger = preset?.pedals.find((pedal) => pedal.id === 'flanger');
    const graphicEQ = preset?.pedals.find((pedal) => pedal.id === 'graphic-eq');
    const phaser = preset?.pedals.find((pedal) => pedal.id === 'phaser');
    const tremolo = preset?.pedals.find((pedal) => pedal.id === 'tremolo');
    const delay = preset?.pedals.find((pedal) => pedal.id === 'delay');
    const label = index === 0 ? 'legacy 배열' : 'legacy v1 payload';
    assert(compressor?.params.mix === 50, `${label} Mix 변환`);
    assert(compressor?.params.level === 80, `${label} Level 변환`);
    assert(compressor?.params.attack === 0.006, `${label} Attack 보존`);
    assert(
      autoWah?.bypassed === true &&
        autoWah.params.sensitivity === 55 &&
        autoWah.params.mode === 'auto',
      `${label} Auto Wah 삽입`,
    );
    assert(cab?.params.model === 'v30-4x12', `${label} Cab 삽입`);
    assert(chorus?.bypassed === true && chorus.params.voices === 3, `${label} Chorus 삽입`);
    assert(
      flanger?.bypassed === true && flanger.params.feedback === 60,
      `${label} Flanger 삽입`,
    );
    assert(
      graphicEQ?.bypassed === true &&
        GRAPHIC_EQ_BAND_KEYS.every((key) => graphicEQ.params[key] === 0),
      `${label} Graphic EQ 삽입`,
    );
    assert(
      phaser?.bypassed === true && phaser.params.stages === 6,
      `${label} Phaser 삽입`,
    );
    assert(
      tremolo?.bypassed === true &&
        tremolo.params.rate === 5 &&
        tremolo.params.shape === 'sine',
      `${label} Tremolo 삽입`,
    );
    assert(delay?.params.trails === true, `${label} Trails 기본값`);
  });

  assert(defaultPresets.length === 40, '팩토리 프리셋 정의 수 보존');
  defaultPresets.forEach((preset) => {
    const autoWah = preset.pedals.find((pedal) => pedal.id === 'auto-wah');
    const chorus = preset.pedals.find((pedal) => pedal.id === 'chorus');
    const flanger = preset.pedals.find((pedal) => pedal.id === 'flanger');
    const graphicEQ = preset.pedals.find((pedal) => pedal.id === 'graphic-eq');
    const phaser = preset.pedals.find((pedal) => pedal.id === 'phaser');
    const tremolo = preset.pedals.find((pedal) => pedal.id === 'tremolo');
    assert(autoWah?.bypassed === true, `${preset.name} Auto Wah 자동 Bypass`);
    assert(chorus?.bypassed === true, `${preset.name} Chorus 자동 Bypass`);
    assert(flanger?.bypassed === true, `${preset.name} Flanger 자동 Bypass`);
    assert(graphicEQ?.bypassed === true, `${preset.name} Graphic EQ 자동 Bypass`);
    assert(phaser?.bypassed === true, `${preset.name} Phaser 자동 Bypass`);
    assert(tremolo?.bypassed === true, `${preset.name} Tremolo 자동 Bypass`);
  });

  const invalidGraphicEQParams = normalizeGraphicEQParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    band100: Number.NaN,
    band200: Number.POSITIVE_INFINITY,
    band400: Number.NEGATIVE_INFINITY,
    band800: Number.NaN,
    band1600: Number.POSITIVE_INFINITY,
    band3200: Number.NEGATIVE_INFINITY,
    band6400: Number.NaN,
  });
  assert(
    invalidGraphicEQParams.mix === 100 &&
      invalidGraphicEQParams.level === 100 &&
      GRAPHIC_EQ_BAND_KEYS.every((key) => invalidGraphicEQParams[key] === 0),
    'Graphic EQ 비정상 값 기본값 복구',
  );
  const extremeGraphicEQParams = normalizeGraphicEQParams({
    mix: -1000,
    level: 1000,
    band100: -1000,
    band200: 1000,
    band400: -1000,
    band800: 1000,
    band1600: -1000,
    band3200: 1000,
    band6400: -1000,
  });
  assert(
    extremeGraphicEQParams.mix === 0 &&
      extremeGraphicEQParams.level === 200 &&
      GRAPHIC_EQ_BAND_KEYS.every((key, index) =>
        extremeGraphicEQParams[key] === (index % 2 === 0 ? -12 : 12),
      ),
    'Graphic EQ 극단값 클램프',
  );
  assert(
    GRAPHIC_EQ_FREQUENCIES.join(',') === '100,200,400,800,1600,3200,6400' &&
      GRAPHIC_EQ_Q === 1.4,
    'Graphic EQ 주파수 순서 및 Q',
  );

  const invalidParams = normalizeChorusParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    voices: Number.NaN as ChorusParams['voices'],
    spread: Number.NaN,
    tone: Number.POSITIVE_INFINITY,
  });
  assert(
    Object.values(invalidParams).every(
      (value) => typeof value !== 'number' || Number.isFinite(value),
    ),
    'Chorus NaN/Infinity 차단',
  );
  assert(
    invalidParams.mix === 35 &&
      invalidParams.level === 100 &&
      invalidParams.rate === 0.8 &&
      invalidParams.depth === 45 &&
      invalidParams.voices === 3 &&
      invalidParams.spread === 60 &&
      invalidParams.tone === 60,
    'Chorus 비정상 값 기본값 복구',
  );

  const extremeParams = normalizeChorusParams({
    mix: -1000,
    level: 1000,
    rate: 1000,
    depth: -1000,
    voices: 99 as ChorusParams['voices'],
    spread: 1000,
    tone: -1000,
  });
  assert(
    extremeParams.mix === 0 &&
      extremeParams.level === 200 &&
      extremeParams.rate === 8 &&
      extremeParams.depth === 0 &&
      extremeParams.voices === 4 &&
      extremeParams.spread === 100 &&
      extremeParams.tone === 0,
    'Chorus 극단값 클램프',
  );
  assert(
    CHORUS_VOICE_BANK_SIZE === 4 && CHORUS_LFO_BANK_SIZE === 9,
    'Chorus 고정 노드 뱅크 크기',
  );

  const invalidFlangerParams = normalizeFlangerParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    feedback: Number.NaN,
    manual: Number.POSITIVE_INFINITY,
  });
  assert(
    invalidFlangerParams.mix === 35 &&
      invalidFlangerParams.level === 100 &&
      invalidFlangerParams.rate === 0.25 &&
      invalidFlangerParams.depth === 55 &&
      invalidFlangerParams.feedback === 60 &&
      invalidFlangerParams.manual === 2,
    'Flanger 비정상 값 기본값 복구',
  );

  const extremeFlangerParams = normalizeFlangerParams({
    mix: -1000,
    level: 1000,
    rate: 1000,
    depth: -1000,
    feedback: -1000,
    manual: 1000,
  });
  assert(
    extremeFlangerParams.mix === 0 &&
      extremeFlangerParams.level === 200 &&
      extremeFlangerParams.rate === 5 &&
      extremeFlangerParams.depth === 0 &&
      extremeFlangerParams.feedback === -95 &&
      extremeFlangerParams.manual === 10 &&
      FLANGER_MAX_FEEDBACK === 0.95,
    'Flanger 극단값 및 피드백 상한 클램프',
  );

  const invalidPhaserParams = normalizePhaserParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    stages: Number.NaN as PhaserParams['stages'],
    feedback: Number.NaN,
  });
  assert(
    invalidPhaserParams.mix === 45 &&
      invalidPhaserParams.level === 100 &&
      invalidPhaserParams.rate === 0.5 &&
      invalidPhaserParams.depth === 70 &&
      invalidPhaserParams.stages === 6 &&
      invalidPhaserParams.feedback === 40,
    'Phaser 비정상 값 기본값 복구',
  );

  const extremePhaserParams = normalizePhaserParams({
    mix: -1000,
    level: 1000,
    rate: 1000,
    depth: -1000,
    stages: 99 as PhaserParams['stages'],
    feedback: 1000,
  });
  assert(
    extremePhaserParams.mix === 0 &&
      extremePhaserParams.level === 200 &&
      extremePhaserParams.rate === 8 &&
      extremePhaserParams.depth === 0 &&
      extremePhaserParams.stages === 12 &&
      extremePhaserParams.feedback === 90 &&
      PHASER_MAX_FEEDBACK === 0.9,
    'Phaser 극단값 및 피드백 상한 클램프',
  );

  const zeroSweep = getPhaserSweep(0);
  const fullSweep = getPhaserSweep(100);
  assert(
    Math.abs(zeroSweep.minimumFrequency - PHASER_CENTER_FREQUENCY) < 1e-9 &&
      Math.abs(zeroSweep.maximumFrequency - PHASER_CENTER_FREQUENCY) < 1e-9 &&
      Math.abs(fullSweep.minimumFrequency - PHASER_MIN_FREQUENCY) < 1e-9 &&
      Math.abs(fullSweep.maximumFrequency - PHASER_MAX_FREQUENCY) < 1e-9,
    'Phaser 지수 주파수 sweep',
  );
  assert(
    PHASER_STAGE_OPTIONS.join(',') === '4,6,8,12' &&
      getPhaserWetMakeup(0) === 1 &&
      getPhaserWetMakeup(PHASER_MAX_FEEDBACK) >= 0.3 &&
      getPhaserWetMakeup(PHASER_MAX_FEEDBACK) < 1,
    'Phaser stage bank 및 wet makeup',
  );

  const invalidTremoloParams = normalizeTremoloParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    shape: 'invalid' as TremoloParams['shape'],
    sync: 'invalid' as never,
    bpm: Number.NaN,
    division: 'invalid' as TremoloParams['division'],
  });
  assert(
    invalidTremoloParams.mix === 100 &&
      invalidTremoloParams.level === 100 &&
      invalidTremoloParams.rate === 5 &&
      invalidTremoloParams.depth === 50 &&
      invalidTremoloParams.shape === 'sine' &&
      invalidTremoloParams.sync === false &&
      invalidTremoloParams.bpm === 120 &&
      invalidTremoloParams.division === '1/8',
    'Tremolo 비정상 값 기본값 복구',
  );

  const extremeTremoloParams = normalizeTremoloParams({
    mix: -1000,
    level: 1000,
    rate: 1000,
    depth: -1000,
    shape: 'square',
    sync: true,
    bpm: 1000,
    division: '1/16',
  });
  assert(
    extremeTremoloParams.mix === 0 &&
      extremeTremoloParams.level === 200 &&
      extremeTremoloParams.rate === 20 &&
      extremeTremoloParams.depth === 0 &&
      extremeTremoloParams.bpm === 240,
    'Tremolo 극단값 클램프',
  );

  const syncedTremolo: TremoloParams = {
    mix: 100,
    level: 100,
    rate: 5,
    depth: 50,
    shape: 'sine',
    sync: true,
    bpm: 120,
    division: '1/8',
  };
  assert(
    getTremoloRate({ ...syncedTremolo, sync: false, rate: 7.25 }) === 7.25 &&
      getTremoloRate({ ...syncedTremolo, division: '1/4' }) === 2 &&
      getTremoloRate({ ...syncedTremolo, division: '1/8' }) === 4 &&
      Math.abs(getTremoloRate({ ...syncedTremolo, division: 'dotted1/8' }) - 8 / 3) <
        1e-9 &&
      getTremoloRate({ ...syncedTremolo, division: '1/16' }) === 8,
    'Tremolo rate 및 sync division 계산',
  );

  const zeroDepthBounds = getTremoloGainBounds(0);
  const fullDepthBounds = getTremoloGainBounds(100);
  assert(
    zeroDepthBounds.minimum === 1 &&
      zeroDepthBounds.maximum === 1 &&
      zeroDepthBounds.center === 1 &&
      zeroDepthBounds.modulationDepth === 0 &&
      fullDepthBounds.minimum === 0 &&
      fullDepthBounds.maximum === 1 &&
      fullDepthBounds.center === 0.5 &&
      fullDepthBounds.modulationDepth === 0.5 &&
      TREMOLO_LFO_BANK_SIZE === 3 &&
      TREMOLO_SQUARE_SLEW_SECONDS === 0.001,
    'Tremolo modulation gain 범위와 square slew',
  );

  const invalidAutoWahParams = normalizeAutoWahParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    sensitivity: Number.NaN,
    range: Number.NEGATIVE_INFINITY,
    resonance: Number.NaN,
    mode: 'invalid' as AutoWahParams['mode'],
    manual: Number.POSITIVE_INFINITY,
  });
  assert(
    invalidAutoWahParams.mix === 100 &&
      invalidAutoWahParams.level === 100 &&
      invalidAutoWahParams.sensitivity === 55 &&
      invalidAutoWahParams.range === 60 &&
      invalidAutoWahParams.resonance === 45 &&
      invalidAutoWahParams.mode === 'auto' &&
      invalidAutoWahParams.manual === 50,
    'Auto Wah 비정상 값 기본값 복구',
  );

  const extremeAutoWahParams = normalizeAutoWahParams({
    mix: -1000,
    level: 1000,
    sensitivity: 1000,
    range: -1000,
    resonance: 1000,
    mode: 'manual',
    manual: 1000,
  });
  assert(
    extremeAutoWahParams.mix === 0 &&
      extremeAutoWahParams.level === 200 &&
      extremeAutoWahParams.sensitivity === 100 &&
      extremeAutoWahParams.range === 0 &&
      extremeAutoWahParams.resonance === 100 &&
      extremeAutoWahParams.manual === 100,
    'Auto Wah 극단값 클램프',
  );
  assert(
    getAutoWahManualFrequency(0) === AUTO_WAH_MIN_FREQUENCY &&
      Math.abs(
        getAutoWahManualFrequency(50) -
          Math.sqrt(AUTO_WAH_MIN_FREQUENCY * AUTO_WAH_MAX_FREQUENCY),
      ) < 1e-9 &&
      getAutoWahManualFrequency(100) === AUTO_WAH_MAX_FREQUENCY &&
      getAutoWahDetuneRange(0) === 0 &&
      getAutoWahDetuneRange(100) === AUTO_WAH_MAX_DETUNE_CENTS &&
      getAutoWahAutoMaximumFrequency(0) === AUTO_WAH_MIN_FREQUENCY &&
      Math.abs(getAutoWahAutoMaximumFrequency(100) - AUTO_WAH_MAX_FREQUENCY) < 1e-9,
    'Auto Wah 300~2500 Hz 지수 매핑',
  );
  assert(
    getAutoWahResonanceQ(0) === AUTO_WAH_MIN_Q &&
      getAutoWahResonanceQ(100) === AUTO_WAH_MAX_Q,
    'Auto Wah resonance Q 매핑',
  );
}
