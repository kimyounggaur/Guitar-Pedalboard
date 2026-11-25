import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const result = await build({
  plugins: [workerUrlStub],
  stdin: { contents: "export { knobDragValue } from './src/hooks/useKnobDrag.ts'; export { usePedalStore, initialPedals } from './src/store/pedalStore.ts'; export { knobDefault } from './src/components/knobDefaults.ts'; export { DelayPedal } from './src/components/effects/DelayPedal.tsx'; export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');" },
});
const { knobDragValue, usePedalStore, knobDefault, initialPedals, DelayPedal, createElement, renderToStaticMarkup } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
assert.equal(knobDragValue(50, 20, 0, 100, 1), 60);
assert.equal(knobDragValue(50, -20, 0, 100, 1), 40);
assert.equal(knobDragValue(50, 1000, 0, 100, 1), 100);
assert.equal(knobDragValue(50, -1000, 0, 100, 1), 0);
assert.equal(knobDragValue(0.5, 25, 0, 1, 0.01), 0.63);
// S4.4: 200 px = 전체 범위(위로 100 px = 50%), Shift(정밀) = 1/10
assert.equal(knobDragValue(0, 100, 0, 100, 1), 50);
assert.equal(knobDragValue(0, 100, 0, 100, 1, true), 5);
assert.equal(knobDragValue(50, -100, 0, 100, 1, true), 45);
assert.equal(knobDragValue(1, 100, 0.2, 6, 0.1, true), 1.3);
assert.equal(knobDragValue(0, 100, 0, 100, 1, false), knobDragValue(0, 100, 0, 100, 1), 'fine 을 주지 않으면 일반 끌기');
// Delay 시간(20~2000 ms, 1 ms 단위): 1 px 에 일반 ≤ 10 ms, Shift ≤ 1 ms(옛 33 ms)
assert.ok(knobDragValue(20, 1, 20, 2000, 1) - 20 > 0 && knobDragValue(20, 1, 20, 2000, 1) - 20 <= 10);
assert.ok(knobDragValue(20, 1, 20, 2000, 1, true) - 20 <= 1);
assert.ok(knobDragValue(20, 20, 20, 2000, 1, true) - 20 >= 15, 'Shift 로 20 px 끌면 20 ms 안팎(너무 둔하지 않다)');
const before = usePedalStore.getState().pedals;
usePedalStore.getState().updatePedalParam('drive', 'drive', 43);
const after = usePedalStore.getState().pedals;
assert.notEqual(after.find(p => p.id === 'drive'), before.find(p => p.id === 'drive'));
assert.equal(after.find(p => p.id === 'fuzz'), before.find(p => p.id === 'fuzz'));
const effectsDirectory = new URL('../src/components/effects/', import.meta.url);
let checkedDefaults = 0;
for (const file of await readdir(effectsDirectory)) {
  if (!file.endsWith('.tsx')) continue;
  const source = await readFile(new URL(file, effectsDirectory), 'utf8');
  for (const match of source.matchAll(/knobDefault\('([^']+)', '([^']+)'\)/g)) {
    assert.ok(Number.isFinite(knobDefault(match[1], match[2])), `${file}: ${match[1]}.${match[2]}`);
    checkedDefaults += 1;
  }
}
assert.ok(checkedDefaults > 50, '공통 노브 기본값이 연결되어야 합니다.');
assert.equal(knobDefault('drive', 'tone'), 55);
assert.equal(knobDefault('reverb', 'decay'), 1.8);
assert.throws(() => knobDefault('drive', 'invalid'));
const delay = initialPedals.find((pedal) => pedal.type === 'delay');
const syncMarkup = renderToStaticMarkup(createElement(DelayPedal, { pedalId: delay.id, params: { ...delay.params, sync: true }, onChange() {} }));
const syncInputs = [...syncMarkup.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
assert.ok(syncInputs.some((input) => input.includes('aria-label="D.Time"') && input.includes('disabled')));
assert.ok(syncInputs.some((input) => input.includes('aria-label="D.Time 값 직접 입력"') && input.includes('disabled')));
const freeMarkup = renderToStaticMarkup(createElement(DelayPedal, { pedalId: delay.id, params: { ...delay.params, sync: false }, onChange() {} }));
const freeInput = [...freeMarkup.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).find((input) => input.includes('aria-label="D.Time 값 직접 입력"'));
assert.ok(freeInput && !freeInput.includes('disabled'));
assert.ok(freeMarkup.includes('data-knob-drag'), 'Delay 노브의 끌기 껍데기에 표지가 있다(S4.4: 포인터는 입력이 아니라 껍데기가 받는다)');
assert.ok(![...freeMarkup.matchAll(/<input\b[^>]*>/g)].some((match) => match[0].includes('data-knob-drag')), '끌기 핸들러는 range 입력이 아니라 껍데기에 있다');
console.log('Knob drag and unchanged pedal identity regression passed.');
