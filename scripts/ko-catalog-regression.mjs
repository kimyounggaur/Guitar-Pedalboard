// S4.6 한국어 문구 카탈로그(src/i18n/ko.ts) 정적 검사(설계서 4.6절 인수 기준 E-22 의 (2)).
//   1. 쓰지 않는 키가 0개다. 화면 문구가 카탈로그에만 있고 아무도 읽지 않으면 문구가 어긋나도 아무도 모른다.
//      `ko.a.b` 처럼 정적으로 읽은 것과 `ko.pedal[type].name` 처럼 일부를 계산해서 읽은 것을 모두 센다.
//      `ko.a` 만 읽어 통째로 넘기는 것(키 사용을 추적할 수 없다)과 `ko` 를 통째로 쓰는 것은 오류로 본다.
//   2. 사용자에게 보이는 문구를 만드는 자리(토스트 message·버튼 label, setMessage/setError, 상태 스토어의 error·midiError,
//      사용자 동작에 답하는 모듈의 `new Error(...)`)에 한글·영어 문구를 직접 쓰지 않는다. 모두 `ko.*` 키로 간다.
//   3. 검사기 자체의 시험: 가짜 소스로 쓰지 않는 키·직접 쓴 문구·통째 사용이 실제로 잡히는지 확인한다.
// 브라우저 화면에 실제로 어떤 글자가 나오는지는 e2e E-22 가 본다.
import assert from 'node:assert/strict';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const CATALOG_PATH = 'src/i18n/ko.ts';

/** 사용자 동작에 대한 답으로 오류 문구를 던지는 모듈 — 여기의 `new Error(문구)` 는 화면에 보일 수 있다. */
const USER_FACING_ERROR_FILES = new Set([
  'src/persistence/exportFormat.ts',
  'src/audio/utils/cabinetIr.ts',
  'src/audio/engine/errors.ts',
  'src/audio/AudioEngine.ts',
  'src/audio/midi/MidiService.ts',
  'src/store/audioStore.ts',
]);

/**
 * 화면에 나오지 않는 것으로 확인된 직접 문구(예외 목록). 이유를 함께 적는다.
 *  - AudioEngine 의 'setSinkId 없음': 바로 아래 `catch {}` 가 삼키고 시스템 기본 출력으로 되돌린다.
 *  - AudioEngine 의 '알 수 없는 이펙터 타입입니다': `satisfies never` 로 막힌 불변식. 타입이 맞으면 도달할 수 없다.
 *  - errorReport.ts: 클립보드로 복사하는 개발자용 오류 보고 본문(화면에 그리지 않는다).
 *  - probePage.ts: 개발자용 오디오 렌더 프로브 페이지(`audio-render-probe.mjs` 가 연다). 앱 화면이 아니다.
 *  - Meter 의 '-inf dB / -inf dBpk': 값이 오기 전의 숫자 자리표시(단위 글자)라 문구가 아니다.
 *  - staticFallback.ts: React 가 아예 뜨지 못했을 때의 정적 안내. React·스토어에 기대지 않는 것이 이 파일의 약속이라 문구를 직접 둔다(app-notices 시험이 지킨다).
 *  - audioStore 의 '저장된 입출력 설정의 모양이…': 저장값 해석기가 던지면 SafeStorage 가 깨진 값으로 보관하고 기본값을 쓴다. 사용자에게는
 *    저장 문제 안내(`ko.storage.corrupt`)만 보인다.
 *  - impulse.worker.ts 의 오류 문구: 워커가 보내는 실패 응답의 글자. 받는 쪽(impulseCache)은 글자를 읽지 않고 같은 일을 메인 스레드에서 다시 한다.
 */
