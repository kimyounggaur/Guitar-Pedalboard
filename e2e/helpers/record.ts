// 기록 모드 시험(E-04, E-06)이 잰 값을 남기는 도우미.
// 시험은 값을 test-results/measurements/ 에 쓰고, global-teardown 이 요약을 출력한다.
// E2E_UPDATE_BASELINE=1 로 돌렸을 때만 docs/baseline/e2e.json 에 병합한다(기준선은 의도할 때만 바꾼다).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { repoRoot } from './env';

export const measurementsDir = join(repoRoot, 'test-results', 'measurements');

export interface Measurement {
  /** 예: 'E-04' */
  id: string;
  /** 화면 프로필 이름. 예: '390x844' */
  profile: string;
  /** 도크·패널 상태 등 측정 조건. 예: 'dock-collapsed' */
  condition: string;
  /** 한 줄 요약(터미널·CI 로그에 그대로 찍힌다) */
  summary: string;
  values: Record<string, unknown>;
}

export function recordMeasurement(measurement: Measurement): void {
  mkdirSync(measurementsDir, { recursive: true });
  const name = `${measurement.id}__${measurement.profile}__${measurement.condition}.json`;
  writeFileSync(join(measurementsDir, name), `${JSON.stringify(measurement, null, 2)}\n`);
}

/**
 * 지금 보이는 화면(뷰포트)을 `{id}__{profile}__{condition}.png` 로 남긴다. 사람이 '지금 상태'를 눈으로 확인하는 용도라
 * 비트 단위 비교는 하지 않는다. E2E_UPDATE_BASELINE=1 일 때만 global-teardown 이 docs/baseline/screenshots/ 로 옮긴다.
 */
export async function recordScreenshot(page: Page, shot: Pick<Measurement, 'id' | 'profile' | 'condition'>): Promise<void> {
  mkdirSync(measurementsDir, { recursive: true });
  await page.screenshot({ path: join(measurementsDir, `${shot.id}__${shot.profile}__${shot.condition}.png`), animations: 'disabled' });
}
