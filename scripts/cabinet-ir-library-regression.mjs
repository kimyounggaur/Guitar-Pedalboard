// 사용자 캐비닛 IR 라이브러리(S5.4): 가져오기 → 1초 자르기 → 저장 → 컨텍스트 샘플레이트 맞춤 → 에너지 정규화.
// 브라우저 오디오(디코딩·리샘플)와 저장소는 가짜로 바꿔 끼우고, 라이브러리가 그것들을 어떤 순서로 어떻게 쓰는지 본다.
// 진짜 브라우저(OfflineAudioContext 디코딩·IndexedDB·소리)는 e2e s5-4 와 프로브가 본다.
import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer, File } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const bundle = await build({
  stdin: {
    contents: [
      "export { CabinetIrLibrary, DEFAULT_IR_DECODE_RATE } from './audio/cabinetIrLibrary.ts';",
      "export { normalizeUserImpulse } from './audio/utils/cabinet.ts';",
      "export { ko } from './i18n/ko.ts';",
    ].join('\n'),
    resolveDir: srcDir, sourcefile: 'cabinet-ir-library-entry.ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { CabinetIrLibrary, DEFAULT_IR_DECODE_RATE, normalizeUserImpulse, ko } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function wavFile(name, { seconds = 0.1, sampleRate = 48000, channels = 1 } = {}) {
  const align = channels * 2, size = Math.round(seconds * sampleRate) * align;
  const data = new ArrayBuffer(44 + size), view = new DataView(data);
  for (const [at, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) for (let i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i));
  view.setUint32(4, data.byteLength - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * align, true); view.setUint16(32, align, true); view.setUint16(34, 16, true); view.setUint32(40, size, true);
  return new File([data], name);
}
/** 낮은 소리가 우세한 IR(정규화가 의미 있도록 평평하지 않은 응답). */
function impulse(frames, gain = 0.02) {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = gain * Math.exp(-i / 96) * (1 + 0.3 * Math.sin(i * 0.05));
  return out;
}

function createWorld({ stored = null, saveFails = false, loadFails = false, decodeFails = false } = {}) {
  const world = {
    stored, saves: [], clears: 0, loads: 0, decodes: [], resamples: [], buffers: [], changes: 0,
    nextDecode: null, saveFails, loadFails, decodeFails, saveGate: null, loadGate: null,
  };
  const store = {
    async load() {
      world.loads += 1; const value = world.stored;
      if (world.loadGate) await world.loadGate;
      if (world.loadFails) throw new Error('읽기 실패');
      return value;
    },
    async save(record) {
      if (world.saveGate) await world.saveGate;
      if (world.saveFails) throw new Error('쓰기 실패');
      world.saves.push(record); world.stored = record;
    },
    async clear() { world.clears += 1; world.stored = null; },
  };
  const audio = {
    async decode(bytes, rate) {
      world.decodes.push({ size: bytes.byteLength, rate });
      if (world.decodeFails) throw new Error('디코딩 실패');
      return world.nextDecode ?? { sampleRate: rate, channels: [impulse(4800)] };
    },
    async resample(source, targetRate) {
      world.resamples.push({ from: source.sampleRate, to: targetRate });
      const frames = Math.round(source.channels[0].length * targetRate / source.sampleRate);
      return { sampleRate: targetRate, channels: source.channels.map((channel) => Float32Array.from({ length: frames }, (_, i) => channel[Math.min(channel.length - 1, Math.round(i * source.sampleRate / targetRate))])) };
    },
    createBuffer(source) {
      const buffer = { sampleRate: source.sampleRate, numberOfChannels: source.channels.length, length: source.channels[0].length, channels: source.channels };
      world.buffers.push(buffer);
      return buffer;
    },
  };
  world.library = new CabinetIrLibrary(store, audio, () => { world.changes += 1; });
  return world;
}

// ── 가져오기: 검사 ──
{
  const world = createWorld();
  const { library } = world;
  for (const [label, file] of [['wav 아님', new File([new ArrayBuffer(100)], 'ir.mp3')], ['4 MB 초과', new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.wav')]]) {
    await assert.rejects(library.importFile(file, 48000), (error) => error.message === ko.cabinetIr.fileTooBig, label);
  }
  await assert.rejects(library.importFile(new File([new ArrayBuffer(100)], 'bad.wav'), 48000), (error) => error.message === ko.cabinetIr.fileTooBig || error.message === ko.cabinetIr.notWav, '깨진 WAV');
  {
    // 4 MB 가 넘는 파일은 읽지도 않고 거절한다(메모리에 올리기 전에 막는다).
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'huge.wav');
    let read = false;
    big.arrayBuffer = async () => { read = true; return new ArrayBuffer(0); };
    await assert.rejects(library.importFile(big, 48000), (error) => error.message === ko.cabinetIr.fileTooBig);
    assert.equal(read, false, '너무 큰 파일은 바이트를 읽지 않는다');
    const named = new File([new ArrayBuffer(100)], 'ir.txt');
    let readNamed = false;
    named.arrayBuffer = async () => { readNamed = true; return new ArrayBuffer(0); };
    await assert.rejects(library.importFile(named, 48000), (error) => error.message === ko.cabinetIr.fileTooBig);
    assert.equal(readNamed, false, '.wav 가 아닌 파일도 읽지 않는다');
  }
  assert.equal(world.decodes.length, 0, '검사에 걸린 파일은 디코딩하지 않는다');
  assert.equal(world.saves.length, 0, '검사에 걸린 파일은 저장하지 않는다');
  assert.equal(library.info(), null);

  world.decodeFails = true;
  await assert.rejects(library.importFile(wavFile('ok.wav'), 48000), (error) => error.message === ko.cabinetIr.readFailed, '디코딩 실패는 읽기 실패 문구');
  world.decodeFails = false;

  world.nextDecode = { sampleRate: 48000, channels: [new Float32Array(4800)] };
  await assert.rejects(library.importFile(wavFile('silent.wav'), 48000), (error) => error.message === ko.cabinetIr.silent, '무음');
  world.nextDecode = { sampleRate: 48000, channels: [Float32Array.of(NaN, 0.1)] };
  await assert.rejects(library.importFile(wavFile('nan.wav'), 48000), (error) => error.message === ko.cabinetIr.badSample, '숫자가 아닌 값');
  assert.equal(world.saves.length, 0); assert.equal(library.info(), null);
  world.nextDecode = null;
}

// ── 가져오기: 자르기·저장·정보 ──
{
  const world = createWorld();
  const { library } = world;
  world.nextDecode = { sampleRate: 48000, channels: [impulse(72000)] }; // 1.5 초
  const result = await library.importFile(wavFile('long.wav', { seconds: 1.5 }), 48000);
  assert.deepEqual(result, { info: { name: 'long.wav', cut: true, originalSeconds: 1.5 }, persisted: true });
  assert.deepEqual(library.info(), result.info);
  assert.equal(world.decodes[0].rate, 48000, '컨텍스트 샘플레이트로 디코딩한다');
  const saved = world.saves[0];
  assert.equal(saved.channels[0].length, 48000, '저장되는 것은 앞 1초');
  assert.equal(saved.cut, true); assert.equal(saved.sampleRate, 48000); assert.equal(saved.originalSeconds, 1.5);
  assert.equal(saved.channels[0][47999], 0, '자른 끝은 0 으로 내려간다(페이드)');
  assert.ok(world.changes >= 1, '화면에 알린다');

  world.nextDecode = null; // 앞 검사에서 지정한 1.5 초 디코딩 결과를 비운다
  const short = await library.importFile(wavFile('short.wav'), 48000);
  assert.equal(short.info.cut, false, '1초 이하는 잘리지 않는다');
  assert.equal(world.saves.at(-1).channels[0].length, 4800);
  assert.equal(library.info().name, 'short.wav', '새 IR 이 이전 것을 대신한다');
}

// ── 가져오기: 컨텍스트가 없을 때 · 저장 실패 ──
{
  const world = createWorld();
  await world.library.importFile(wavFile('a.wav'));
  assert.equal(world.decodes[0].rate, DEFAULT_IR_DECODE_RATE, '컨텍스트가 없으면 기본 샘플레이트로 디코딩한다');

  const failing = createWorld({ saveFails: true });
  const result = await failing.library.importFile(wavFile('b.wav'), 48000);
  assert.equal(result.persisted, false, '저장에 실패해도 가져오기는 성공하고 저장 여부만 알린다');
  assert.equal(failing.library.info().name, 'b.wav', '이번 접속에서는 쓸 수 있다');
  const prepared = await failing.library.prepare(48000);
  assert.ok(prepared, '저장 실패여도 준비할 수 있다');
}

// ── 겹친 가져오기: 나중 것이 이긴다 ──
{
  const world = createWorld();
  const { library } = world;
  let release = null;
  const originalDecode = library.audio.decode;
  // 첫 디코딩만 붙잡아 두고, 그 사이에 두 번째 가져오기를 끝낸다.
  library.audio.decode = async (bytes, rate) => {
    if (!release) await new Promise((resolve) => { release = resolve; });
    return originalDecode(bytes, rate);
  };
  const first = library.importFile(wavFile('slow.wav'), 48000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(release, '첫 가져오기가 디코딩에서 멈춰 있다');
  await library.importFile(wavFile('fast.wav'), 48000);
  release();
  await assert.rejects(first, (error) => error.message === ko.cabinetIr.cancelled, '먼저 시작한 가져오기는 취소된다');
  assert.equal(library.info().name, 'fast.wav');
  assert.equal(world.saves.filter((record) => record.name === 'slow.wav').length, 0, '취소된 것은 저장하지 않는다');
  assert.equal(world.stored.name, 'fast.wav', '저장소에도 나중 것만 남는다');
}

// ── 준비: 정규화·샘플레이트·캐시 ──
{
  const world = createWorld();
  const { library } = world;
  assert.equal(library.ready(48000), null, '가져오기 전에는 준비된 것이 없다');
  assert.equal(await library.prepare(48000), null, '저장된 IR 이 없으면 null');
  world.nextDecode = { sampleRate: 48000, channels: [impulse(4800)] };
  await library.importFile(wavFile('x.wav'), 48000);
  assert.equal(library.ready(48000), null, '가져오기만으로는 준비되지 않는다(컨텍스트에 맞춰 준비해야 한다)');

  const prepared = await library.prepare(48000);
  const expected = normalizeUserImpulse(world.saves[0].channels, 48000);
  assert.equal(prepared.buffer.sampleRate, 48000);
  assert.equal(prepared.makeupDb, expected.makeupDb);
  assert.deepEqual([...prepared.buffer.channels[0]], [...expected.channels[0]], '정규화한 시료로 버퍼를 만든다');
  assert.notDeepEqual([...prepared.buffer.channels[0].slice(0, 5)], [...world.saves[0].channels[0].slice(0, 5)], '저장된 원본은 정규화하지 않는다');
  assert.equal(world.resamples.length, 0, '샘플레이트가 같으면 리샘플하지 않는다');
  assert.equal(library.ready(48000), prepared, '준비된 것은 동기로 얻는다');
  assert.equal(library.ready(44100), null, '다른 샘플레이트로는 준비되지 않았다');
  assert.equal(await library.prepare(48000), prepared, '같은 샘플레이트를 다시 준비하면 캐시를 쓴다');
  assert.equal(world.buffers.length, 1, '버퍼는 한 번만 만든다');

  // 다른 샘플레이트: 리샘플한 뒤 그 샘플레이트로 정규화한다
  const at44 = await library.prepare(44100);
  assert.deepEqual(world.resamples, [{ from: 48000, to: 44100 }], '샘플레이트가 다르면 OfflineAudioContext 로 리샘플한다');
  assert.equal(at44.buffer.sampleRate, 44100);
  assert.equal(at44.buffer.length, 4410);
  assert.equal(library.ready(44100), at44); assert.equal(library.ready(48000), null, '캐시는 마지막으로 준비한 하나');

  // 동시에 같은 준비를 부르면 한 번만 한다
  const world2 = createWorld();
  await world2.library.importFile(wavFile('y.wav'), 48000);
  const [a, b] = await Promise.all([world2.library.prepare(48000), world2.library.prepare(48000)]);
  assert.equal(a, b); assert.equal(world2.buffers.length, 1, '동시 준비는 한 번만 만든다');

  // 리샘플이 필요한 준비는 비동기라서, 동시에 부르면 합쳐지지 않을 때 리샘플을 두 번 한다.
  const world3 = createWorld();
  await world3.library.importFile(wavFile('w.wav'), 48000);
  const [c, d] = await Promise.all([world3.library.prepare(44100), world3.library.prepare(44100)]);
  assert.equal(c, d, '같은 준비는 같은 결과를 돌려준다');
  assert.equal(world3.resamples.length, 1, '동시에 같은 샘플레이트를 준비해도 리샘플은 한 번');
  assert.equal(world3.buffers.length, 1);
  // 다른 샘플레이트 준비는 합치지 않는다.
  const [e, f] = await Promise.all([world3.library.prepare(32000), world3.library.prepare(22050)]);
  assert.equal(e.buffer.sampleRate, 32000); assert.equal(f.buffer.sampleRate, 22050);

  // 준비된 것의 세대가 IR 세대와 어긋나면(방어선) 쓰지 않는다.
  const stale = await world3.library.prepare(44100);
  assert.equal(world3.library.ready(44100), stale);
  world3.library.revision += 1;
  assert.equal(world3.library.ready(44100), null, '세대가 달라진 준비물은 동기로 내주지 않는다');
}

// ── 준비하는 사이에 IR 이 바뀌면 새 IR 로 다시 준비한다 / 지우면 준비된 것도 사라진다 ──
{
  const world = createWorld();
  const { library } = world;
  world.nextDecode = { sampleRate: 48000, channels: [impulse(4800, 0.02)] };
  await library.importFile(wavFile('one.wav'), 48000);
  world.nextDecode = { sampleRate: 48000, channels: [impulse(2400, 0.05)] };
  const originalResample = library.audio.resample;
  let swapped = false;
  // 리샘플(비동기)이 끝나기 전에 사용자가 다른 IR 을 가져온다.
  library.audio.resample = async (source, rate) => {
    if (!swapped) { swapped = true; await library.importFile(wavFile('two.wav'), 48000); }
    return originalResample(source, rate);
  };
  const result = await library.prepare(44100);
  assert.ok(swapped, '준비하는 도중에 IR 이 바뀌었다');
  assert.equal(library.info().name, 'two.wav');
  assert.equal(result.buffer.length, 2205, '돌려주는 것은 새 IR(2400 프레임 → 44.1 kHz)로 만든 것이다');
  assert.equal(library.ready(44100), result, '준비된 것도 최신 IR 의 것이다');
  assert.equal(world.buffers.filter((buffer) => buffer.length === 2205).length, 1, '새 IR 의 버퍼는 한 번 만든다');
  library.audio.resample = originalResample;

  await library.remove();
  assert.equal(library.info(), null); assert.equal(library.ready(44100), null, '지우면 준비된 것도 쓸 수 없다');
  assert.equal(await library.prepare(44100), null);
  assert.equal(world.clears, 1, '저장소에서도 지운다');
  assert.equal(world.stored, null);
}

// ── 저장소에서 읽기 ──
{
  const record = { name: 'saved.wav', sampleRate: 48000, cut: true, originalSeconds: 1.2, channels: [impulse(4800)], savedAt: 5 };
  const world = createWorld({ stored: record });
  const { library } = world;
  assert.equal(library.info(), null, '읽기 전에는 정보가 없다');
  await library.load();
  assert.deepEqual(library.info(), { name: 'saved.wav', cut: true, originalSeconds: 1.2 }, '저장소의 IR 이 보인다(새로고침 뒤 유지)');
  assert.ok(world.changes >= 1, '읽으면 화면에 알린다');
  await library.load(); await library.load();
  assert.equal(world.loads, 1, '저장소는 한 번만 읽는다');
  const prepared = await library.prepare(48000);
  assert.ok(prepared && prepared.buffer.sampleRate === 48000, '읽은 IR 을 준비한다');

  const empty = createWorld();
  await empty.library.load();
  assert.equal(empty.library.info(), null);
  assert.equal(empty.changes, 0, '없으면 알릴 것도 없다');

  const broken = createWorld({ loadFails: true });
  await broken.library.load();
  assert.equal(broken.library.info(), null, '읽기 실패는 저장된 IR 없음으로 본다(앱 시작을 막지 않는다)');
  assert.equal(await broken.library.prepare(48000), null);

  // 읽는 동안 사용자가 새 IR 을 불렀으면 저장소의 옛 값이 덮지 않는다
  const racing = createWorld({ stored: record });
  const slowLoad = racing.library.load();
  await racing.library.importFile(wavFile('fresh.wav'), 48000);
  await slowLoad;
  assert.equal(racing.library.info().name, 'fresh.wav', '새로 가져온 IR 이 저장소의 옛 IR 보다 우선한다');

  // 저장소 읽기를 붙잡아 두고 그 사이에 가져오기를 끝낸다: 늦게 돌아온 옛 기록이 새 IR 을 덮으면 안 된다.
  const gated = createWorld({ stored: record });
  let openLoad;
  gated.loadGate = new Promise((resolve) => { openLoad = resolve; });
  const pendingLoad = gated.library.load();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await gated.library.importFile(wavFile('typed.wav'), 48000);
  openLoad();
  await pendingLoad;
  assert.equal(gated.library.info().name, 'typed.wav', '읽기가 늦게 끝나도 새로 가져온 IR 이 남는다');
  assert.equal(gated.stored.name, 'typed.wav', '저장소의 내용도 새 IR');
  assert.equal(gated.library.ready(48000), null);
  assert.equal((await gated.library.prepare(48000)).buffer.length, 4800, '준비되는 것도 새 IR');
}

// ── 다른 탭이 바꾼 저장소 따라가기(refresh) ──
{
  const record = (name, savedAt) => ({ name, sampleRate: 48000, cut: false, originalSeconds: 0.1, channels: [impulse(4800)], savedAt });

  // 다른 탭이 IR 을 올렸다: 이 탭은 모르고 있다가 다시 읽으면 따라간다.
  const world = createWorld();
  await world.library.load();
  assert.equal(world.library.info(), null);
  world.stored = record('other-tab.wav', 11);
  const changesBefore = world.changes;
  assert.equal(await world.library.refresh(), true, '저장소에 새 IR 이 있으면 따라간다');
  assert.equal(world.library.info().name, 'other-tab.wav');
  assert.equal(world.changes, changesBefore + 1, '화면에 알린다');
  assert.equal(world.library.ready(48000), null, '이전에 준비한 것은 쓰지 않는다');
  assert.ok(await world.library.prepare(48000), '따라간 IR 을 준비할 수 있다');

  // 달라진 것이 없으면 아무 일도 없다(화면을 다시 그리지도 않는다).
  const quietChanges = world.changes;
  assert.equal(await world.library.refresh(), false);
  assert.equal(world.changes, quietChanges, '같은 기록이면 알리지 않는다');

  // 다른 탭이 IR 을 바꿨다 → 새 것을 따라가고, 지웠다 → 이 탭도 없다고 본다.
  world.stored = record('replaced.wav', 12);
  assert.equal(await world.library.refresh(), true);
  assert.equal(world.library.info().name, 'replaced.wav');
  world.stored = null;
  assert.equal(await world.library.refresh(), true, '다른 탭이 지웠으면 이 탭도 지운 것으로 본다');
  assert.equal(world.library.info(), null);
  assert.equal(await world.library.prepare(48000), null);

  // 저장하지 못한 이번 접속 한정 IR 은 저장소가 비어 있어도(또는 다른 IR 이 있어도) 덮이지 않는다.
  const sessionOnly = createWorld({ saveFails: true });
  await sessionOnly.library.importFile(wavFile('only-here.wav'), 48000);
  assert.equal(await sessionOnly.library.refresh(), false, '저장 실패로 이번 접속에만 있는 IR 은 지킨다');
  assert.equal(sessionOnly.library.info().name, 'only-here.wav');
  sessionOnly.stored = record('someone-else.wav', 99);
  assert.equal(await sessionOnly.library.refresh(), false);
  assert.equal(sessionOnly.library.info().name, 'only-here.wav');
  // 그 뒤 저장에 성공하는 IR 을 가져오면 다시 저장소를 따른다.
  sessionOnly.saveFails = false;
  await sessionOnly.library.importFile(wavFile('now-saved.wav'), 48000);
  sessionOnly.stored = record('after.wav', 100);
  assert.equal(await sessionOnly.library.refresh(), true);
  assert.equal(sessionOnly.library.info().name, 'after.wav');

  // 저장소를 읽지 못하면 지금 값을 그대로 둔다.
  const unreadable = createWorld();
  await unreadable.library.importFile(wavFile('keep.wav'), 48000);
  unreadable.loadFails = true;
  assert.equal(await unreadable.library.refresh(), false);
  assert.equal(unreadable.library.info().name, 'keep.wav');

  // 읽는 사이에 이 탭이 새 IR 을 가져오면, 읽어 온 옛 기록이 새 IR 을 덮지 못한다.
  const racing = createWorld({ stored: record('old-in-store.wav', 1) });
  await racing.library.load();
  let release;
  const originalLoad = racing.library.store.load;
  racing.library.store.load = async () => {
    const value = await originalLoad.call(racing.library.store);
    await new Promise((resolve) => { release = resolve; });
    return value;
  };
  const pending = racing.library.refresh();
  await new Promise((resolve) => setTimeout(resolve, 10));
  racing.library.store.load = originalLoad;
  await racing.library.importFile(wavFile('typed-now.wav'), 48000);
  release();
  assert.equal(await pending, false, '읽는 사이에 가져온 IR 이 있으면 읽어 온 기록은 버린다');
  assert.equal(racing.library.info().name, 'typed-now.wav');

  // 읽는 사이에 이 탭이 지웠어도 마찬가지다.
  const removing = createWorld({ stored: record('to-remove.wav', 1) });
  await removing.library.load();
  let releaseRemove;
  const slowLoad = removing.library.store.load;
  removing.library.store.load = async () => {
    const value = await slowLoad.call(removing.library.store);
    await new Promise((resolve) => { releaseRemove = resolve; });
    return value;
  };
  const pendingRemove = removing.library.refresh();
  await new Promise((resolve) => setTimeout(resolve, 10));
  removing.library.store.load = slowLoad;
  await removing.library.remove();
  releaseRemove();
  assert.equal(await pendingRemove, false);
  assert.equal(removing.library.info(), null, '지운 IR 이 되살아나지 않는다');
}

// ── 가져오는 도중에 지우면 되살아나지 않는다 ──
{
  const world = createWorld();
  const { library } = world;
  let release = null;
  const originalDecode = library.audio.decode;
  library.audio.decode = async (bytes, rate) => {
    if (!release) await new Promise((resolve) => { release = resolve; });
    return originalDecode(bytes, rate);
  };
  const importing = library.importFile(wavFile('late.wav'), 48000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(release, '가져오기가 디코딩에서 멈춰 있다');
  await library.remove();
  release();
  await assert.rejects(importing, (error) => error.message === ko.cabinetIr.cancelled, '지운 뒤에 끝난 가져오기는 취소된다');
  assert.equal(library.info(), null, '지운 IR 이 되살아나지 않는다');
  assert.equal(world.saves.length, 0, '취소된 가져오기는 저장하지 않는다');
  assert.equal(world.stored, null);
}

// ── 저장 결과가 뒤늦게 돌아와도 더 새로운 가져오기의 저장 상태를 덮지 않는다 ──
{
  const record = (name, savedAt) => ({ name, sampleRate: 48000, cut: false, originalSeconds: 0.1, channels: [impulse(4800)], savedAt });
  const world = createWorld();
  const { library } = world;
  let saveCalls = 0, releaseFirst;
  const firstSave = new Promise((resolve) => { releaseFirst = resolve; });
  const originalSave = library.store.save;
  library.store.save = async (value) => {
    saveCalls += 1;
    if (saveCalls === 1) { await firstSave; throw new Error('쓰기 실패'); } // 첫 저장은 오래 걸리다 실패한다
    return originalSave.call(library.store, value);
  };
  const first = library.importFile(wavFile('a.wav'), 48000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(saveCalls, 1, '첫 가져오기가 저장에서 멈춰 있다');
  const second = await library.importFile(wavFile('b.wav'), 48000);
  assert.equal(second.persisted, true, '두 번째 가져오기는 저장에 성공했다');
  releaseFirst();
  const late = await first;
  assert.equal(late.persisted, false, '첫 가져오기 자신의 결과는 저장 실패');
  assert.equal(library.info().name, 'b.wav', '화면에 남는 것은 나중에 가져온 IR');
  // 이 탭의 IR(b)은 저장소에 있으므로, 다른 탭이 바꾼 저장소를 따라가야 한다. 첫 저장의 늦은 실패가 이 상태를 지우면 안 된다.
  world.stored = record('other-tab.wav', 99);
  assert.equal(await library.refresh(), true, '뒤늦은 저장 실패가 더 새로운 IR 의 저장 상태를 덮지 않는다');
  assert.equal(library.info().name, 'other-tab.wav');
}

// ── 지우기는 저장소가 실패해도 이번 접속에서 쓰지 않게 한다 ──
{
  const world = createWorld();
  await world.library.importFile(wavFile('z.wav'), 48000);
  world.library.store.clear = async () => { throw new Error('지우기 실패'); };
  await world.library.remove();
  assert.equal(world.library.info(), null);
}

console.log('Cabinet IR library passed');
