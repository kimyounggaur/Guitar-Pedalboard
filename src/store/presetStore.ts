import { create } from 'zustand';
import type { PedalParamValue, PedalState, Preset } from '../audio/types';
import { clonePedals, initialPedals } from './pedalStore';

const STORAGE_KEY = 'web-guitar-pedalboard-presets';
const FACTORY_TIMESTAMP = 1767225600000;

type PresetExport = {
  version: 1;
  exportedAt: number;
  presets: Preset[];
};

export type PresetListItem = Preset & {
  isFactory?: boolean;
};

type PedalOverrides = Parameters<typeof withPedalOverrides>[1];
type PresetOverrides = Record<string, PedalOverrides>;

export type PresetLibrary = {
  id: string;
  name: string;
  description: string;
};

export const presetLibraries: PresetLibrary[] = [
  { id: 'essentials', name: 'Essentials', description: '기본 클린, 컴프, 연습용 톤' },
  { id: 'blues', name: 'Blues & Roots', description: '블루스, 컨트리, 빈티지 리드' },
  { id: 'rock', name: 'Rock Classics', description: '크런치, 펑크, 아레나 리드' },
  { id: 'metal', name: 'Metal & Heavy', description: '타이트 리듬, 둠, 하이게인 리드' },
  { id: 'ambient', name: 'Ambient & Delay', description: '딜레이, 리버브, 공간계 사운드' },
  { id: 'fuzz', name: 'Fuzz Lab', description: '퍼즈, 게이트, 실험적인 질감' },
  { id: 'utility', name: 'Utility', description: '테스트, 안전 시작, 보정용 프리셋' },
];

const libraryById = new Map(presetLibraries.map((library) => [library.id, library]));

function clonePreset(preset: PresetListItem): PresetListItem {
  return {
    ...preset,
    pedals: clonePedals(preset.pedals),
  };
}

function withPedalOverrides(
  pedal: PedalState,
  overrides: Partial<Pick<PedalState, 'enabled' | 'bypassed'>> & {
    params?: Record<string, PedalParamValue>;
  },
): PedalState {
  const bypassed = overrides.bypassed ?? pedal.bypassed;

  return {
    ...pedal,
    enabled: overrides.enabled ?? pedal.enabled,
    bypassed,
    params: {
      ...pedal.params,
      ...overrides.params,
      bypassed,
    } as PedalState['params'],
  };
}

function createPreset(
  id: string,
  libraryId: string,
  name: string,
  description: string,
  tags: string[],
  overrides: PresetOverrides,
): PresetListItem {
  const library = libraryById.get(libraryId);

  return {
    id,
    name,
    libraryId,
    libraryName: library?.name ?? libraryId,
    description,
    tags,
    isFactory: true,
    updatedAt: FACTORY_TIMESTAMP,
    pedals: clonePedals(initialPedals).map((pedal) =>
      overrides[pedal.id] ? withPedalOverrides(pedal, overrides[pedal.id]) : pedal,
    ),
  };
}

const off = (mix = 0): PedalOverrides => ({ bypassed: true, params: { bypassed: true, mix } });
const on = (params: Record<string, PedalParamValue> = {}): PedalOverrides => ({
  bypassed: false,
  params: { bypassed: false, ...params },
});

const baseTone: PresetOverrides = {
  'noise-gate': on({ thresholdDb: -58, reductionDb: -76, attackMs: 5, holdMs: 70, releaseMs: 170, mix: 100 }),
  compressor: on({ threshold: -26, ratio: 3.2, attack: 0.006, release: 0.18, knee: 18, sustain: 28, mix: 68 }),
  drive: off(),
  crunch: off(),
  fuzz: off(),
  eq: on({ lowCut: 75, bassGain: 0, midFreq: 800, midGain: 0, midQ: 0.9, trebleGain: 0.5, presenceGain: 0.5 }),
  delay: off(),
  reverb: off(),
};

function preset(
  id: string,
  libraryId: string,
  name: string,
  description: string,
  tags: string[],
  overrides: PresetOverrides,
): PresetListItem {
  return createPreset(id, libraryId, name, description, tags, { ...baseTone, ...overrides });
}

