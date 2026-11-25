/**
 * 기능 플래그(설계서 7.2). 소리가 달라지는 변경을 청취 승인 전까지 꺼 둔 채 나란히 들어 보려고 쓴다.
 *
 * 켜는 법: 주소에 `?ff=newCompressor` 를 붙인다(여러 개는 쉼표로, 끄는 것은 이름 앞에 `-`: `?ff=-newCompressor`).
 * 플래그는 페이지를 열 때 한 번 읽고 이펙트를 만들 때 쓴다. 이미 만들어진 이펙트는 바뀌지 않으니 바꾼 뒤에는 새로 고친다.
 * 시험·프로브는 `setFeatureFlagOverride` 로 주소와 상관없이 정한다. 값을 저장소에 남기지 않는다(주소가 곧 설정이다).
 *
 * 설계서의 '개발자 메뉴로 켠다' 는 아직 없다: 앱에 개발자 메뉴가 없고, 소리 비교를 하는 사람은 주소를 바꾸는 쪽이 간단하다.
 */
export const FEATURE_FLAG_NAMES = ['newCompressor'] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];

/**
 * 기본값. 설계서 7.2 는 '청취 승인 뒤 on' 이라 승인 전에는 모두 꺼져 있다. 승인을 받으면 해당 줄을 true 로 바꾸고,
 * 프리셋 음량이 달라지니 `npm run trims` 를 다시 돌린다(REFACTOR_LOG L-248).
 */
export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlagName, boolean>> = {
  newCompressor: false,
};

export type FeatureFlagOverrides = Partial<Record<FeatureFlagName, boolean>>;

function isFlagName(name: string): name is FeatureFlagName {
  return (FEATURE_FLAG_NAMES as readonly string[]).includes(name);
}

/**
 * 주소의 검색 부분(`?ff=a,-b`)에서 켜고 끈 플래그를 읽는다. 모르는 이름·빈 조각은 무시한다. `ff` 가 여러 번 나오면 모두 합친다.
 * 같은 이름이 여러 번 나오면 뒤의 것이 이긴다.
 */
export function parseFeatureFlags(search: string): FeatureFlagOverrides {
  const result: FeatureFlagOverrides = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return result;
  }
  for (const list of params.getAll('ff')) {
    for (const piece of list.split(',')) {
      const token = piece.trim();
      if (!token) continue;
      const off = token.startsWith('-');
      const name = off ? token.slice(1).trim() : token;
      if (isFlagName(name)) result[name] = !off;
    }
  }
  return result;
}

let urlFlags: FeatureFlagOverrides | null = null;
const overrides: FeatureFlagOverrides = {};

function fromAddress(): FeatureFlagOverrides {
  if (urlFlags) return urlFlags;
  const search = typeof location === 'undefined' ? '' : location.search;
  urlFlags = parseFeatureFlags(search);
  return urlFlags;
}

/** 플래그가 켜져 있는가. 우선순위: 시험·프로브가 정한 값 > 주소 > 기본값. */
export function isFeatureEnabled(name: FeatureFlagName): boolean {
  const forced = overrides[name];
  if (forced !== undefined) return forced;
  const fromUrl = fromAddress()[name];
  if (fromUrl !== undefined) return fromUrl;
  return FEATURE_FLAG_DEFAULTS[name];
}

/** 시험·프로브가 플래그를 정한다. null 이면 정한 값을 지워 주소·기본값으로 돌아간다. */
export function setFeatureFlagOverride(name: FeatureFlagName, value: boolean | null): void {
  if (value === null) delete overrides[name];
  else overrides[name] = value;
}

/** 정해 둔 값을 모두 지운다(시험이 끝날 때). 주소에서 읽은 값은 다시 읽도록 비운다. */
export function resetFeatureFlagOverrides(): void {
  for (const name of FEATURE_FLAG_NAMES) delete overrides[name];
  urlFlags = null;
}
