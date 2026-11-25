// 프리셋 삭제 되돌리기와 같은 이름 저장에 쓰는 순수 함수(S2.8, 설계서 S2.8·E-12).
//
// 이 파일은 저장소·스토어·화면을 모른다. '지우기 전에 어느 자리였는지'를 기억하고, 되돌릴 때 그 자리를 찾는 계산과
// 겹치지 않는 이름을 만드는 계산만 한다.

/** 목록에서 `key` 항목 뒤에 있던 key 들(앞에서부터). 목록에 없는 key 면 빈 목록이다. */
export function keysAfter<T>(items: readonly T[], key: string, keyOf: (item: T) => string): string[] {
  const index = items.findIndex((item) => keyOf(item) === key);
  return index < 0 ? [] : items.slice(index + 1).map(keyOf);
}

/**
 * 지우기 전의 자리에 항목을 다시 끼운다.
 *
 * `following` 은 지우기 전에 그 항목 뒤에 있던 key 들이다. 그중 **지금도 목록에 남은 첫 항목의 바로 앞**에 끼우고,
 * 하나도 없으면 맨 뒤에 붙인다. 그 사이에 다른 프리셋이 지워지거나 추가돼도 상대적인 순서가 유지된다.
 * 같은 key 의 항목이 이미 있으면 아무것도 바꾸지 않는다(복사본을 돌려 준다).
 */
export function reinsertByKey<T>(
  items: readonly T[],
  item: T,
  following: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const key = keyOf(item);
  if (items.some((candidate) => keyOf(candidate) === key)) return [...items];
  for (const next of following) {
    const at = items.findIndex((candidate) => keyOf(candidate) === next);
    if (at >= 0) return [...items.slice(0, at), item, ...items.slice(at)];
  }
  return [...items, item];
}

/** 문자열 목록(즐겨찾기·최근 id)용 `keysAfter`. */
export function idsAfter(ids: readonly string[], id: string): string[] {
  return keysAfter(ids, id, (value) => value);
}

/** 문자열 목록(즐겨찾기·최근 id)용 `reinsertByKey`. */
export function reinsertId(ids: readonly string[], id: string, following: readonly string[]): string[] {
  return reinsertByKey(ids, id, following, (value) => value);
}

/** 되돌리는 프리셋의 이름이 그 사이 다른 프리셋에 쓰였을 때 쓸 이름: '이름 (복원)', 그것도 있으면 '이름 (복원 2)'… */
export function uniqueRestoredName(name: string, takenNames: ReadonlySet<string>): string {
  const base = name.trim() || 'Preset';
  let candidate = `${base} (복원)`;
  for (let n = 2; takenNames.has(candidate); n += 1) candidate = `${base} (복원 ${n})`;
  return candidate;
}

/** 같은 이름으로 저장할 때 제안하는 새 이름: '이름 (2)', 그것도 있으면 '이름 (3)'… */
export function uniqueNumberedName(name: string, takenNames: ReadonlySet<string>): string {
  const base = name.trim() || 'Preset';
  let n = 2;
  while (takenNames.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}
