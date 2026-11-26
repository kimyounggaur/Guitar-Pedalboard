// 시험(E-04, E-06)이 기록한 측정값을 요약해 보여 주고, E2E_UPDATE_BASELINE=1 이면 docs/baseline/e2e.json 에 병합한다.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from './helpers/env';
import { measurementsDir, type Measurement } from './helpers/record';

const baselinePath = join(repoRoot, 'docs', 'baseline', 'e2e.json');
const screenshotsDir = join(repoRoot, 'docs', 'baseline', 'screenshots');
// 모두 넣으면 6 MB 가 넘어 기준선을 갱신할 때마다 저장소가 부푼다. 대표 몇 장만 커밋하고 나머지는 CI 실패 보고서로만 남는다.
// E-06 은 S1.8 에서 1440×900 과 '기타 연결 뒤' 1280×800 을 더했다(1024×768 '펼침' 은 서랍이 열린 모습이다).
const committedScreenshots = new Set([
  'E-04__390x844__dock-collapsed.png',
  'E-04__390x844__dock-expanded.png',
  'E-06__1024x768__sidebar-open.png',
  'E-06__1280x800__sidebar-open.png',
  'E-06__1280x800__connected.png',
  'E-06__1440x900__sidebar-open.png',
]);

interface BaselineFile {
  schema: 1;
  description: string;
  generatedWith: { playwright: string; note: string };
  results: Record<string, Record<string, Record<string, Record<string, unknown>>>>;
}

export default function globalTeardown(): void {
  if (!existsSync(measurementsDir)) return;
  const measurements: Measurement[] = readdirSync(measurementsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(measurementsDir, name), 'utf8')) as Measurement);
  if (measurements.length === 0) return;

  console.log('\n시험이 기록한 측정값');
  for (const measurement of measurements) {
    console.log(`  ${measurement.id} ${measurement.profile} ${measurement.condition}: ${measurement.summary}`);
  }

  if (!process.env.E2E_UPDATE_BASELINE) {
    console.log('기준선(docs/baseline/e2e.json)은 바꾸지 않았습니다. 갱신하려면 E2E_UPDATE_BASELINE=1 로 실행하세요.');
    return;
  }

  const existing: BaselineFile | null = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as BaselineFile)
    : null;
  const next: BaselineFile = {
    schema: 1,
    description:
      '브라우저 시나리오(E-04·E-06)가 잰 값의 기준선. 두 시험 모두 정식 단언(S1.6·S1.8)이고, 이 파일은 사람이 값의 변화를 읽기 위한 기록이다. E2E_UPDATE_BASELINE=1 npm run e2e 로만 갱신하고 커밋 메시지는 `baseline: {Step ID} {이유}` 로 적는다.',
    generatedWith: { playwright: '1.63.0', note: 'scripts/ 가 아니라 e2e/tests 의 E-04·E-06 시험이 잰 값을 쓴다' },
    results: existing?.results ?? {},
  };
  for (const measurement of measurements) {
    next.results[measurement.id] ??= {};
    next.results[measurement.id][measurement.profile] ??= {};
    next.results[measurement.id][measurement.profile][measurement.condition] = measurement.values;
  }
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  const screenshots = readdirSync(measurementsDir).filter((name) => committedScreenshots.has(name));
  if (screenshots.length > 0) {
    mkdirSync(screenshotsDir, { recursive: true });
    for (const name of screenshots) copyFileSync(join(measurementsDir, name), join(screenshotsDir, name));
  }
  console.log(`기준선을 갱신했습니다: ${baselinePath} (대표 스크린샷 ${screenshots.length}장 → docs/baseline/screenshots/)\n커밋 메시지: baseline: {Step ID} {이유}`);
}
