// 화면 글자 측정 도우미(설계서 S4.5, E-21): 화면에 그려진 모든 글자의 크기와 글자·배경 대비를 실제 렌더 결과로 잰다.
// 모두 브라우저 안(page.evaluate)에서 읽는다. 앱 코드는 건드리지 않는다.
//
// 크기: 글자가 있는 요소의 계산된 `font-size` 에 `transform: scale()` 로 줄어든 배율을 곱한 값(px).
//       입력 칸·선택 상자의 값 글자, `::before`/`::after` 에 적힌 글자도 센다.
// 대비: 화면을 찍어 글자 상자 안 픽셀 중 가장 많은 색을 배경으로 보고(픽셀 표본), 글자색은 계산된 `color` 에
//       글자 투명도·조상 `opacity` 를 반영해 배경 위에 얹은 색으로 본다. WCAG 2.x 상대 휘도 대비를 쓴다.
//       axe-core 는 이 저장소에 없고 의존성을 늘리지 않으므로(설계서 D16) 같은 기준(4.5:1, 큰 글자 3:1)을 직접 계산한다.
import type { Page } from '@playwright/test';

export interface TextItem {
  /** 사람이 찾아갈 수 있는 위치: '카드 이름 › 태그.클래스' */
  where: string;
  /** 글자(앞 24자) */
  text: string;
  /** 화면에 보이는 글자 크기(px) */
  fontPx: number;
  bold: boolean;
  kind: 'text' | 'input' | 'pseudo';
}

export interface ContrastItem extends TextItem {
  /** 글자·배경 대비(1~21) */
  ratio: number;
  /** 이 글자가 넘어야 하는 대비(보통 4.5, 큰 글자 3) */
  required: number;
  fg: string;
  bg: string;
}

export interface ContrastReport {
  /** 대비를 잰 글자 수 */
  measured: number;
  /** 비활성 부품이라 기준에서 뺀 글자 수(WCAG 1.4.3) */
  exempt: number;
  /** 화면에 보이게 할 수 없어 재지 못한 글자(가려짐·잘림) */
  unsampled: TextItem[];
  /** 기준에 못 미친 글자 */
  failures: ContrastItem[];
  /** 가장 낮은 대비 몇 개(진단용) */
  lowest: ContrastItem[];
}

/** 위치 문자열을 만드는 코드는 세 함수가 같아야 해서 문자열로 한 번만 둔다. */
const INIT = `
(() => {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'HEAD', 'META', 'LINK', 'OPTION', 'OPTGROUP', 'CANVAS', 'TEXTAREA']);
  const TEXT_INPUT_TYPES = new Set(['text', 'number', 'search', 'email', 'tel', 'url', 'password']);
  const records = [];
  const label = (el) => {
    const card = el.closest('.pedal-card');
    const where = card ? (card.getAttribute('aria-label') || 'pedal-card') : (el.closest('[role=dialog]') ? 'dialog' : (el.closest('aside,nav,header,footer,main') || document.body).tagName.toLowerCase());
    const part = (n) => {
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      return n.tagName.toLowerCase() + (cls ? '.' + cls : '');
    };
    return where + ' › ' + (el.parentElement && el.parentElement !== el.closest('.pedal-card') ? part(el.parentElement) + ' > ' : '') + part(el);
  };
  const scaleOf = (el) => {
    let s = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (!t || t === 'none') continue;
      const m = t.match(/^matrix\\(([^)]+)\\)$/);
      if (m) {
        const v = m[1].split(',').map(Number);
        s *= Math.hypot(v[0], v[1]);
      } else {
        const m3 = t.match(/^matrix3d\\(([^)]+)\\)$/);
        if (m3) {
          const v = m3[1].split(',').map(Number);
          s *= Math.hypot(v[0], v[1], v[2]);
        }
      }
    }
    return Number.isFinite(s) && s > 0 ? s : 1;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const visible = (el) => el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true, contentVisibilityAuto: true }) && !el.closest('[hidden]');
  // WCAG 2.x 1.4.3: 쓸 수 없는(비활성) 조작 부품의 글자는 대비 기준에서 빠진다. 크기 기준에는 빠지지 않는다.
  const inactive = (el) => !!el.closest(':disabled, [aria-disabled="true"]');
  const add = (el, text, kind, rects) => {
    const cs = getComputedStyle(el);
    const fontPx = parseFloat(cs.fontSize) * scaleOf(el);
    const weight = Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
    records.push({
      el, text: text.replace(/\\s+/g, ' ').trim().slice(0, 24), kind, rects,
      fontPx, bold: weight >= 700, color: cs.color, opacity: opacityOf(el), where: label(el),
      exempt: inactive(el), done: inactive(el), unsampled: false, result: null,
    });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || SKIP_TAGS.has(el.tagName) || !(node.nodeValue || '').trim()) continue;
    if (!visible(el) || el.closest('.visually-hidden')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width >= 2 && r.height >= 2);
    if (rects.length === 0) continue;
    add(el, node.nodeValue || '', 'text', null);
    records[records.length - 1].node = node;
  }
  for (const el of document.querySelectorAll('input, select')) {
    if (!visible(el)) continue;
    if (el instanceof HTMLInputElement && !TEXT_INPUT_TYPES.has(el.type)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (getComputedStyle(el).opacity === '0') continue;
    const value = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.textContent || '') : el.value;
    if (!value.trim()) continue;
    add(el, value, 'input', null);
  }
  for (const el of document.querySelectorAll('*')) {
    if (SKIP_TAGS.has(el.tagName) || !visible(el)) continue;
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      const content = cs.content;
      if (!content || content === 'none' || content === 'normal' || !/^"[^"]+"$/.test(content)) continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const record = { el, text: content.slice(1, -1).slice(0, 24), kind: 'pseudo', rects: null,
        fontPx: parseFloat(cs.fontSize) * scaleOf(el), bold: (Number(cs.fontWeight) || 400) >= 700, color: cs.color, opacity: opacityOf(el),
        where: label(el) + pseudo, exempt: false, done: true, unsampled: false, result: null };
      records.push(record);
    }
  }
  window.__textProbe = { records };
  return records.length;
})()
`;

