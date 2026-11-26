// 시험 전에 가짜 마이크용 WAV 가 다 있는지 확인하고, 빠진 것만 만든다(git 에는 넣지 않는 생성물이다).
// 예전에는 기본 신호(ref-pc.wav)만 확인해서, 신호가 늘어난 뒤(S2.5 의 lvl-*) 옛 WAV 만 가진 환경에서는
// 새 신호가 없는 채로 시험이 시작됐다. `--missing` 은 이미 있는 파일을 건드리지 않는다.
import { spawnSync } from 'node:child_process';
import { repoRoot } from './helpers/env';

export default function globalSetup(): void {
  const result = spawnSync(process.execPath, ['scripts/make-fixture-wavs.mjs', '--missing'], { cwd: repoRoot, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('가짜 마이크 WAV 를 만들지 못했습니다. `node scripts/make-fixture-wavs.mjs --missing` 를 직접 실행해 보세요.');
  }
}
