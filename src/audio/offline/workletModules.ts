// 오프라인(OfflineAudioContext) 렌더에서 쓰는 워클릿 등록.
// AudioEngine.loadWorklets()가 등록하는 9개와 같은 목록이다(문자열 워클릿 6개 + 별도 파일 워클릿 3개: 리미터·레벨 미터·출력 가드).
// 둘이 어긋나지 않는지는 scripts/peak-limiter-regression.mjs 의 소스 단언이 확인한다.
import { compressorProcessorSource } from '../worklets/compressor-processor';
import { envelopeFollowerProcessorSource } from '../worklets/envelope-follower-processor';
import { flangerProcessorSource } from '../worklets/flanger-processor';
import { noiseGateProcessorSource } from '../worklets/noise-gate-processor';
import { phaserProcessorSource } from '../worklets/phaser-processor';
import { tunerProcessorSource } from '../worklets/tuner-processor';
import { levelMeterWorkletUrl, limiterWorkletUrl, outputGuardWorkletUrl } from '../worklets/urls';

export const workletSources: readonly string[] = [
  noiseGateProcessorSource,
  envelopeFollowerProcessorSource,
  tunerProcessorSource,
  flangerProcessorSource,
  phaserProcessorSource,
  compressorProcessorSource,
];

/** 모든 워클릿 모듈을 context 에 등록한다. 다 등록한 뒤 임시 URL 은 바로 해제한다. */
export async function registerWorklets(context: BaseAudioContext): Promise<void> {
  const urls = workletSources.map((source) =>
    URL.createObjectURL(new Blob([source], { type: 'application/javascript' })),
  );
  try {
    // 리미터·레벨 미터·출력 가드는 빌드가 내보낸 별도 파일이라 임시 URL 이 아니라 그 주소 그대로 부른다.
    await Promise.all(
      [...urls, limiterWorkletUrl, levelMeterWorkletUrl, outputGuardWorkletUrl].map((url) => context.audioWorklet.addModule(url)),
    );
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