/**
 * 끝이 있는 전환·애니메이션(서랍 열림의 투명도 등)이 끝나길 기다린다. 흐린 중간 상태에서 재면 글자색이 배경에 섞여 가짜 위반이 나온다.
 * 끝없이 도는 애니메이션은 기다리지 않는다.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const iterations = a.effect?.getComputedTiming().iterations;
      return iterations !== Infinity;
    });
    await Promise.allSettled(finite.map((a) => a.finished));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** 보이는 글자를 모두 모은다(크기만). 대비를 재려면 `measureContrast` 를 쓴다. */
export async function collectTextItems(page: Page): Promise<TextItem[]> {
  await settle(page);
  await page.evaluate(INIT);
  return page.evaluate(() => {
    const probe = (window as unknown as { __textProbe: { records: Array<{ where: string; text: string; fontPx: number; bold: boolean; kind: 'text' | 'input' | 'pseudo' }> } }).__textProbe;
    return probe.records.map((r) => ({ where: r.where, text: r.text, fontPx: Math.round(r.fontPx * 100) / 100, bold: r.bold, kind: r.kind }));
  });
}

/** 글자 크기가 `minPx` 미만인 글자들 */
export function smallerThan(items: readonly TextItem[], minPx: number): TextItem[] {
  return items.filter((item) => item.fontPx < minPx - 0.01);
}

/** 사람이 읽을 수 있게 한 줄로 */
export function describeItem(item: TextItem | ContrastItem): string {
  const ratio = 'ratio' in item ? ` 대비 ${item.ratio.toFixed(2)}:1(필요 ${item.required}) ${item.fg} on ${item.bg}` : '';
  return `${item.where} "${item.text}" ${item.fontPx.toFixed(1)}px${ratio}`;
}

