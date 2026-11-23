// 시험 전에 가짜 마이크용 WAV 가 있는지 확인하고, 없으면 만든다(git 에는 넣지 않는 생성물이다).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DEFAULT_MIC_WAV, fixturePath, repoRoot } from './helpers/env';

export default function globalSetup(): void {
  if (existsSync(fixturePath(DEFAULT_MIC_WAV))) return;
  const result = spawnSync(process.execPath, ['scripts/make-fixture-wavs.mjs'], { cwd: repoRoot, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('가짜 마이크 WAV 를 만들지 못했습니다. `node scripts/make-fixture-wavs.mjs` 를 직접 실행해 보세요.');
  }
}
