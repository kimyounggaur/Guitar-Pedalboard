// 오프라인(OfflineAudioContext) 렌더에서 쓰는 워클릿 등록.
// AudioEngine.loadWorklets()가 등록하는 8개와 같은 목록이다. 둘이 어긋나지 않는지는
// scripts/offline-worklets-regression.mjs 가 확인한다.
import { compressorProcessorSource } from '../worklets/compressor-processor';
import { envelopeFollowerProcessorSource } from '../worklets/envelope-follower-processor';
import { flangerProcessorSource } from '../worklets/flanger-processor';
import { howlGuardProcessorSource } from '../worklets/howl-guard-processor';
import { noiseGateProcessorSource } from '../worklets/noise-gate-processor';
import { peakLimiterProcessorSource } from '../worklets/peak-limiter-processor';
import { phaserProcessorSource } from '../worklets/phaser-processor';
import { tunerProcessorSource } from '../worklets/tuner-processor';

export const workletSources: readonly string[] = [
  noiseGateProcessorSource,
  envelopeFollowerProcessorSource,
  tunerProcessorSource,
  howlGuardProcessorSource,
  flangerProcessorSource,
  phaserProcessorSource,
  compressorProcessorSource,
  peakLimiterProcessorSource,
];

/** 모든 워클릿 모듈을 context 에 등록한다. 다 등록한 뒤 임시 URL 은 바로 해제한다. */
export async function registerWorklets(context: BaseAudioContext): Promise<void> {
  const urls = workletSources.map((source) =>
    URL.createObjectURL(new Blob([source], { type: 'application/javascript' })),
  );
  try {
    await Promise.all(urls.map((url) => context.audioWorklet.addModule(url)));
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