/** 크기 분포를 한 줄 요약: '6.7px×3, 8.0px×10 …'(작은 것부터) */
export function sizeHistogram(items: readonly TextItem[], limit = 12): string {
  const counts = new Map<number, number>();
  for (const item of items) counts.set(Math.round(item.fontPx * 10) / 10, (counts.get(Math.round(item.fontPx * 10) / 10) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).slice(0, limit).map(([px, n]) => `${px}px×${n}`).join(', ');
}


/** 글자 상자의 가운데가 overflow 로 잘린 조상 상자 밖에 있으면 사용자에게는 보이지 않는 글자다(예: 높이가 접힌 패널 안). */
const CLIPPED = `
const clippedAway = (el, r) => {
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const box = a.getBoundingClientRect();
    if (cx < box.left - 1 || cx > box.right + 1 || cy < box.top - 1 || cy > box.bottom + 1) return true;
  }
  return false;
};
`;

/** 글자 상자 안 색 칸(5비트로 묶은 색의 픽셀 수와 r·g·b 합). */
export interface ColorBucket {
  n: number;
  r: number;
  g: number;
  b: number;
}

/**
 * 글자 상자 안의 색 칸들에서 배경 칸을 고른다. 브라우저 안(SAMPLE)과 단위 시험(Node)이 같은 소스를 쓴다.
 *  1. 글자색과 비슷한 색(거리 60 이하)은 글자로 보고 건너뛴다. 굵은 큰 글자는 상자의 절반을 넘기도 한다.
 *  2. 건너뛰고 남은 색 중 한 칸이 상자의 10 % 이상이면 가장 큰 칸이 배경이다.
 *  3. 그런 칸이 없어도, 글자색에서 먼 픽셀이 상자의 절반 이상이면 그 가운데 가장 큰 칸을 배경으로 본다 —
 *     글로우(text-shadow)·그라데이션 위의 글자는 배경이 5비트 칸 여러 개로 갈라져 한 칸이 10 % 에 못 미치는데,
 *     이때 가장 많은 칸이 글자 자신이 되어 대비 1.00:1 로 잘못 잡히던 것을 막는다(CI 의 글꼴 DejaVu Sans 에서 실제로 났다).
 *  4. 먼 색이 거의 없으면(글자색과 배경이 정말 비슷하면) 가장 많은 색을 쓴다 — 그러면 대비가 1 에 가까워 위반으로 잡힌다.
 */
export const PICK_BACKGROUND_SOURCE = `(counts, fg) => {
  let total = 0, best = null, bestFar = null, farTotal = 0, farBest = null;
  for (const e of counts.values()) total += e.n;
  for (const e of counts.values()) {
    if (!best || e.n > best.n) best = e;
    const far = Math.hypot(e.r / e.n - fg[0], e.g / e.n - fg[1], e.b / e.n - fg[2]) > 60;
    if (!far) continue;
    farTotal += e.n;
    if (!farBest || e.n > farBest.n) farBest = e;
    if (e.n >= total * 0.1 && (!bestFar || e.n > bestFar.n)) bestFar = e;
  }
  if (bestFar) return bestFar;
  if (farBest && farTotal >= total * 0.5) return farBest;
  return best;
}`;

export const pickBackground = new Function(`return ${PICK_BACKGROUND_SOURCE}`)() as (
  counts: Map<number, ColorBucket>,
  fg: readonly number[],
) => ColorBucket | null;

const SAMPLE = `
async (b64) => {
  const probe = window.__textProbe;
  ${CLIPPED}
  // 화면 아래에 붙은 고정 요소(모바일 도크)는 그림자를 위로 번지게 한다. 그 그림자 띠 안의 글자는 배경이 어두워져 실제 색을 잴 수 없으므로 띠 위에 있는 글자만 잰다.
  const bottomLimit = () => {
    let limit = window.innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.25 && top < window.innerHeight - 2) limit = Math.min(limit, top - 70);
    }
    return limit;
  };
  const limit = bottomLimit();
  const dpr = window.devicePixelRatio || 1;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const pix = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = (x, y) => { const i = (y * pix.width + x) * 4; return [pix.data[i], pix.data[i + 1], pix.data[i + 2]]; };
  const colorCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  colorCtx.canvas.width = 1; colorCtx.canvas.height = 1;
  const parse = (css) => { colorCtx.clearRect(0, 0, 1, 1); colorCtx.fillStyle = '#000'; colorCtx.fillStyle = css; colorCtx.fillRect(0, 0, 1, 1); const d = colorCtx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const pickBackground = ${PICK_BACKGROUND_SOURCE};
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  let sampled = 0;
  for (const rec of probe.records) {
    if (rec.done) continue;
    let rects;
    if (rec.node) { const range = document.createRange(); range.selectNodeContents(rec.node); rects = Array.from(range.getClientRects()); }
    else rects = [rec.el.getBoundingClientRect()];
    rects = rects.filter((r) => r.width >= 2 && r.height >= 2);
    if (rects.length === 0) continue;
    // 모든 줄 상자가 화면 안에 있고 그 가운데 점을 이 요소가 받아야 '보이는' 글자다.
    const inside = rects.every((r) => {
      if (r.left < -1 || r.top < -1 || r.right > window.innerWidth + 1 || r.bottom > limit + 1) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && (rec.el.contains(hit) || hit.contains(rec.el)) && !clippedAway(rec.el, r);
    });
    if (!inside) continue;
    // 화면을 찍는 사이에 글자가 움직였으면(실시간으로 바뀌는 상태 줄 등) 찍힌 그림과 위치가 어긋나므로 이번에는 재지 않는다.
    const before = probe.snap && probe.snap.get(rec);
    const now = rects.map((r) => [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',')).join(';');
    if (before !== undefined && before !== now) continue;
    const counts = new Map();
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor(r.left * dpr)), x1 = Math.min(pix.width, Math.ceil(r.right * dpr));
      const y0 = Math.max(0, Math.floor(r.top * dpr)), y1 = Math.min(pix.height, Math.ceil(r.bottom * dpr));
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        const [R, G, B] = px(x, y);
        const key = ((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
        const e = counts.get(key);
        if (e) { e.n += 1; e.r += R; e.g += G; e.b += B; } else counts.set(key, { n: 1, r: R, g: G, b: B });
      }
    }
    const fgRaw = parse(rec.color);
    const pick = pickBackground(counts, fgRaw);
    if (!pick) continue;
    const bg = [pick.r / pick.n, pick.g / pick.n, pick.b / pick.n];
    const alpha = fgRaw[3] * rec.opacity;
    const fg = [0, 1, 2].map((i) => fgRaw[i] * alpha + bg[i] * (1 - alpha));
    const large = rec.fontPx >= 24 || (rec.bold && rec.fontPx >= 18.66);
    rec.result = { ratio: ratio(fg, bg), required: large ? 3 : 4.5, fg: hex(fg), bg: hex(bg) };
    rec.done = true;
    sampled += 1;
  }
  return sampled;
}
`;

const NEXT = `
() => {
  const probe = window.__textProbe;
  ${CLIPPED}
  // 화면 아래에 붙은 고정 요소(모바일 도크)는 그림자를 위로 번지게 한다. 그 그림자 띠 안의 글자는 배경이 어두워져 실제 색을 잴 수 없으므로 띠 위에 있는 글자만 잰다.
  const bottomLimit = () => {
    let limit = window.innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.25 && top < window.innerHeight - 2) limit = Math.min(limit, top - 70);
    }
    return limit;
  };
  // 가운데로 스크롤해도 다른 것에 가려진 글자(도크 아래·서랍 뒤 등)는 화면을 찍지 않고 바로 '못 잰 글자'로 돌린다.
  for (let guard = 0; guard < 4000; guard += 1) {
    const rec = probe.records.find((r) => !r.done);
    if (!rec) return false;
    // 가운데 → 맨 위 순으로 가져와 본다. 맨 아래로는 가져오지 않는다 — 모바일 도크의 그림자가 글자 뒤 색을 어둡게 해 측정을 흐린다.
    let shown = false;
    for (const block of ['center', 'start']) {
      rec.el.scrollIntoView({ block, inline: 'center', behavior: 'instant' });
      let rects;
      if (rec.node) { const range = document.createRange(); range.selectNodeContents(rec.node); rects = Array.from(range.getClientRects()); }
      else rects = [rec.el.getBoundingClientRect()];
      rects = rects.filter((r) => r.width >= 2 && r.height >= 2);
      const limit = bottomLimit();
      shown = rects.length > 0 && rects.every((r) => {
        if (r.left < -1 || r.top < -1 || r.right > window.innerWidth + 1 || r.bottom > limit + 1) return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== null && (rec.el.contains(hit) || hit.contains(rec.el)) && !clippedAway(rec.el, r);
      });
      if (shown) break;
    }
    if (!shown) { rec.done = true; rec.unsampled = true; continue; }
    probe.target = rec;
    return true;
  }
  return false;
}
`;


/** 화면을 찍기 직전, 지금 보이는 글자들의 위치를 적어 둔다(찍은 뒤 위치가 달라졌는지 가리는 데 쓴다). */
const SNAP = `
() => {
  const probe = window.__textProbe;
  probe.snap = new Map();
  for (const rec of probe.records) {
    if (rec.done) continue;
    let rects;
    if (rec.node) { const range = document.createRange(); range.selectNodeContents(rec.node); rects = Array.from(range.getClientRects()); }
    else rects = [rec.el.getBoundingClientRect()];
    rects = rects.filter((r) => r.width >= 2 && r.height >= 2);
    probe.snap.set(rec, rects.map((r) => [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',')).join(';'));
  }
}
`;

const MARK_UNSAMPLED = `
() => {
  const probe = window.__textProbe;
  if (probe.target && !probe.target.done) { probe.target.done = true; probe.target.unsampled = true; }
}
`;

/**
 * 지금 화면(스크롤해서 닿는 곳 전부)의 글자 대비를 잰다. 글자를 하나씩 화면에 가져와 화면을 찍고,
 * 그때 보이는 글자를 한꺼번에 잰다(화면 하나에 보이는 글자는 같이 처리한다).
 */
export async function measureContrast(page: Page): Promise<ContrastReport> {
  await settle(page);
  await page.evaluate(INIT);
  for (let guard = 0; guard < 400; guard += 1) {
    const more = await page.evaluate(`(${NEXT})()`);
    if (!more) break;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(`(${SNAP})()`);
    const shot = await page.screenshot({ type: 'png', caret: 'hide' });
    const sampled = await page.evaluate(`(${SAMPLE})(${JSON.stringify(shot.toString('base64'))})`);
    if (sampled === 0) await page.evaluate(`(${MARK_UNSAMPLED})()`);
  }
  return page.evaluate(() => {
    type Rec = { exempt: boolean; where: string; text: string; fontPx: number; bold: boolean; kind: 'text' | 'input' | 'pseudo'; unsampled: boolean; result: { ratio: number; required: number; fg: string; bg: string } | null };
    const records = (window as unknown as { __textProbe: { records: Rec[] } }).__textProbe.records;
    const base = (r: Rec) => ({ where: r.where, text: r.text, fontPx: Math.round(r.fontPx * 100) / 100, bold: r.bold, kind: r.kind });
    const measured = records.filter((r) => r.result);
    const items = measured.map((r) => ({ ...base(r), ratio: Math.round((r.result?.ratio ?? 0) * 100) / 100, required: r.result?.required ?? 4.5, fg: r.result?.fg ?? '', bg: r.result?.bg ?? '' }));
    return {
      measured: items.length,
      exempt: records.filter((r) => r.exempt).length,
      unsampled: records.filter((r) => r.unsampled).map(base),
      failures: items.filter((i) => i.ratio < i.required),
      lowest: [...items].sort((a, b) => a.ratio - b.ratio).slice(0, 12),
    };
  });
}

/** 두 색(r,g,b 0~255)의 WCAG 2.x 대비. */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const lum = (c: readonly number[]): number => {
    const f = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 화면을 찍어 보이는 지점(CSS px)의 실제 색을 읽는다. 화면 밖 지점은 null. */
export async function samplePixels(page: Page, points: ReadonlyArray<{ x: number; y: number }>): Promise<Array<[number, number, number] | null>> {
  const shot = await page.screenshot({ type: 'png', caret: 'hide' });
  return page.evaluate(
    async ({ b64, pts }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return pts.map(() => null);
      ctx.drawImage(bitmap, 0, 0);
      const dpr = bitmap.width / window.innerWidth;
      return pts.map((p) => {
        const x = Math.round(p.x * dpr);
        const y = Math.round(p.y * dpr);
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
    },
    { b64: shot.toString('base64'), pts: [...points] },
  );
}

/** 글자 수를 무게로 본 '`minPx` 이상 글자의 비율'(Lighthouse 글꼴 크기 감사와 같은 방식: 글자 수 기준, 기준 60 %). */
export function legibleShare(items: readonly TextItem[], minPx: number): number {
  let total = 0;
  let ok = 0;
  for (const item of items) {
    total += item.text.length;
    if (item.fontPx >= minPx - 0.01) ok += item.text.length;
  }
  return total === 0 ? 1 : ok / total;
}
