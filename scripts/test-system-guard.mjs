// S4.7 (R4-7): 테스트 체계 구조 가드.
//
// 옛 테스트는 앱 소스 파일을 글자로 읽어 정규식으로 "이 문자열이 있다/없다" 를 단언했다. 그런 검사는 줄 바꿈·이름 변경에는
// 깨지고 로직이 망가져도 문자열만 남아 있으면 통과한다. S4.7 에서 337곳을 동작 검사(렌더된 DOM·계산된 스타일·오디오 렌더·
// 실제 키 입력)로 바꿨고, 이 가드는 그것이 다시 늘어나지 못하게 막는다.
//
// 규칙 1(0 고정). scripts/*.mjs 와 scripts/lib/*.mjs 에는 정규식 단언이 한 곳도 없어야 한다.
//   - assert.match / assert.doesNotMatch (strict 별칭, import { match }, const { match } = assert 포함)
//   - assert.ok(/…/.test(x)) 처럼 단언 첫 인자가 정규식 검사인 우회
// 규칙 2(동결·내림만 허용). 앱 소스(src/, index.html, vite.config, *.ts, *.tsx, *.css)를 글자로 읽는 테스트는 늘 수 없다.
//   - 아래 LEGACY_SOURCE_READERS 에 없는 스크립트가 소스를 읽으면 실패한다.
//   - 목록에 있어도 읽는 곳(호출 지점)이 늘면 실패한다.
//   - 읽는 곳이 줄었거나 아예 없어졌는데 목록이 그대로여도 실패한다 → 숫자를 내리거나 항목을 지워야 한다(래칫).
//
// 분석은 글자 검색이 아니라 TypeScript 파서(저장소에 이미 있는 devDependency)로 호출 구문을 직접 본다. 그래서 주석·문자열
// 속의 "assert.match" 같은 글자에는 반응하지 않는다. 가드 자신도 같은 규칙으로 검사받는다.
//
// 사용: node scripts/test-system-guard.mjs [--scripts <디렉터리>]   (--scripts 는 변이 시험·자가 시험용)
import assert from 'node:assert/strict';
import console from 'node:console';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

/**
 * 앱 소스를 아직 글자로 읽는 옛 테스트와 그 "읽는 곳" 수(S4.7 시점). 다음 Step 에서 동작 검사로 바꿀 때마다 숫자를 내리거나
 * 항목을 지운다. 늘리는 변경은 허용되지 않는다. 남은 위험으로 docs/refactoring/step-reports.md 의 S4.7 절에 같은 목록이 있다.
 */
export const LEGACY_SOURCE_READERS = Object.freeze({
  'app-notices-regression.mjs': 3,
  'cab-swap-regression.mjs': 3,
  'connect-errors-regression.mjs': 4,
  'delay-tape-regression.mjs': 1,
  'device-manager-regression.mjs': 5,
  'file-mode-regression.mjs': 5,
  'fuzz-gate-regression.mjs': 3,
  'knob-regression.mjs': 2,
  'ko-catalog-regression.mjs': 2,
  'latency-regression.mjs': 6,
  'level-warning-regression.mjs': 6,
  'midi-reconnect-regression.mjs': 5,
  'mix-law-regression.mjs': 4,
  'output-device-regression.mjs': 1,
  'oversample-regression.mjs': 1,
  'safe-storage-regression.mjs': 1,
  'safeguards-regression.mjs': 1,
  'tuner-reading-regression.mjs': 2,
  'tuner-regression.mjs': 3,
});