const ALLOWED_LITERALS = [
  { file: 'src/audio/AudioEngine.ts', text: 'setSinkId 없음' },
  { file: 'src/audio/AudioEngine.ts', text: '알 수 없는 이펙터 타입입니다' },
  { file: 'src/app/errorReport.ts', text: '*' },
  { file: 'src/app/staticFallback.ts', text: '*' },
  { file: 'src/audio/testing/probePage.ts', text: '*' },
  { file: 'src/components/Meter.tsx', text: '-inf dB' },
  { file: 'src/store/audioStore.ts', text: '저장된 입출력 설정의 모양이' },
  { file: 'src/audio/workers/impulse.worker.ts', text: 'Impulse response generation failed' },
];

const SINK_CALLEES = new Set(['setMessage', 'setError', 'setIrError', 'setStatus', 'setNotice']);
const TOAST_CALLEES = new Set(['showToast', 'show']);
const STATE_FIELDS = new Set(['error', 'midiError', 'message']);

const HANGUL = /[가-힣]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

function parse(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function unwrap(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(node) {
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** 카탈로그의 잎(문구 하나)을 점으로 이은 경로로 모은다. 모양을 읽을 수 없으면 problems 에 적는다. */
export function collectCatalogLeaves(text) {
  const source = parse(CATALOG_PATH, text);
  const leaves = [];
  const problems = [];
  let root = null;
  source.forEachChild((statement) => {
    if (!ts.isVariableStatement(statement)) return;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'ko' && declaration.initializer) {
        root = unwrap(declaration.initializer);
      }
    }
  });
  if (!root || !ts.isObjectLiteralExpression(root)) {
    problems.push('ko.ts 에서 `export const ko = { … }` 를 찾지 못했다.');
    return { leaves, problems };
  }
  const walk = (object, prefix) => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) {
        problems.push(`${prefix.join('.') || '(최상위)'}: 속성 정의가 아닌 항목(전개·축약·메서드)은 키 사용을 추적할 수 없다.`);
        continue;
      }
      const name = propertyName(property);
      if (name === null) {
        problems.push(`${prefix.join('.') || '(최상위)'}: 계산된 키는 추적할 수 없다.`);
        continue;
      }
      const value = unwrap(property.initializer);
      const path = [...prefix, name];
      if (ts.isObjectLiteralExpression(value)) walk(value, path);
      else leaves.push(path);
    }
  };
  walk(root, []);
  return { leaves, problems };
}

/** 소스 하나에서 `ko` 로 시작하는 접근 사슬을 모은다. 계산된 접근은 '*' 로 적는다. */
function collectChains(path, text) {
  const source = parse(path, text);
  const chains = [];
  const problems = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      // `import { ko as other }` 같은 별칭은 사용을 따라갈 수 없다.
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          if (element.propertyName?.text === 'ko') problems.push(`${path}: ko 를 다른 이름으로 가져왔다(${element.name.text}).`);
        }
      }
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'ko') {
      const parent = node.parent;
      // 속성 이름(`foo.ko`)·선언 이름은 건너뛴다.
      const isMemberName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isDeclarationName = (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyAssignment(parent) || ts.isBindingElement(parent)) && parent.name === node;
      if (!isMemberName && !isDeclarationName) {
        const segments = [];
        let current = node;
        for (;;) {
          const up = current.parent;
          if (ts.isPropertyAccessExpression(up) && up.expression === current) {
            segments.push(up.name.text);
            current = up;
          } else if (ts.isElementAccessExpression(up) && up.expression === current) {
            const argument = up.argumentExpression && unwrap(up.argumentExpression);
            segments.push(argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) ? argument.text : '*');
            current = up;
          } else if (ts.isNonNullExpression(up) && up.expression === current) {
            current = up;
          } else break;
        }
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        chains.push({ segments, where: `${path}:${line + 1}` });
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return { chains, problems };
}

/** 문구 노드에서 정적으로 알 수 있는 글자를 모은다. 문구가 아니면 null. */
function literalText(node) {
  const value = unwrap(node);
  if (!value) return null;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isTemplateExpression(value)) return value.head.text + value.templateSpans.map((span) => span.literal.text).join('');
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(value.left);
    const right = literalText(value.right);
    if (left === null && right === null) return null;
    return (left ?? '') + (right ?? '');
  }
  if (ts.isConditionalExpression(value)) {
    const a = literalText(value.whenTrue);
    const b = literalText(value.whenFalse);
    if (a === null && b === null) return null;
    return `${a ?? ''}${b ?? ''}`;
  }
  return null;
}

