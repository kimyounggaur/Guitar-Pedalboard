// S0.1: scripts/*-regression.mjs 의 정규식 단언(assert.match / assert.doesNotMatch) 위치 목록을 만든다.
// 사용: node docs/refactoring/tools/list-regex-assertions.mjs > docs/refactoring/regex-assertions.md
// 읽기 전용이며 앱 코드나 테스트를 바꾸지 않는다.
import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';

const scriptsDir = fileURLToPath(new URL('../../../scripts/', import.meta.url));
const files = readdirSync(scriptsDir).filter((name) => name.endsWith('.mjs')).sort();

const CALL = /assert\.(match|doesNotMatch)\(/g;

/** 호출 괄호 안에서 첫 인자(깊이 0의 첫 쉼표 앞)와 나머지 앞부분을 잘라 낸다. */
function splitArguments(text, openIndex) {
  let depth = 0;
  let quote = '';
  let first = '';
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      first += ch;
      if (ch === '\\') { first += text[i + 1] ?? ''; i += 1; } else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; first += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (depth < 0) return { subject: first.trim(), rest: '' };
    if (ch === ',' && depth === 0) {
      return { subject: first.trim(), rest: text.slice(i + 1, i + 200) };
    }
    first += ch;
  }
  return { subject: first.trim(), rest: '' };
}

const rows = [];
for (const name of files) {
  const text = readFileSync(join(scriptsDir, name), 'utf8');
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const match of text.matchAll(CALL)) {
    const { subject, rest } = splitArguments(text, match.index + match[0].length);
    rows.push({
      file: name,
      line: lineOf(match.index),
      kind: match[1],
      subject: subject.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 40),
      pattern: rest.split(/\)\s*;/)[0].trim().replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 70),
    });
  }
}

const perFile = new Map();
for (const row of rows) {
  const entry = perFile.get(row.file) ?? { match: 0, doesNotMatch: 0 };
  entry[row.kind] += 1;
  perFile.set(row.file, entry);
}
const total = rows.length;
const totalMatch = rows.filter((row) => row.kind === 'match').length;

const out = [];
out.push('# 정규식 단언 위치 목록');
out.push('');
out.push('> `node docs/refactoring/tools/list-regex-assertions.mjs` 로 생성한 파일이다(수정하지 말고 다시 생성한다).');
out.push('> 세는 대상은 `assert.match(` 와 `assert.doesNotMatch(` 호출이다. 보고서의 "337곳"은 기준 커밋 `4ac9cf7`에서 이 두 호출을 센 값과 같다(316 + 21).');
out.push('');
out.push(`**현재(HEAD) 합계: ${total}곳** (match ${totalMatch} + doesNotMatch ${total - totalMatch})`);
out.push('');
out.push('| 파일 | match | doesNotMatch | 합계 |');
out.push('|---|---:|---:|---:|');
for (const [file, entry] of perFile) {
  out.push(`| ${file} | ${entry.match} | ${entry.doesNotMatch} | ${entry.match + entry.doesNotMatch} |`);
}
out.push(`| **합계** | **${totalMatch}** | **${total - totalMatch}** | **${total}** |`);
out.push('');
out.push('## 파일별 위치');
let current = '';
for (const row of rows) {
  if (row.file !== current) {
    current = row.file;
    out.push('');
    out.push(`### ${current}`);
    out.push('');
    out.push('| 줄 | 종류 | 검사 대상 | 패턴(앞 70자) |');
    out.push('|---:|---|---|---|');
  }
  out.push(`| ${row.line} | ${row.kind === 'match' ? 'match' : '!match'} | \`${row.subject}\` | \`${row.pattern.replace(/`/g, "'")}\` |`);
}
out.push('');
process.stdout.write(out.join('\n'));