export const defaultPresets: PresetListItem[] = [
  preset('factory-clean-practice', 'essentials', 'Clean Practice', '헤드폰 연습에 좋은 밝고 안전한 클린 톤입니다.', ['clean', 'practice'], {
    'noise-gate': on({ thresholdDb: -60, reductionDb: -70, releaseMs: 160 }),
    compressor: on({ threshold: -28, ratio: 2.4, sustain: 18, mix: 55 }),
    eq: on({ lowCut: 75, bassGain: 0.5, midGain: 0, trebleGain: 1, presenceGain: 1 }),
    reverb: on({ mode: 'room', decay: 1.2, mix: 18, highCut: 6800 }),
  }),
  preset('factory-studio-clean', 'essentials', 'Studio Clean', '컴프와 EQ를 정돈한 녹음용 클린 사운드입니다.', ['clean', 'studio'], {
    compressor: on({ threshold: -30, ratio: 2.8, attack: 0.004, release: 0.22, sustain: 22, mix: 72 }),
    eq: on({ lowCut: 85, bassGain: -0.5, midFreq: 780, midGain: 0.5, trebleGain: 2, presenceGain: 1.5 }),
    reverb: on({ mode: 'room', decay: 0.9, mix: 12, highCut: 7600 }),
  }),
  preset('factory-warm-jazz-clean', 'essentials', 'Warm Jazz Clean', '톤을 낮추고 중저역을 살린 따뜻한 넥 픽업용 톤입니다.', ['clean', 'jazz', 'warm'], {
    compressor: on({ threshold: -32, ratio: 2.1, sustain: 20, mix: 58 }),
    eq: on({ lowCut: 55, bassGain: 3, midFreq: 520, midGain: 1.2, trebleGain: -3, presenceGain: -2 }),
    reverb: on({ mode: 'hall', decay: 1.8, mix: 18, highCut: 5200 }),
  }),
  preset('factory-bright-pop-clean', 'essentials', 'Bright Pop Clean', '팝 리듬과 아르페지오에 잘 맞는 선명한 클린 톤입니다.', ['clean', 'pop', 'bright'], {
    compressor: on({ threshold: -29, ratio: 3.5, attack: 0.003, release: 0.16, sustain: 32, mix: 78 }),
    eq: on({ lowCut: 95, bassGain: -1, midFreq: 900, midGain: -0.5, trebleGain: 3.5, presenceGain: 3 }),
    delay: on({ mode: 'digital', timeMs: 190, feedback: 0.18, mix: 10, tone: 70 }),
    reverb: on({ mode: 'plate', decay: 1.4, mix: 16, highCut: 8200 }),
  }),
  preset('factory-funk-comp', 'essentials', 'Funk Comp', '짧은 어택과 강한 컴프가 있는 타이트한 커팅 톤입니다.', ['funk', 'comp', 'rhythm'], {
    compressor: on({ threshold: -36, ratio: 6, attack: 0.002, release: 0.12, sustain: 48, mix: 86 }),
    eq: on({ lowCut: 105, bassGain: -2, midFreq: 700, midGain: 1, trebleGain: 3, presenceGain: 4 }),
    reverb: on({ mode: 'room', decay: 0.7, mix: 8, highCut: 9000 }),
  }),
  preset('factory-country-twang', 'essentials', 'Country Twang', '슬랩백 딜레이와 밝은 EQ의 컨트리 리듬 톤입니다.', ['country', 'slapback', 'twang'], {
    compressor: on({ threshold: -33, ratio: 4.2, attack: 0.004, release: 0.15, sustain: 38, mix: 80 }),
    eq: on({ lowCut: 80, bassGain: 0, midFreq: 950, midGain: -1, trebleGain: 4.5, presenceGain: 4 }),
    delay: on({ mode: 'slapback', timeMs: 92, feedback: 0.12, mix: 20, tone: 68 }),
    reverb: on({ mode: 'spring', decay: 1.2, mix: 18, highCut: 7600 }),
  }),
  preset('factory-edge-breakup', 'essentials', 'Edge Breakup', '클린과 오버드라이브 사이의 반응 좋은 브레이크업 톤입니다.', ['breakup', 'rhythm'], {
    drive: on({ mode: 'overdrive', drive: 22, tone: 55, level: 98, mix: 62, bias: 0.05 }),
    eq: on({ lowCut: 80, bassGain: 1.5, midFreq: 760, midGain: 1, trebleGain: 1.5, presenceGain: 1.5 }),
    reverb: on({ mode: 'room', decay: 1.2, mix: 14, highCut: 7200 }),
  }),
  preset('factory-acoustic-room', 'essentials', 'Acoustic Room', '일렉 기타를 조금 더 어쿠스틱하게 정돈한 밝은 룸 톤입니다.', ['acoustic', 'room'], {
    compressor: on({ threshold: -34, ratio: 2.5, attack: 0.008, release: 0.24, sustain: 24, mix: 70 }),
    eq: on({ lowCut: 120, bassGain: -3, midFreq: 1100, midGain: 1, trebleGain: 4, presenceGain: 3.5 }),
    reverb: on({ mode: 'room', decay: 1.6, mix: 24, highCut: 9000 }),
  }),

  preset('factory-blues-lead', 'blues', 'Blues Lead', '미드가 살아 있는 빈티지 오버드라이브 리드 톤입니다.', ['blues', 'lead'], {
    compressor: on({ threshold: -30, ratio: 3.2, sustain: 42, mix: 70 }),
    drive: on({ mode: 'overdrive', drive: 48, tone: 58, level: 96, mix: 88, bias: 0.14 }),
    eq: on({ bassGain: 2, midFreq: 720, midGain: 2.5, trebleGain: 1.5, presenceGain: 2 }),
    delay: on({ mode: 'analog', timeMs: 310, feedback: 0.25, mix: 18, tone: 45 }),
    reverb: on({ mode: 'spring', decay: 1.7, mix: 22, highCut: 6200 }),
  }),
  preset('factory-texas-push', 'blues', 'Texas Push', '싱글코일 리드에 어울리는 선명하고 거친 텍사스 톤입니다.', ['blues', 'texas'], {
    compressor: on({ threshold: -28, ratio: 3.8, sustain: 34, mix: 68 }),
    drive: on({ mode: 'overdrive', drive: 58, tone: 64, level: 96, mix: 92, bias: 0.12 }),
    eq: on({ lowCut: 85, bassGain: 1.5, midFreq: 720, midGain: 3, trebleGain: 2.5, presenceGain: 3 }),
    reverb: on({ mode: 'spring', decay: 1.5, mix: 18, highCut: 7000 }),
  }),
  preset('factory-chicago-blues', 'blues', 'Chicago Blues', '둥근 컴프와 낮은 게인으로 블루스 리듬을 받쳐줍니다.', ['blues', 'rhythm'], {
    compressor: on({ threshold: -31, ratio: 2.7, sustain: 30, mix: 64 }),
    drive: on({ mode: 'overdrive', drive: 36, tone: 48, level: 94, mix: 76, bias: 0.02 }),
    eq: on({ lowCut: 70, bassGain: 2.5, midFreq: 600, midGain: 2, trebleGain: -0.5, presenceGain: 0.5 }),
    reverb: on({ mode: 'room', decay: 1.3, mix: 16, highCut: 5600 }),
  }),
  preset('factory-delta-slap', 'blues', 'Delta Slap', '짧은 슬랩백과 스프링 리버브가 있는 루츠 톤입니다.', ['roots', 'slapback'], {
    drive: on({ mode: 'overdrive', drive: 30, tone: 52, level: 95, mix: 68, bias: 0 }),
    eq: on({ lowCut: 95, bassGain: 1, midFreq: 680, midGain: 1.4, trebleGain: 1.8, presenceGain: 2.2 }),
    delay: on({ mode: 'slapback', timeMs: 105, feedback: 0.1, mix: 16, tone: 52 }),
    reverb: on({ mode: 'spring', decay: 1.4, mix: 20, highCut: 6200 }),
  }),
  preset('factory-soulful-neck', 'blues', 'Soulful Neck', '넥 픽업 솔로에 맞춘 부드럽고 sustain 있는 톤입니다.', ['soul', 'lead'], {
    compressor: on({ threshold: -35, ratio: 3.4, sustain: 55, mix: 74 }),
    drive: on({ mode: 'overdrive', drive: 44, tone: 42, level: 94, mix: 84, bias: 0.08 }),
    eq: on({ lowCut: 65, bassGain: 2, midFreq: 540, midGain: 2.4, trebleGain: -1, presenceGain: 0 }),
    delay: on({ mode: 'analog', timeMs: 360, feedback: 0.24, mix: 14, tone: 38 }),
    reverb: on({ mode: 'hall', decay: 2.1, mix: 20, highCut: 5600 }),
  }),

  preset('factory-classic-rock', 'rock', 'Classic Rock', '크런치 리듬과 짧은 플레이트 리버브의 표준 록 톤입니다.', ['rock', 'crunch'], {
    compressor: on({ threshold: -24, ratio: 4.5, sustain: 30, mix: 65 }),
    drive: on({ mode: 'crunch', drive: 64, tone: 62, level: 92, mix: 92, bias: 0.04 }),
    eq: on({ lowCut: 85, bassGain: 2.5, midFreq: 850, midGain: -1.5, trebleGain: 3, presenceGain: 2 }),
    reverb: on({ mode: 'plate', decay: 1.5, mix: 16, highCut: 7400 }),
  }),
  preset('factory-british-crunch', 'rock', 'British Crunch', '중역대가 앞으로 나오는 브리티시 앰프 스타일입니다.', ['rock', 'british'], {
    crunch: on({ volume: 86, gain: 62, tone: 56, presence: 54, lowCut: 90, mix: 92, level: 94 }),
    eq: on({ lowCut: 90, bassGain: 1, midFreq: 900, midGain: 2.5, trebleGain: 2, presenceGain: 2 }),
    reverb: on({ mode: 'plate', decay: 1.2, mix: 12, highCut: 7600 }),
  }),
  preset('factory-plexi-lead', 'rock', 'Plexi Lead', '긴 sustain과 살짝 어두운 딜레이가 있는 클래식 솔로 톤입니다.', ['rock', 'lead'], {
    compressor: on({ threshold: -27, ratio: 4.5, sustain: 46, mix: 72 }),
    crunch: on({ volume: 88, gain: 72, tone: 58, presence: 60, lowCut: 95, mix: 94, level: 94 }),
    eq: on({ bassGain: 1.5, midFreq: 780, midGain: 2, trebleGain: 2.5, presenceGain: 3 }),
    delay: on({ mode: 'analog', timeMs: 420, feedback: 0.28, mix: 18, tone: 42 }),
    reverb: on({ mode: 'hall', decay: 2.0, mix: 16, highCut: 6800 }),
  }),
  preset('factory-arena-solo', 'rock', 'Arena Solo', '공간감 있는 딜레이와 리버브로 만든 큰 리드 톤입니다.', ['rock', 'solo'], {
    drive: on({ mode: 'distortion', drive: 68, tone: 60, level: 92, mix: 90, bias: 0 }),
    eq: on({ lowCut: 100, bassGain: 1, midFreq: 1000, midGain: 1.5, trebleGain: 3, presenceGain: 4 }),
    delay: on({ mode: 'digital', timeMs: 470, feedback: 0.34, mix: 24, tone: 58 }),
    reverb: on({ mode: 'hall', decay: 2.8, preDelay: 32, mix: 22, highCut: 7800 }),
  }),
  preset('factory-punk-rhythm', 'rock', 'Punk Rhythm', '빠른 다운피킹을 위한 단단하고 직선적인 디스토션입니다.', ['punk', 'rhythm'], {
    drive: on({ mode: 'distortion', drive: 72, tone: 66, level: 92, mix: 94, bias: 0 }),
    eq: on({ lowCut: 120, bassGain: 0, midFreq: 900, midGain: 2, trebleGain: 3, presenceGain: 2 }),
    reverb: on({ mode: 'room', decay: 0.7, mix: 6, highCut: 6800 }),
  }),
  preset('factory-indie-jangle', 'rock', 'Indie Jangle', '밝은 컴프와 약한 오버드라이브의 인디 리듬 톤입니다.', ['indie', 'jangle'], {
    compressor: on({ threshold: -34, ratio: 4.2, sustain: 36, mix: 78 }),
    drive: on({ mode: 'overdrive', drive: 18, tone: 66, level: 98, mix: 42, bias: 0.02 }),
    eq: on({ lowCut: 110, bassGain: -1.5, midFreq: 1200, midGain: -1, trebleGain: 4, presenceGain: 3.5 }),
    delay: on({ mode: 'digital', timeMs: 260, feedback: 0.2, mix: 12, tone: 70 }),
    reverb: on({ mode: 'plate', decay: 1.8, mix: 18, highCut: 8600 }),
  }),

  preset('factory-tight-modern-metal', 'metal', 'Tight Modern Metal', '강한 게이트와 로우컷으로 타이트하게 조인 모던 메탈 톤입니다.', ['metal', 'tight'], {
    'noise-gate': on({ thresholdDb: -46, reductionDb: -80, attackMs: 2, holdMs: 35, releaseMs: 80, hysteresisDb: 6 }),
    drive: on({ mode: 'distortion', drive: 82, tone: 62, level: 86, mix: 96, bias: -0.02 }),
    eq: on({ lowCut: 125, bassGain: 2, midFreq: 700, midGain: -4, midQ: 1.5, trebleGain: 4, presenceGain: 5 }),
    reverb: on({ mode: 'room', decay: 0.6, mix: 6, highCut: 7200 }),
  }),
  preset('factory-thrash-rhythm', 'metal', 'Thrash Rhythm', '피킹 어택이 선명한 빠른 리프용 톤입니다.', ['metal', 'thrash'], {
    'noise-gate': on({ thresholdDb: -48, reductionDb: -80, attackMs: 2, holdMs: 28, releaseMs: 70, hysteresisDb: 6 }),
    crunch: on({ volume: 88, gain: 78, tone: 68, presence: 72, lowCut: 120, mix: 96, level: 90 }),
    eq: on({ lowCut: 130, bassGain: 1.2, midFreq: 850, midGain: -2.5, trebleGain: 4.5, presenceGain: 5 }),
  }),
  preset('factory-djent-gate', 'metal', 'Djent Gate', '짧은 릴리즈와 단단한 로우엔드 컷의 게이트 리프 톤입니다.', ['metal', 'gate'], {
    'noise-gate': on({ thresholdDb: -42, reductionDb: -80, attackMs: 1, holdMs: 20, releaseMs: 45, hysteresisDb: 7 }),
    drive: on({ mode: 'distortion', drive: 76, tone: 58, level: 88, mix: 92, bias: -0.06 }),
    eq: on({ lowCut: 150, bassGain: 1, midFreq: 650, midGain: -6, midQ: 1.8, trebleGain: 3.8, presenceGain: 5.5 }),
  }),
  preset('factory-liquid-metal-lead', 'metal', 'Liquid Metal Lead', '하이게인 리드에 딜레이와 홀 리버브를 더했습니다.', ['metal', 'lead'], {
    compressor: on({ threshold: -30, ratio: 5.5, sustain: 58, mix: 78 }),
    drive: on({ mode: 'distortion', drive: 78, tone: 56, level: 90, mix: 94, bias: 0.02 }),
    eq: on({ lowCut: 115, bassGain: 1, midFreq: 980, midGain: 1.8, trebleGain: 3, presenceGain: 4 }),
    delay: on({ mode: 'digital', timeMs: 430, feedback: 0.32, mix: 23, tone: 56 }),
    reverb: on({ mode: 'hall', decay: 2.6, preDelay: 28, mix: 20, highCut: 7200 }),
  }),
  preset('factory-doom-wall', 'metal', 'Doom Wall', '두꺼운 저역과 긴 리버브를 가진 둠/슬러지 톤입니다.', ['doom', 'heavy'], {
    fuzz: on({ mode: 'classic', fuzz: 86, tone: 36, bias: 48, gate: 6, lowCut: 55, mix: 96, level: 88 }),
    eq: on({ lowCut: 45, bassGain: 5, midFreq: 520, midGain: 1, trebleGain: -2, presenceGain: -1 }),
    reverb: on({ mode: 'hall', decay: 3.2, mix: 18, highCut: 4800 }),
  }),

  preset('factory-ambient-delay', 'ambient', 'Ambient Delay', '도트 8분 딜레이와 앰비언트 리버브의 넓은 공간 톤입니다.', ['ambient', 'delay'], {
    compressor: on({ threshold: -32, ratio: 2.6, sustain: 48, mix: 72 }),
    eq: on({ lowCut: 95, bassGain: -1, midFreq: 1000, midGain: -1, trebleGain: 2, presenceGain: 3 }),
    delay: on({ mode: 'tape', sync: true, bpm: 90, division: 'dotted1/8', feedback: 0.62, mix: 48, tone: 38 }),
    reverb: on({ mode: 'ambient', decay: 6.2, preDelay: 65, mix: 45, highCut: 8200 }),
  }),
  preset('factory-tape-swell', 'ambient', 'Tape Swell', '테이프 딜레이와 긴 프리딜레이로 천천히 퍼지는 톤입니다.', ['ambient', 'tape'], {
    compressor: on({ threshold: -36, ratio: 3, sustain: 60, mix: 76 }),
    eq: on({ lowCut: 100, bassGain: -1.5, midFreq: 900, midGain: -1.2, trebleGain: 1.5, presenceGain: 2.5 }),
    delay: on({ mode: 'tape', timeMs: 620, feedback: 0.54, mix: 42, tone: 34 }),
    reverb: on({ mode: 'ambient', decay: 7.5, preDelay: 90, mix: 48, highCut: 7600 }),
  }),
  preset('factory-post-rock-wash', 'ambient', 'Post Rock Wash', '코드가 뒤로 번지는 포스트록 클린 공간계입니다.', ['post-rock', 'wash'], {
    drive: on({ mode: 'overdrive', drive: 20, tone: 50, level: 96, mix: 36, bias: 0.04 }),
    eq: on({ lowCut: 90, bassGain: 0.5, midFreq: 760, midGain: -1, trebleGain: 2.4, presenceGain: 2 }),
    delay: on({ mode: 'analog', timeMs: 540, feedback: 0.48, mix: 35, tone: 42 }),
    reverb: on({ mode: 'ambient', decay: 5.8, preDelay: 55, mix: 42, highCut: 7200 }),
  }),
  preset('factory-dotted-eighth', 'ambient', 'Dotted Eighth', '리듬을 밀어주는 싱크 딜레이 프리셋입니다.', ['delay', 'sync'], {
    compressor: on({ threshold: -30, ratio: 3, sustain: 36, mix: 66 }),
    drive: on({ mode: 'overdrive', drive: 16, tone: 56, level: 96, mix: 28, bias: 0 }),
    delay: on({ mode: 'digital', sync: true, bpm: 126, division: 'dotted1/8', feedback: 0.44, mix: 34, tone: 64 }),
    reverb: on({ mode: 'plate', decay: 2.0, mix: 18, highCut: 8200 }),
  }),
  preset('factory-dream-clean', 'ambient', 'Dream Clean', '클린 리듬에 은은한 딜레이와 큰 리버브를 더했습니다.', ['clean', 'dream'], {
    compressor: on({ threshold: -34, ratio: 2.4, sustain: 46, mix: 70 }),
    eq: on({ lowCut: 80, bassGain: 0, midFreq: 950, midGain: -0.6, trebleGain: 2.5, presenceGain: 2.5 }),
    delay: on({ mode: 'analog', timeMs: 380, feedback: 0.32, mix: 24, tone: 48 }),
    reverb: on({ mode: 'hall', decay: 3.8, preDelay: 38, mix: 34, highCut: 7600 }),
  }),

  preset('factory-fuzz-experiment', 'fuzz', 'Fuzz Experiment', '거친 퍼즈와 짧은 슬랩백을 결합한 실험 톤입니다.', ['fuzz', 'experiment'], {
    compressor: on({ threshold: -34, ratio: 6, sustain: 62, mix: 82 }),
    drive: on({ mode: 'fuzz', drive: 92, tone: 42, level: 82, mix: 100, bias: -0.12 }),
    eq: on({ lowCut: 110, bassGain: 4, midFreq: 620, midGain: -5, trebleGain: 4, presenceGain: 5 }),
    delay: on({ mode: 'slapback', timeMs: 95, feedback: 0.15, mix: 18, tone: 60 }),
    reverb: on({ mode: 'plate', decay: 2.2, mix: 24, highCut: 6800 }),
  }),
  preset('factory-vintage-fuzz', 'fuzz', 'Vintage Fuzz', '밝고 클래식한 퍼즈 페이스 계열 톤입니다.', ['fuzz', 'vintage'], {
    fuzz: on({ mode: 'classic', fuzz: 74, tone: 58, bias: 55, gate: 5, lowCut: 65, mix: 94, level: 90 }),
    eq: on({ lowCut: 70, bassGain: 2, midFreq: 700, midGain: 1, trebleGain: 2, presenceGain: 3 }),
    reverb: on({ mode: 'plate', decay: 1.6, mix: 14, highCut: 7200 }),
  }),
  preset('factory-gated-velcro', 'fuzz', 'Gated Velcro', '뚝뚝 끊기는 게이트 퍼즈 질감입니다.', ['fuzz', 'gated'], {
    'noise-gate': on({ thresholdDb: -50, reductionDb: -80, attackMs: 1, holdMs: 0, releaseMs: 55, hysteresisDb: 8 }),
    fuzz: on({ mode: 'velcro', fuzz: 88, tone: 52, bias: 28, gate: 72, lowCut: 95, mix: 100, level: 84 }),
    eq: on({ lowCut: 120, bassGain: 1, midFreq: 820, midGain: -1.5, trebleGain: 4, presenceGain: 5 }),
  }),
  preset('factory-broken-speaker', 'fuzz', 'Broken Speaker', '바이어스를 낮춰 찢어진 스피커 같은 느낌을 냅니다.', ['fuzz', 'broken'], {
    fuzz: on({ mode: 'velcro', fuzz: 96, tone: 36, bias: 12, gate: 58, lowCut: 130, mix: 100, level: 78 }),
    eq: on({ lowCut: 150, bassGain: -1, midFreq: 1100, midGain: 3.5, trebleGain: 2, presenceGain: 4 }),
    delay: on({ mode: 'slapback', timeMs: 70, feedback: 0.08, mix: 10, tone: 46 }),
  }),
  preset('factory-stoner-fuzz', 'fuzz', 'Stoner Fuzz', '느슨하고 두꺼운 저역 중심의 퍼즈 리프 톤입니다.', ['fuzz', 'stoner'], {
    fuzz: on({ mode: 'classic', fuzz: 82, tone: 30, bias: 46, gate: 4, lowCut: 45, mix: 98, level: 88 }),
    eq: on({ lowCut: 45, bassGain: 5, midFreq: 500, midGain: 1.8, trebleGain: -2.5, presenceGain: -1 }),
    reverb: on({ mode: 'room', decay: 1.4, mix: 12, highCut: 5200 }),
  }),

  preset('factory-direct-clean', 'utility', 'Direct Clean', '거의 모든 효과를 걷어낸 기준점 프리셋입니다.', ['utility', 'direct'], {
    'noise-gate': off(100),
    compressor: off(0),
    eq: on({ lowCut: 40, bassGain: 0, midFreq: 800, midGain: 0, midQ: 0.9, trebleGain: 0, presenceGain: 0 }),
  }),
  preset('factory-headphone-safe-start', 'utility', 'Headphone Safe Start', '낮은 레벨과 최소 공간계로 시작하는 안전 테스트 프리셋입니다.', ['utility', 'safe'], {
    'noise-gate': on({ thresholdDb: -62, reductionDb: -80, attackMs: 8, holdMs: 80, releaseMs: 220, level: 80 }),
    compressor: on({ threshold: -28, ratio: 2, sustain: 12, mix: 45, level: 82 }),
    eq: on({ lowCut: 100, bassGain: -1, midFreq: 800, midGain: 0, trebleGain: -0.5, presenceGain: -0.5, level: 82 }),
    reverb: on({ mode: 'room', decay: 0.8, mix: 8, level: 82, highCut: 6500 }),
  }),
  preset('factory-low-noise-gate', 'utility', 'Low Noise Gate', '노이즈가 많은 입력을 빠르게 점검하기 위한 게이트 중심 프리셋입니다.', ['utility', 'gate'], {
    'noise-gate': on({ thresholdDb: -48, reductionDb: -80, attackMs: 2, holdMs: 60, releaseMs: 120, hysteresisDb: 7 }),
    compressor: off(0),
    eq: on({ lowCut: 90, bassGain: 0, midFreq: 850, midGain: 0, trebleGain: 1, presenceGain: 1 }),
  }),
  preset('factory-solo-boost', 'utility', 'Solo Boost', '현재 체인에 리드감을 주는 볼륨과 중역 부스트 프리셋입니다.', ['utility', 'boost'], {
    compressor: on({ threshold: -30, ratio: 4, sustain: 48, mix: 76 }),
    drive: on({ mode: 'overdrive', drive: 34, tone: 58, level: 100, mix: 72, bias: 0.08 }),
    eq: on({ lowCut: 90, bassGain: 0, midFreq: 900, midGain: 3.5, trebleGain: 2, presenceGain: 3, level: 108 }),
    delay: on({ mode: 'analog', timeMs: 380, feedback: 0.22, mix: 14, tone: 48 }),
    reverb: on({ mode: 'plate', decay: 1.6, mix: 14, highCut: 7200 }),
  }),
  preset('factory-dark-room', 'utility', 'Dark Room', '밝은 기타나 피킹이 거친 연주를 부드럽게 눌러줍니다.', ['utility', 'dark'], {
    compressor: on({ threshold: -30, ratio: 2.8, sustain: 30, mix: 62 }),
    eq: on({ lowCut: 70, bassGain: 1.5, midFreq: 720, midGain: 0.5, trebleGain: -4, presenceGain: -3 }),
    reverb: on({ mode: 'room', decay: 1.5, mix: 18, highCut: 4200 }),
  }),
  preset('factory-bright-cut', 'utility', 'Bright Cut', '쏘는 고역을 줄이고 믹스 안에서 부드럽게 만드는 프리셋입니다.', ['utility', 'eq'], {
    compressor: on({ threshold: -28, ratio: 3, sustain: 28, mix: 64 }),
    eq: on({ lowCut: 95, bassGain: 0.5, midFreq: 640, midGain: 1, trebleGain: -5, presenceGain: -4 }),
    reverb: on({ mode: 'plate', decay: 1.2, mix: 10, highCut: 4500 }),
  }),
];

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isPreset(value: unknown): value is Preset {
  const preset = value as Preset;

  return (
    !!preset &&
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    typeof preset.updatedAt === 'number' &&
    Array.isArray(preset.pedals)
  );
}

