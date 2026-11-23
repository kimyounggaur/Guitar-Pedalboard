// 기준 신호(설계서 부록 A)를 WAV 파일로 저장한다. 브라우저 시나리오(S0.4)에서 가짜 마이크로 쓴다.
//
//   node scripts/make-fixture-wavs.mjs                 e2e/fixtures/*.wav 전부(48 kHz, 16비트 PCM)
//   node scripts/make-fixture-wavs.mjs --only h-1,ref-pc
//   node scripts/make-fixture-wavs.mjs --out /tmp/wav --sample-rate 44100
//   node scripts/make-fixture-wavs.mjs --list
//
// 같은 코드는 항상 같은 신호를 만들지만 Math.sin 의 마지막 자리가 환경마다 다를 수 있어
// WAV 는 저장소에 올리지 않고(.gitignore) 필요할 때 이 스크립트로 만든다.
// 16비트 WAV 의 양자화 바닥은 약 −98 dBFS 라서 −90 dBFS 잡음(P-01)은 WAV 로 만들지 않는다(프로브는 부동소수점으로 직접 쓴다).
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const sampleRate = Number(option('--sample-rate', '48000'));
const outputDirectory = join(projectRoot, option('--out', 'e2e/fixtures'));
const only = option('--only', '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
  console.error(`--sample-rate 는 8000~192000 사이 정수여야 합니다: ${sampleRate}`);
  process.exit(2);
}

const bundled = await build({
  entryPoints: [join(projectRoot, 'src/audio/testing/signals.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { fixtureSignals } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

if (args.includes('--list')) {
  for (const signal of fixtureSignals) console.log(`${signal.file.padEnd(22)} ${signal.id.padEnd(12)} ${signal.description}`);
  process.exit(0);
}

const selected = only.length ? fixtureSignals.filter((signal) => only.includes(signal.file)) : fixtureSignals;
const unknown = only.filter((name) => !fixtureSignals.some((signal) => signal.file === name));
if (unknown.length > 0) {
  console.error(`알 수 없는 신호: ${unknown.join(', ')} (--list 로 목록을 볼 수 있습니다)`);
  process.exit(2);
}

await mkdir(outputDirectory, { recursive: true });
for (const signal of selected) {
  const channels = signal.create(sampleRate);
  const wav = encodeWav16(channels, sampleRate);
  const target = join(outputDirectory, `${signal.file}.wav`);
  await writeFile(target, wav);
  const seconds = channels[0].length / sampleRate;
  console.log(
    `${signal.file}.wav  ${channels.length}ch  ${seconds.toFixed(2)}초  ${(wav.length / 1024).toFixed(0)} KB  ${signal.id}`,
  );
}
console.log(`\n${selected.length}개를 ${outputDirectory} 에 만들었습니다 (${sampleRate} Hz, 16비트 PCM).`);

/** 16비트 PCM WAV. channels 는 같은 길이의 Float32Array 배열이다. */
function encodeWav16(channels, rate) {
  const channelCount = channels.length;
  const frames = channels[0].length;
  const dataBytes = frames * channelCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * channelCount * 2, 28);
  buffer.writeUInt16LE(channelCount * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const clipped = Math.max(-1, Math.min(1, channels[channel][frame]));
      buffer.writeInt16LE(Math.round(clipped * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}
