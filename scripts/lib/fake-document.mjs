// 브라우저 없이 DOM 을 만드는 코드(정적 안내 화면 등)를 실행해 보기 위한 작은 가짜 document(S4.7).
// 만든 요소의 태그·속성·글자·자식을 그대로 읽을 수 있다. 실제 DOM 의 일부(createElement·setAttribute·append·replaceChildren·addEventListener)만 흉내 낸다.
export class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.children = [];
    this.listeners = [];
    this.style = { cssText: '' };
    this.textContent = '';
    this.type = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  get childElementCount() {
    return this.children.length;
  }

  addEventListener(type, listener, options) {
    this.listeners.push({ type, listener, options });
  }

  /** 자손 중 조건에 맞는 첫 요소 */
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const deeper = child.find?.(predicate);
      if (deeper) return deeper;
    }
    return null;
  }
}

export function createFakeDocument({ root = new FakeNode('div') } = {}) {
  root.setAttribute('id', 'root');
  return {
    root,
    createElement: (tagName) => new FakeNode(tagName),
    getElementById: (id) => (id === 'root' ? root : null),
  };
}