function normalizeImportedPreset(preset: Preset): Preset {
  return {
    id: preset.id || createId(),
    name: preset.name.trim() || 'Imported Preset',
    libraryId: preset.libraryId,
    libraryName: preset.libraryName,
    description: preset.description,
    tags: Array.isArray(preset.tags) ? preset.tags.filter((tag) => typeof tag === 'string') : undefined,
    pedals: clonePedals(preset.pedals),
    updatedAt: typeof preset.updatedAt === 'number' ? preset.updatedAt : Date.now(),
  };
}

function parsePresetJson(json: string): Preset[] {
  const parsed = JSON.parse(json);
  const candidates = Array.isArray(parsed) ? parsed : (parsed as PresetExport).presets;

  if (!Array.isArray(candidates)) {
    throw new Error('프리셋 JSON 형식이 올바르지 않습니다.');
  }

  return candidates.filter(isPreset).map(normalizeImportedPreset);
}

function readUserPresets(): Preset[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parsePresetJson(raw);
  } catch {
    return [];
  }
}

function writeUserPresets(presets: Preset[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toPresetList(userPresets: Preset[]): PresetListItem[] {
  const normalizedUserPresets = userPresets.map((preset) => ({
    ...preset,
    libraryId: preset.libraryId ?? 'user',
    libraryName: preset.libraryName ?? 'My Presets',
    description: preset.description ?? '사용자가 저장한 페달 체인',
    tags: preset.tags ?? ['user'],
  }));

  return [...defaultPresets.map(clonePreset), ...normalizedUserPresets.map(clonePreset)];
}

interface PresetStore {
  presets: PresetListItem[];
  savePreset: (name: string, pedals: PedalState[]) => void;
  deletePreset: (id: string) => void;
  reloadPresets: () => void;
  exportPresets: () => string;
  importPresets: (json: string) => number;
}

export const usePresetStore = create<PresetStore>((set, get) => ({
  presets: toPresetList(readUserPresets()),

  savePreset: (name, pedals) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const userPresets = get().presets.filter((preset) => !preset.isFactory);
    const existing = userPresets.find((preset) => preset.name === trimmedName);
    const nextPreset: Preset = {
      id: existing?.id ?? createId(),
      name: trimmedName,
      libraryId: 'user',
      libraryName: 'My Presets',
      description: '사용자가 저장한 페달 체인',
      tags: ['user', 'custom'],
      pedals: clonePedals(pedals),
      updatedAt: Date.now(),
    };

    const nextUserPresets = existing
      ? userPresets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [nextPreset, ...userPresets];

    writeUserPresets(nextUserPresets);
    set({ presets: toPresetList(nextUserPresets) });
  },

  deletePreset: (id) => {
    const preset = get().presets.find((item) => item.id === id);
    if (preset?.isFactory) return;

    const userPresets = get().presets.filter((item) => !item.isFactory && item.id !== id);
    writeUserPresets(userPresets);
    set({ presets: toPresetList(userPresets) });
  },

  reloadPresets: () => set({ presets: toPresetList(readUserPresets()) }),

  exportPresets: () => {
    const exportPayload: PresetExport = {
      version: 1,
      exportedAt: Date.now(),
      presets: get().presets.map(({ isFactory: _isFactory, ...preset }) => ({
        ...preset,
        pedals: clonePedals(preset.pedals),
      })),
    };

    return JSON.stringify(exportPayload, null, 2);
  },

  importPresets: (json) => {
    const importedPresets = parsePresetJson(json).map((preset) => ({
      ...preset,
      id: preset.id.startsWith('factory-') ? createId() : preset.id,
      updatedAt: Date.now(),
    }));
    const userPresets = get().presets.filter((preset) => !preset.isFactory);
    const nextByName = new Map<string, Preset>();

    [...userPresets, ...importedPresets].forEach((preset) => {
      nextByName.set(preset.name, preset);
    });

    const nextUserPresets = Array.from(nextByName.values());
    writeUserPresets(nextUserPresets);
    set({ presets: toPresetList(nextUserPresets) });

    return importedPresets.length;
  },
}));