function isHumanText(text) {
  return HANGUL.test(text) || LATIN_WORD.test(text);
}

function isAllowed(path, text) {
  return ALLOWED_LITERALS.some((entry) => entry.file === path && (entry.text === '*' || text.startsWith(entry.text)));
}

/** 문구를 직접 쓴 자리를 모은다. */
function collectLiteralSinks(path, text) {
  const source = parse(path, text);
  const found = [];
  const reported = new Set();
  const report = (node, kind, literal) => {
    if (literal === null || !isHumanText(literal) || isAllowed(path, literal)) return;
    // 토스트의 message 는 토스트 규칙과 상태 필드 규칙에 모두 걸린다. 같은 자리는 한 번만 센다.
    if (reported.has(node.getStart())) return;
    reported.add(node.getStart());
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${path}:${line + 1} ${kind} — ${JSON.stringify(literal.length > 40 ? `${literal.slice(0, 40)}…` : literal)}`);
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (SINK_CALLEES.has(callee)) {
        for (const argument of node.arguments) report(argument, `${callee}()`, literalText(argument));
      }
      if (TOAST_CALLEES.has(callee)) {
        const first = node.arguments[0] && unwrap(node.arguments[0]);
        if (first && ts.isObjectLiteralExpression(first)) {
          for (const property of first.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const name = propertyName(property);
            if (name === 'message') report(property.initializer, `${callee}({ message })`, literalText(property.initializer));
            if (name === 'action') {
              const action = unwrap(property.initializer);
              if (ts.isObjectLiteralExpression(action)) {
                for (const inner of action.properties) {
                  if (ts.isPropertyAssignment(inner) && propertyName(inner) === 'label') {
                    report(inner.initializer, `${callee}({ action.label })`, literalText(inner.initializer));
                  }
                }
              }
            }
          }
        }
      }
    }
    // DOM 에 글자를 바로 넣는 자리(`element.textContent = '…'`). 정적 안내 화면(staticFallback)은 React·CSS 에 기대지 않으려고 예외 목록에 둔다.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'textContent'
    ) {
      report(node.right, 'textContent =', literalText(node.right));
    }
    if (ts.isPropertyAssignment(node) && STATE_FIELDS.has(propertyName(node) ?? '')) {
      report(node.initializer, `${propertyName(node)}:`, literalText(node.initializer));
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /Error$/.test(node.expression.text) && USER_FACING_ERROR_FILES.has(path)) {
      const argument = node.arguments?.[0];
      if (argument) report(argument, `new ${node.expression.text}()`, literalText(argument));
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

/** leaf 경로가 어떤 사슬에 읽히는가. 사슬의 '*' 는 아무 키나 받는다. */
function chainCovers(chain, leaf) {
  if (chain.length > leaf.length) return false;
  for (let i = 0; i < chain.length; i += 1) {
    if (chain[i] !== '*' && chain[i] !== leaf[i]) return false;
  }
  return true;
}

/**
 * 파일 모음(경로 → 소스 글)을 검사한다. 파일 입출력과 분리해 두어 가짜 소스로도 시험한다.
 * @returns {{ leaves: string[], unused: string[], problems: string[], literals: string[] }}
 */
export function analyze(files) {
  const catalogText = files.get(CATALOG_PATH);
  if (catalogText === undefined) throw new Error(`${CATALOG_PATH} 가 없다.`);
  const { leaves, problems } = collectCatalogLeaves(catalogText);
  const leafPaths = leaves.map((leaf) => leaf.join('.'));
  const leafSet = new Set(leafPaths);
  const used = new Set();
  const literals = [];

  for (const [path, text] of files) {
    if (path === CATALOG_PATH || !/\.(ts|tsx)$/.test(path)) continue;
    const { chains, problems: chainProblems } = collectChains(path, text);
    problems.push(...chainProblems);
    for (const { segments, where } of chains) {
      if (segments.length === 0) {
        problems.push(`${where}: ko 를 통째로 쓴다(어떤 키를 읽는지 추적할 수 없다).`);
        continue;
      }
      const matching = leaves.filter((leaf) => chainCovers(segments, leaf));
      if (matching.length === 0) {
        problems.push(`${where}: ko.${segments.join('.')} 는 카탈로그에 없는 경로다.`);
        continue;
      }
      // 사슬이 잎에서 끝나지 않고 계산된 접근('*')도 없으면 객체를 통째로 넘기는 것이다.
      const exact = leafSet.has(segments.join('.'));
      const computed = segments.includes('*');
      if (!exact && !computed) {
        problems.push(`${where}: ko.${segments.join('.')} 는 문구 하나가 아니라 묶음이다(키 사용을 추적할 수 없다).`);
        continue;
      }
      for (const leaf of matching) used.add(leaf.join('.'));
    }
    literals.push(...collectLiteralSinks(path, text));
  }

  const unused = leafPaths.filter((leaf) => !used.has(leaf));
  return { leaves: leafPaths, unused, problems, literals };
}

async function listSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await listSources(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) result.push(full);
  }
  return result;
}

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const deepEqual = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

// ── 3. 검사기 시험(가짜 소스) ─────────────────────────────────────────────────────────────────────────────
{
  const catalog = `export const ko = {
    a: { b: '하나', c: '둘', fn: (n: number) => \`\${n}개\` },
    pedal: { x: { name: '엑스', controls: '엑스 컨트롤' }, y: { name: '와이', controls: '와이 컨트롤' } },
  } as const;`;
  const base = new Map([[CATALOG_PATH, catalog]]);
  const run = (extra) => analyze(new Map([...base, ...Object.entries(extra)]));

  // 모든 키를 읽으면 쓰지 않는 키가 없다(함수형 키 호출, 계산된 접근 포함).
  const clean = run({
    'src/u.tsx': "import { ko } from './i18n/ko';\nexport const f = (t: 'x' | 'y') => [ko.a.b, ko.a.c, ko.a.fn(2), ko.pedal[t].name, ko.pedal.x.controls, ko.pedal.y.controls];",
  });
  deepEqual(clean.unused, [], '모든 키를 읽으면 쓰지 않는 키가 없다');
  deepEqual(clean.problems, [], '문제 없음');
  deepEqual(clean.literals, [], '직접 쓴 문구 없음');
  equal(clean.leaves.length, 7, '잎 7개(a.b, a.c, a.fn, pedal.x.name/controls, pedal.y.name/controls)');

  // 안 읽은 키를 잡는다.
  deepEqual(run({ 'src/u.ts': 'export const f = [ko.a.b, ko.a.fn(1), ko.pedal.x.name, ko.pedal.x.controls, ko.pedal.y.name, ko.pedal.y.controls];' }).unused, ['a.c'], '읽지 않은 키(a.c)를 잡는다');
  // 계산된 접근은 같은 자리의 키만 쓴 것으로 센다 — controls 는 정적으로 읽어야 한다.
  deepEqual(
    run({ 'src/u.ts': 'export const f = (t: string) => [ko.a.b, ko.a.c, ko.a.fn(1), ko.pedal[t].name];' }).unused,
    ['pedal.x.controls', 'pedal.y.controls'],
    '계산된 접근(ko.pedal[t].name)은 name 만 읽은 것으로 센다',
  );
  // 다른 파일(e2e·scripts)의 읽기는 세지 않는다 — 입력이 src 뿐이다(listSources).

  // 통째 사용·묶음 사용·없는 경로·별칭.
  ok(run({ 'src/u.ts': 'export const k = ko;' }).problems.some((p) => p.includes('통째로')), 'ko 를 통째로 쓰면 문제로 본다');
  ok(run({ 'src/u.ts': 'export const k = ko.a;' }).problems.some((p) => p.includes('묶음')), '묶음(ko.a)을 넘기면 문제로 본다');
  ok(run({ 'src/u.ts': 'export const k = ko.a.zzz;' }).problems.some((p) => p.includes('없는 경로')), '없는 경로를 잡는다');
  ok(run({ 'src/u.ts': "import { ko as k } from './i18n/ko';" }).problems.some((p) => p.includes('다른 이름')), '별칭을 잡는다');

  // 직접 쓴 문구.
  const toast = run({ 'src/u.ts': "showToast({ message: '저장했습니다', kind: 'info', action: { label: 'Undo', onAction: f } });" });
  equal(toast.literals.length, 2, '토스트의 message·action.label 직접 문구를 둘 다 잡는다');
  deepEqual(run({ 'src/u.ts': 'showToast({ message: ko.a.b, kind: "info", action: { label: ko.a.c, onAction: f } });' }).literals, [], '키로 쓴 토스트는 통과');
  equal(run({ 'src/u.tsx': "setError('가져올 글을 붙여 넣어 주세요.');" }).literals.length, 1, 'setError 직접 문구');
  deepEqual(run({ 'src/u.tsx': 'setError(null); setError(ko.a.b); setMessage(formatX(r));' }).literals, [], 'null·키·함수 결과는 통과');
  equal(run({ 'src/store/audioStore.ts': "export const s = { error: `연결 실패: ${e}` };" }).literals.length, 1, '상태의 error: 직접 문구(템플릿)');
  equal(run({ 'src/store/audioStore.ts': "export const s = { midiError: 'MIDI failed' };" }).literals.length, 1, '영어 직접 문구도 잡는다');
  equal(run({ 'src/audio/utils/cabinetIr.ts': "throw new Error('WAV가 아닙니다.');" }).literals.length, 1, '사용자 대면 모듈의 new Error 직접 문구');
  deepEqual(run({ 'src/audio/utils/cabinetIr.ts': 'throw new Error(ko.a.b);' }).literals, [], 'new Error(키) 는 통과');
  deepEqual(run({ 'src/audio/params/index.ts': "throw new Error('파라미터 정의가 없습니다');" }).literals, [], '사용자에게 안 보이는 모듈의 내부 오류는 대상이 아니다');
  deepEqual(run({ 'src/audio/AudioEngine.ts': "throw new Error('setSinkId 없음');" }).literals, [], '예외 목록(setSinkId 없음)은 통과');
  equal(run({ 'src/u.tsx': "setNotice('설정을 저장했습니다.');" }).literals.length, 1, 'setNotice 직접 문구');
  equal(run({ 'src/u.tsx': "el.textContent = '출력 클리핑이 발생했습니다.';" }).literals.length, 1, 'textContent 직접 문구');
  deepEqual(run({ 'src/u.tsx': "el.textContent = ''; el.textContent = ko.a.b;" }).literals, [], 'textContent 비우기·키는 통과');
}

// ── 1·2. 실제 소스 검사 ────────────────────────────────────────────────────────────────────────────────────
const sourceFiles = await listSources(join(projectRoot, 'src'));
const files = new Map();
for (const file of sourceFiles) files.set(relative(projectRoot, file).split('\\').join('/'), await readFile(file, 'utf8'));
const result = analyze(files);

ok(result.leaves.length >= 150, `카탈로그 문구가 ${result.leaves.length}개다(기대 150개 이상 — 읽기에 실패하지 않았는지)`);
deepEqual(result.problems, [], '키 사용을 추적할 수 없는 곳이 없다');
deepEqual(result.unused, [], `쓰지 않는 키가 없다(카탈로그 ${result.leaves.length}개)`);
deepEqual(result.literals, [], '화면 문구를 만드는 자리에 한글·영어를 직접 쓰지 않는다');

console.log(`ko-catalog: ${checks} checks passed (카탈로그 문구 ${result.leaves.length}개, 쓰지 않는 키 ${result.unused.length}개, 직접 쓴 문구 ${result.literals.length}곳)`);
