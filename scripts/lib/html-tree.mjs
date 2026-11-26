// react-dom/server 가 만든 정적 마크업(renderToStaticMarkup)을 트리로 읽는 작은 도구(S4.7).
//
// 예전 시험은 컴포넌트 소스를 글자로 읽어 `/role="tablist"/` 같은 정규식으로 확인했다. 지금은 컴포넌트를 실제로 그려서(SSR)
// 나온 요소 트리에 묻는다 — "탭 목록 안에 탭이 네 개 있고 순서가 이렇다" 같은 **그려진 결과** 를 본다.
// React 가 만든 마크업만 읽으므로(따옴표 속성, 빈 요소 규칙이 일정하다) 일반 HTML 파서가 아니다.
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity]);
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1]] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let current = root;
  const token = /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=/>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const match of html.matchAll(token)) {
    const [whole, closing, opening, attributeSource, selfClosing, text] = match;
    if (whole.startsWith('<!--')) continue;
    if (text !== undefined) {
      current.children.push({ text: decode(text) });
    } else if (closing) {
      // 닫는 태그가 가장 가까운 같은 이름의 열린 요소를 닫는다(React 마크업은 항상 짝이 맞다).
      let target = current;
      while (target && target.tag !== closing) target = target.parent;
      assertOpen(target, closing);
      current = target.parent;
    } else {
      const node = { tag: opening, attrs: parseAttributes(attributeSource ?? ''), children: [], parent: current };
      current.children.push(node);
      if (!selfClosing && !VOID_ELEMENTS.has(opening)) current = node;
    }
  }
  return root;
}

function assertOpen(target, closing) {
  if (!target) throw new Error(`</${closing}> 에 짝이 되는 열린 태그가 없습니다.`);
}

export const isElement = (node) => node.tag !== undefined;

export function textContent(node) {
  if (node.text !== undefined) return node.text;
  return node.children.map(textContent).join('');
}

/** 자손 요소를 문서 순서대로 모은다(자기 자신은 뺀다). */
export function descendants(node) {
  const found = [];
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    found.push(child, ...descendants(child));
  }
  return found;
}

export function findAll(node, predicate) {
  return descendants(node).filter(predicate);
}

export function find(node, predicate) {
  return descendants(node).find(predicate) ?? null;
}

export function hasClass(node, name) {
  return (node.attrs.class ?? '').split(/\s+/).includes(name);
}

export const byTag = (tag) => (node) => node.tag === tag;
export const byClass = (name) => (node) => hasClass(node, name);
export const byRole = (role) => (node) => node.attrs.role === role;
export const byId = (id) => (node) => node.attrs.id === id;
