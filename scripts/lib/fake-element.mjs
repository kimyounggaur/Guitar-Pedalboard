// DOM 이 없는 Node 에서 단축키의 '포커스 위치' 규칙을 시험하기 위한 가짜 요소(S4.7).
// 운영 코드는 `target instanceof Element`, `tagName`, `type`, `hasAttribute`, `closest(selector)` 만 쓴다.
// closest 는 선택자를 쉼표 조각으로 나눠 '이 요소(또는 조상)가 해당하는 조각' 이 있는지만 본다 —
// 운영 코드의 선택자 문자열에서 그 조각이 빠지면 시험이 걸린다.
export class FakeElement {
  constructor(tagName, { type = '', attributes = [], matches = [] } = {}) {
    this.tagName = tagName.toUpperCase();
    this.type = type;
    this.attributes = new Set(attributes);
    this.matches = new Set(matches);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  closest(selector) {
    const clauses = selector.split(',').map((clause) => clause.trim());
    return clauses.some((clause) => this.matches.has(clause)) ? this : null;
  }
}

/** `instanceof Element` 검사가 통하도록 전역 Element 를 가짜 클래스로 둔다. */
export function installFakeElement() {
  const original = globalThis.Element;
  globalThis.Element = FakeElement;
  return () => {
    if (original === undefined) delete globalThis.Element;
    else globalThis.Element = original;
  };
}