const READ_NAMES = new Set(['readFile', 'readFileSync', 'readdir', 'readdirSync']);
const ASSERT_MODULES = new Set(['node:assert', 'assert', 'node:assert/strict', 'assert/strict']);
const REGEX_ASSERT_NAMES = new Set(['match', 'doesNotMatch']);
const ASSERT_CALLABLES = new Set(['ok', 'equal', 'strictEqual', 'notEqual', 'notStrictEqual', 'deepEqual', 'deepStrictEqual']);
const REGEX_METHODS = new Set(['test', 'exec', 'match', 'matchAll', 'search']);
// 경로 조각으로서의 src(../src/…, 'src', `…/src/${x}`)와 앱 소스 파일 이름. icon.src 같은 속성 접근은 걸리지 않는다.
const SOURCE_TOKEN = /(?:^|['"`/])src(?:['"`/]|$)|index\.html|vite\.config|\.(?:tsx?|css)['"`)]/;
// 데이터(JSON)와 빌드 산출물(dist)은 "소스 글자"가 아니다.
const DATA_TOKEN = /\.json['"`)]|\bdist\w*/;

/** 한 파일의 정규식 단언 위치와 소스 글자 읽기 위치를 구한다. */
export function analyze(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes = [];
  const collect = (node) => {
    nodes.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  // 1. node:assert 에서 온 이름들.
  const assertNames = new Set();
  const namedAssert = new Map();
  const isAssertObject = (expr) => {
    if (ts.isIdentifier(expr)) return assertNames.has(expr.text);
    return ts.isPropertyAccessExpression(expr) && expr.name.text === 'strict' && ts.isIdentifier(expr.expression) && assertNames.has(expr.expression.text);
  };
  for (const node of nodes) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && ASSERT_MODULES.has(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (!clause) continue;
      if (clause.name) assertNames.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) assertNames.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const original = (element.propertyName ?? element.name).text;
          if (original === 'strict' || original === 'default') assertNames.add(element.name.text);
          else namedAssert.set(element.name.text, original);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = node.initializer;
      if (ts.isIdentifier(node.name) && isAssertObject(init)) assertNames.add(node.name.text);
      else if (ts.isIdentifier(node.name) && ts.isPropertyAccessExpression(init) && isAssertObject(init.expression)) namedAssert.set(node.name.text, init.name.text);
      else if (ts.isObjectBindingPattern(node.name) && isAssertObject(init)) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name)) namedAssert.set(element.name.text, (element.propertyName ?? element.name).getText(sf));
        }
      }
    }
  }

  // 2. 정규식 단언.
  const unwrap = (expr) => {
    let current = expr;
    for (;;) {
      if (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
      else if (ts.isPrefixUnaryExpression(current)) current = current.operand;
      else return current;
    }
  };
  const isRegexSource = (expr) => {
    const inner = unwrap(expr);
    if (ts.isRegularExpressionLiteral(inner)) return true;
    return (ts.isNewExpression(inner) || ts.isCallExpression(inner)) && ts.isIdentifier(inner.expression) && inner.expression.text === 'RegExp';
  };
  const isRegexCheck = (expr) => {
    const inner = unwrap(expr);
    if (!ts.isCallExpression(inner) || !ts.isPropertyAccessExpression(inner.expression) || !REGEX_METHODS.has(inner.expression.name.text)) return false;
    return isRegexSource(inner.expression.expression) || inner.arguments.some(isRegexSource);
  };
  const isAssertCall = (callee) => {
    if (ts.isIdentifier(callee)) return assertNames.has(callee.text) || ASSERT_CALLABLES.has(namedAssert.get(callee.text));
    return ts.isPropertyAccessExpression(callee) && ASSERT_CALLABLES.has(callee.name.text) && isAssertObject(callee.expression);
  };
  const regexAssertions = [];
  for (const node of nodes) {
    if (!ts.isCallExpression(node)) continue;
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && REGEX_ASSERT_NAMES.has(callee.name.text) && isAssertObject(callee.expression)) {
      regexAssertions.push({ line: lineOf(node), kind: `assert.${callee.name.text}` });
    } else if (ts.isIdentifier(callee) && REGEX_ASSERT_NAMES.has(namedAssert.get(callee.text))) {
      regexAssertions.push({ line: lineOf(node), kind: `assert.${namedAssert.get(callee.text)}` });
    } else if (isAssertCall(callee) && node.arguments.length > 0 && isRegexCheck(node.arguments[0])) {
      regexAssertions.push({ line: lineOf(node), kind: '정규식 검사를 단언에 넘김' });
    }
  }

  // 3. 소스 글자 읽기. 읽기 함수(readFile 등)와, 그것을 안에서 부르는 도우미(read, walk, listSources …)의 호출 지점을 본다.
  const calleeName = (callee) => (ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '');
  const functionBodies = new Map();
  for (const node of nodes) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) functionBodies.set(node.name.text, node.body);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      functionBodies.set(node.name.text, node.initializer.body);
    }
  }
  const helperNames = new Set();
  const callsRead = (body) => {
    let found = false;
    const visit = (node) => {
      if (found) return;
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        if (READ_NAMES.has(name) || helperNames.has(name)) found = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, body] of functionBodies) {
      if (!helperNames.has(name) && callsRead(body)) {
        helperNames.add(name);
        changed = true;
      }
    }
  }
  // 이름 → 그 이름에 대입된 식(변수 초기값·for-of 가 도는 대상). 호출 인자가 가리키는 경로를 거슬러 올라가 보는 데 쓴다.
  const bindings = new Map();
  const bind = (name, expr) => bindings.set(name, [...(bindings.get(name) ?? []), expr.getText(sf)]);
  for (const node of nodes) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bind(node.name.text, node.initializer);
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) if (ts.isIdentifier(declaration.name)) bind(declaration.name.text, node.expression);
    }
  }
  const resolved = (arg) => {
    const parts = [arg.getText(sf)];
    const seen = new Set();
    const expand = (node, depth) => {
      if (ts.isIdentifier(node) && !(node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !seen.has(node.text) && depth < 4) {
        seen.add(node.text);
        for (const text of bindings.get(node.text) ?? []) {
          parts.push(text);
          const inner = ts.createSourceFile('x.mjs', `(${text})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
          const visit = (child) => {
            expand(child, depth + 1);
            ts.forEachChild(child, visit);
          };
          visit(inner);
        }
      }
    };
    const visit = (child) => {
      expand(child, 0);
      ts.forEachChild(child, visit);
    };
    visit(arg);
    return parts.join('\n');
  };
  const sourceReads = [];
  for (const node of nodes) {
    if (!ts.isCallExpression(node)) continue;
    const name = calleeName(node.expression);
    if (!READ_NAMES.has(name) && !helperNames.has(name)) continue;
    if (node.arguments.length === 0) continue;
    const text = node.arguments.map(resolved).join('\n');
    if (SOURCE_TOKEN.test(text) && !DATA_TOKEN.test(text)) {
      sourceReads.push({ line: lineOf(node), call: node.getText(sf).replace(/\s+/g, ' ').slice(0, 90) });
    }
  }
  return { regexAssertions, sourceReads };
}

async function listScripts(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.mjs')).sort();
  const result = names.map((name) => ({ key: name, path: join(directory, name) }));
  const lib = join(directory, 'lib');
  const libNames = await readdir(lib).then((entries) => entries.filter((name) => name.endsWith('.mjs')).sort(), () => []);
  for (const name of libNames) result.push({ key: `lib/${name}`, path: join(lib, name) });
  return result;
}

/** scripts 디렉터리를 검사해 문제 목록과 통계를 돌려준다. */
export async function checkScripts(directory, allowlist = LEGACY_SOURCE_READERS) {
  const files = await listScripts(directory);
  const problems = [];
  const stats = { scripts: files.length, regexAssertions: 0, readers: 0, readSites: 0 };
  const seen = new Set();
  for (const { key, path } of files) {
    seen.add(key);
    const { regexAssertions, sourceReads } = analyze(key, await readFile(path, 'utf8'));
    for (const item of regexAssertions) {
      problems.push(`scripts/${key}:${item.line} ${item.kind} — 정규식 단언은 허용되지 않는다(R4-7). 렌더·계산된 값 같은 동작을 직접 검사하라.`);
    }
    stats.regexAssertions += regexAssertions.length;
    const allowed = Object.hasOwn(allowlist, key) ? allowlist[key] : 0;
    if (sourceReads.length > 0) {
      stats.readers += 1;
      stats.readSites += sourceReads.length;
    }
    if (sourceReads.length > allowed) {
      const where = sourceReads.map((item) => `:${item.line} ${item.call}`).join(' / ');
      problems.push(allowed === 0
        ? `scripts/${key} 가 앱 소스를 글자로 읽는다(${sourceReads.length}곳 — ${where}). 소스 글자 검사 대신 동작을 검사하라(R4-7).`
        : `scripts/${key} 의 소스 글자 읽기가 ${allowed}곳에서 ${sourceReads.length}곳으로 늘었다(${where}). 늘릴 수 없다(R4-7).`);
    } else if (sourceReads.length < allowed) {
      problems.push(`scripts/${key} 의 소스 글자 읽기가 ${allowed}곳에서 ${sourceReads.length}곳으로 줄었다. test-system-guard.mjs 의 LEGACY_SOURCE_READERS 를 ${sourceReads.length === 0 ? '지워' : `${sourceReads.length} 로 내려`} 줄어든 상태를 고정하라.`);
    }
  }
  for (const key of Object.keys(allowlist)) {
    if (!seen.has(key)) problems.push(`LEGACY_SOURCE_READERS 에 있는 scripts/${key} 가 더는 없다. 목록에서 지워라.`);
  }
  return { problems, stats };
}

// ---------------------------------------------------------------------------------------------
// 자가 시험: 가드가 위반을 정말 잡고(양성), 정상 코드를 잘못 잡지 않는지(음성) 먼저 확인한다.
// ---------------------------------------------------------------------------------------------
const regexKinds = (code) => analyze('fixture.mjs', code).regexAssertions.map((item) => item.kind);
const readCount = (code) => analyze('fixture.mjs', code).sourceReads.length;
const HEADER = "import assert from 'node:assert/strict';\n";
// 가드 소스에 호출 꼴 그대로의 글자가 남지 않도록(docs 의 글자 세는 도구가 가드를 세지 않게) 시험용 코드는 이름을 끼워 만든다.
const M = 'match';
const D = 'doesNotMatch';

async function selfTest() {
  // 정규식 단언: 잡혀야 하는 것.
  assert.deepEqual(regexKinds(`${HEADER}assert.${M}(text, /a/);`), ['assert.match']);
  assert.deepEqual(regexKinds(`${HEADER}assert.${D}(text, /a/);`), ['assert.doesNotMatch']);
  assert.deepEqual(regexKinds("import strict from 'node:assert';\nstrict.match(text, /a/);"), ['assert.match']);
  assert.deepEqual(regexKinds("import assert from 'node:assert';\nassert.strict.doesNotMatch(text, /a/);"), ['assert.doesNotMatch']);
  assert.deepEqual(regexKinds("import { strict as a } from 'node:assert';\na.match(text, /a/);"), ['assert.match']);
  assert.deepEqual(regexKinds("import { match } from 'node:assert/strict';\nmatch(text, /a/);"), ['assert.match']);
  assert.deepEqual(regexKinds("import { doesNotMatch as no } from 'node:assert';\nno(text, /a/);"), ['assert.doesNotMatch']);
  assert.deepEqual(regexKinds(`${HEADER}const { match } = assert;\nmatch(text, /a/);`), ['assert.match']);
  assert.deepEqual(regexKinds(`${HEADER}const check = assert.doesNotMatch;\ncheck(text, /a/);`), ['assert.doesNotMatch']);
  assert.deepEqual(regexKinds(`${HEADER}assert.ok(/a/.test(text));`), ['정규식 검사를 단언에 넘김']);
  assert.deepEqual(regexKinds(`${HEADER}assert.equal(/a/.test(text), true);`), ['정규식 검사를 단언에 넘김']);
  assert.deepEqual(regexKinds(`${HEADER}assert.ok(!/a/.test(text));`), ['정규식 검사를 단언에 넘김']);
  assert.deepEqual(regexKinds(`${HEADER}assert(text.match(/a/));`), ['정규식 검사를 단언에 넘김']);
  assert.deepEqual(regexKinds(`${HEADER}assert.ok(new RegExp('a').test(text));`), ['정규식 검사를 단언에 넘김']);
  assert.deepEqual(regexKinds(`${HEADER}assert.ok(re.test(text));\nassert.ok(text.search(new RegExp(x)) >= 0);`), []); // 정규식을 변수에 담은 것까지는 보지 않는다(소스 읽기 래칫이 막는다)
  // 정규식 단언: 잡히면 안 되는 것(오탐 방지).
  assert.deepEqual(regexKinds(`${HEADER}assert.ok(text.includes('a'));`), []);
  assert.deepEqual(regexKinds(`${HEADER}assert.equal(text.match(/a/)?.[0], 'a');`), []); // 값을 뽑아 비교하는 것은 단언이 아니라 계산이다
  assert.deepEqual(regexKinds(`${HEADER}const parts = text.match(/(\\d+)/);\nassert.equal(parts[1], '3');`), []);
  assert.deepEqual(regexKinds(`${HEADER}// assert.${M}(text, /a/)\nconst note = 'assert.${M}(text, /a/)';\nassert.ok(note);`), []);
  assert.deepEqual(regexKinds('const text = "abc";\ntext.match(/b/);\nother.match(text, /a/);\n/b/.test(text);'), []); // node:assert 가 아닌 match
  assert.deepEqual(regexKinds("import assert from 'node:assert/strict';\nassert.deepEqual(rows.map((row) => row.name.replace(/x/g, '')), ['a']);"), []);

  // 소스 읽기: 잡혀야 하는 것.
  assert.equal(readCount("import { readFile } from 'node:fs/promises';\nawait readFile(new URL('../src/a.ts', import.meta.url), 'utf8');"), 1);
  assert.equal(readCount("import { readFileSync } from 'node:fs';\nreadFileSync('./index.html', 'utf8');"), 1);
  assert.equal(readCount("import fs from 'node:fs';\nfs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');"), 1);
  assert.equal(readCount("const read = (rel) => readFile(new URL(rel, rootUrl), 'utf8');\nawait read('src/a.ts');\nawait read('../src/b.tsx');"), 2);
  assert.equal(readCount("const dir = new URL('../src/components/', import.meta.url);\nfor (const file of await readdir(dir)) await readFile(new URL(file, dir), 'utf8');"), 2);
  assert.equal(readCount("const src = (rel) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));\nawait readFile(src('a.ts'), 'utf8');"), 1);
  assert.equal(readCount("const root = fileURLToPath(new URL('../src', import.meta.url));\nconst walk = async (dir) => { for (const entry of await readdir(dir)) await walk(join(dir, entry)); };\nawait walk(root);"), 1);
  assert.equal(readCount("await readFile(`${base}/src/audio/${name}.ts`, 'utf8');"), 1);
  assert.equal(readCount("await readFile('theme.css', 'utf8');"), 1);
  // 소스 읽기: 잡히면 안 되는 것(데이터·산출물·고정 파일).
  assert.equal(readCount("await readFile(new URL('../src/audio/params/latency.json', import.meta.url), 'utf8');"), 0);
  assert.equal(readCount("await readFile(join(root, 'package.json'), 'utf8');"), 0);
  assert.equal(readCount("const dist = join(root, 'dist');\nawait readFile(join(dist, 'index.html'), 'utf8');\nawait readFile(distFile(icon.src));"), 0);
  assert.equal(readCount("const fixturePath = new URL('./fixtures/a.txt', import.meta.url);\nawait readFile(fixturePath, 'utf8');"), 0);
  assert.equal(readCount("const read = (rel) => readFile(new URL(rel, rootUrl), 'utf8');\nawait read('docs/baseline/audio-probe.json');"), 0);
  assert.equal(readCount("await build({ entryPoints: ['src/audio/AudioEngine.ts'], bundle: true, write: false });"), 0); // 번들해서 실행하는 것은 동작 검사다
  assert.equal(readCount("// readFile('src/a.ts')\nconst note = \"readFile('src/a.ts')\";"), 0);
  assert.equal(readCount("const read = (rel) => readFile(new URL(rel, rootUrl), 'utf8');"), 0); // 정의만으로는 읽지 않는다

  // 디렉터리 검사: 새 위반, 늘어남, 줄어듦, 사라진 항목을 각각 알아낸다.
  const root = await mkdtemp(join(tmpdir(), 'test-system-guard-'));
  try {
    await mkdir(join(root, 'lib'));
    const put = (name, code) => writeFile(join(root, name), code);
    await put('clean-regression.mjs', `${HEADER}assert.ok(true);\n`);
    await put('regex-regression.mjs', `${HEADER}assert.${M}('a', /a/);\n`);
    await put('new-reader-regression.mjs', "import { readFile } from 'node:fs/promises';\nawait readFile('src/a.ts', 'utf8');\n");
    await put('grown-regression.mjs', "import { readFile } from 'node:fs/promises';\nawait readFile('src/a.ts', 'utf8');\nawait readFile('src/b.ts', 'utf8');\n");
    await put('shrunk-regression.mjs', "import { readFile } from 'node:fs/promises';\nawait readFile('src/a.ts', 'utf8');\n");
    await put('fixed-regression.mjs', `${HEADER}assert.ok(true);\n`);
    await put('frozen-regression.mjs', "import { readFile } from 'node:fs/promises';\nawait readFile('src/a.ts', 'utf8');\n");
    await put('lib/helper.mjs', `${HEADER}assert.${D}('a', /b/);\n`);
    const result = await checkScripts(root, {
      'grown-regression.mjs': 1,
      'shrunk-regression.mjs': 3,
      'fixed-regression.mjs': 1,
      'frozen-regression.mjs': 1,
      'gone-regression.mjs': 1,
    });
    const text = result.problems.join('\n');
    assert.equal(result.problems.length, 7, text);
    assert.ok(text.includes('scripts/regex-regression.mjs:2 assert.match'), text);
    assert.ok(text.includes('scripts/lib/helper.mjs:2 assert.doesNotMatch'), text);
    assert.ok(text.includes('scripts/new-reader-regression.mjs 가 앱 소스를 글자로 읽는다'), text);
    assert.ok(text.includes('scripts/grown-regression.mjs 의 소스 글자 읽기가 1곳에서 2곳으로 늘었다'), text);
    assert.ok(text.includes('scripts/shrunk-regression.mjs 의 소스 글자 읽기가 3곳에서 1곳으로 줄었다'), text);
    assert.ok(text.includes('scripts/fixed-regression.mjs 의 소스 글자 읽기가 1곳에서 0곳으로 줄었다'), text);
    assert.ok(text.includes('scripts/gone-regression.mjs 가 더는 없다'), text);
    assert.deepEqual(result.stats, { scripts: 8, regexAssertions: 2, readers: 4, readSites: 5 });
    assert.deepEqual((await checkScripts(root, { 'frozen-regression.mjs': 1, 'grown-regression.mjs': 2, 'shrunk-regression.mjs': 1, 'new-reader-regression.mjs': 1 })).problems.length, 2); // regex 2건만 남는다
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const argumentList = process.argv.slice(2);
  const index = argumentList.indexOf('--scripts');
  const directory = index >= 0 ? argumentList[index + 1] : fileURLToPath(new URL('./', import.meta.url));
  if (!directory) throw new Error('--scripts 다음에 디렉터리가 필요하다');
  await selfTest();
  const { problems, stats } = await checkScripts(directory);
  if (problems.length > 0) {
    console.error(`테스트 체계 가드 실패(${problems.length}건):`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Test-system guard passed: ${stats.scripts} scripts, regex assertions ${stats.regexAssertions}, legacy source readers ${stats.readers} (${stats.readSites} read sites, frozen — can only go down)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
