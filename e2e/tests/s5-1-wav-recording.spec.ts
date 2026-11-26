// S5.1 WAV 녹음(설계서 5.5 S5.1, RX-1). 실제 Chromium 에서 가짜 마이크 소리를 녹음하고 받은 파일을 본다.
//   ① 처음 열면 녹음 형식은 WAV, 비트 깊이 16, 최대 길이 5분이다.
//   ② WAV 를 받으면 머리말이 맞고(RIFF 크기·자료 크기·초당 바이트) 머리말이 말하는 길이 = 브라우저가 읽은 재생 길이 = 녹음한 시간이다.
//      (설계서 수용 기준: 편집 프로그램·기본 플레이어에서 열면 길이가 정확히 보인다 — 길이를 머리말에서 읽는 프로그램이 틀리지 않는다)
//   ③ 24비트를 고르면 파일도 24비트(샘플 3바이트)이고 브라우저가 그대로 읽는다.
//   ④ 녹음 중에는 '남은 시간' 이 줄어들고 세 메뉴를 바꿀 수 없다. 최대 길이 1분을 고르면 60초에서 자동 저장되고 파일 길이가 60초다.
//   ⑤ 고른 형식·비트 깊이·최대 길이는 새로고침 뒤에도 남는다.
import { readFileSync } from 'node:fs';
import { chooseRecordingFormat, connectGuitar, openApp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import type { Download, Page } from '@playwright/test';

const panel = (page: Page) => page.locator('.recording-panel');
const menu = (page: Page, label: string) => panel(page).locator('label', { hasText: label }).locator('select');
const startButton = (page: Page) => page.getByRole('button', { name: '녹음', exact: true });
const stopButton = (page: Page) => page.getByRole('button', { name: '정지', exact: true });
const downloadButton = (page: Page) => page.getByRole('button', { name: '다운로드' });
const status = (page: Page) => panel(page).locator('.recording-status');

interface WavHeader {
  riff: string;
  wave: string;
  riffSize: number;
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataTag: string;
  dataSize: number;
  headerSeconds: number;
}

function readWavHeader(bytes: Uint8Array): WavHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, count: number) => String.fromCharCode(...bytes.subarray(start, start + count));
  const byteRate = view.getUint32(28, true);
  const dataSize = view.getUint32(40, true);
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    riffSize: view.getUint32(4, true),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate,
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataTag: ascii(36, 4),
    dataSize,
    headerSeconds: dataSize / byteRate,
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function downloadRecording(page: Page): Promise<{ download: Download; bytes: Uint8Array; base64: string }> {
  await expect(downloadButton(page)).toBeEnabled({ timeout: 10_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
  const bytes = new Uint8Array(readFileSync(await download.path()));
  return { download, bytes, base64: toBase64(bytes) };
}

/** 브라우저가 파일을 읽어 낸 재생 길이와 가장 큰 소리. 60초 파일은 11 MB 라 숫자 배열이 아니라 base64 로 넘긴다. */
async function decode(page: Page, base64: string): Promise<{ duration: number; peak: number; channels: number }> {
  return page.evaluate(async (data: string) => {
    const context = new OfflineAudioContext(2, 48_000, 48_000);
    const raw = atob(data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const buffer = await context.decodeAudioData(bytes.buffer);
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
    }
    return { duration: buffer.duration, peak, channels: buffer.numberOfChannels };
  }, base64);
}

function expectConsistentHeader(header: WavHeader, bytes: Uint8Array, bitsPerSample: 16 | 24): void {
  expect(header.riff).toBe('RIFF');
  expect(header.wave).toBe('WAVE');
  expect(header.dataTag).toBe('data');
  expect(header.audioFormat).toBe(1);
  expect(header.channels).toBe(2);
  expect(header.bitsPerSample).toBe(bitsPerSample);
  expect(header.blockAlign).toBe(2 * (bitsPerSample / 8));
  expect(header.byteRate).toBe(header.sampleRate * header.blockAlign);
  expect(header.riffSize, 'RIFF 크기 = 파일 크기 − 8').toBe(bytes.length - 8);
  expect(header.dataSize, '자료 크기 = 파일 크기 − 44').toBe(bytes.length - 44);
  expect(header.dataSize % header.blockAlign, '자료는 프레임 단위로 떨어진다').toBe(0);
}

async function openConnected(launchWithMic: (wav?: string) => Promise<{ page: Page }>): Promise<Page> {
  const { page } = await launchWithMic('ref-pc.wav');
  await openApp(page);
  await connectGuitar(page);
  return page;
}

test.describe('S5.1 WAV 녹음', () => {
  test('S5.1 처음 열면 WAV·16비트·최대 5분이다', async ({ launchWithMic }) => {
    const page = await openConnected(launchWithMic);
    await expect(menu(page, '녹음 형식')).toHaveValue('wav');
    await expect(menu(page, '비트 깊이')).toHaveValue('16');
    await expect(menu(page, '최대 길이')).toHaveValue('300');
    await expect(menu(page, '최대 길이').locator('option')).toHaveText(['1분', '2분', '5분']);
    await expect(status(page)).toHaveText('녹음 대기');
  });

  test('S5.1 WAV 16비트: 머리말·재생 길이·녹음한 시간이 모두 같다', async ({ launchWithMic }) => {
    const page = await openConnected(launchWithMic);
    await startButton(page).click();
    const startedAt = Date.now();
    await expect(status(page)).toContainText('녹음 중');
    await page.waitForTimeout(2500);
    await stopButton(page).click();
    const stoppedAt = Date.now();
    await expect(status(page)).toContainText('녹음 완료');
    await expect(status(page)).toContainText('WAV');

    const { download, bytes, base64 } = await downloadRecording(page);
    expect(download.suggestedFilename()).toMatch(/^pedalboard-\d{8}-\d{6}\.wav$/);
    const header = readWavHeader(bytes);
    expectConsistentHeader(header, bytes, 16);
    const decoded = await decode(page, base64);
    const recordedSeconds = (stoppedAt - startedAt) / 1000;
    test.info().annotations.push({
      type: 'recording',
      description: `머리말 ${header.headerSeconds.toFixed(3)} s, 재생 길이 ${decoded.duration.toFixed(3)} s, 녹음한 시간 ${recordedSeconds.toFixed(2)} s, 최대 진폭 ${decoded.peak.toFixed(3)}`,
    });
    expect(Math.abs(decoded.duration - header.headerSeconds), '재생 길이 = 머리말이 말하는 길이').toBeLessThanOrEqual(0.01);
    // 녹음은 입력이 흐르기 시작한 뒤부터 담으므로 클릭 간격보다 조금 짧을 수 있다(시작 지연). 길어질 수는 없다.
    expect(header.headerSeconds).toBeLessThanOrEqual(recordedSeconds + 0.2);
    expect(header.headerSeconds).toBeGreaterThan(recordedSeconds - 0.8);
    expect(decoded.channels).toBe(2);
    expect(decoded.peak, '무음 파일이 아니다').toBeGreaterThan(0.001);
  });

  test('S5.1 WAV 24비트: 샘플이 3바이트이고 브라우저가 그대로 읽는다', async ({ launchWithMic }) => {
    const page = await openConnected(launchWithMic);
    await menu(page, '비트 깊이').selectOption('24');
    await startButton(page).click();
    await expect(status(page)).toContainText('녹음 중');
    await page.waitForTimeout(2000);
    await stopButton(page).click();
    await expect(status(page)).toContainText('녹음 완료');

    const { bytes, base64 } = await downloadRecording(page);
    const header = readWavHeader(bytes);
    expectConsistentHeader(header, bytes, 24);
    const decoded = await decode(page, base64);
    test.info().annotations.push({ type: 'recording', description: `24비트 머리말 ${header.headerSeconds.toFixed(3)} s, 재생 길이 ${decoded.duration.toFixed(3)} s` });
    expect(Math.abs(decoded.duration - header.headerSeconds)).toBeLessThanOrEqual(0.01);
    expect(decoded.peak, '무음 파일이 아니다').toBeGreaterThan(0.001);
    expect(decoded.peak, '24비트 값이 한계를 넘지 않는다').toBeLessThanOrEqual(1);
  });

  test('S5.1 녹음 중에는 남은 시간이 줄고 메뉴를 바꿀 수 없으며, 압축 녹음에는 남은 시간이 없다', async ({ launchWithMic }) => {
    const page = await openConnected(launchWithMic);
    await menu(page, '최대 길이').selectOption('60');
    await startButton(page).click();
    await expect(status(page)).toContainText(/남은 시간 (01:00|00:59)/);
    await expect(status(page)).toContainText(/남은 시간 00:5[5-8]/, { timeout: 6000 });
    for (const label of ['녹음 형식', '비트 깊이', '최대 길이']) await expect(menu(page, label)).toBeDisabled();
    await stopButton(page).click();
    await expect(status(page)).toContainText('녹음 완료');
    for (const label of ['녹음 형식', '비트 깊이', '최대 길이']) await expect(menu(page, label)).toBeEnabled();

    await chooseRecordingFormat(page, 'webm');
    await expect(menu(page, '비트 깊이')).toHaveCount(0);
    await expect(menu(page, '최대 길이')).toHaveCount(0);
    await startButton(page).click();
    await expect(status(page)).toContainText(/녹음 중 00:0[0-9]$/);
    await expect(status(page)).not.toContainText('남은 시간');
    await stopButton(page).click();
    await expect(status(page)).toContainText('녹음 완료');
  });

  test('S5.1 최대 길이 1분: 60초에서 자동 저장되고 파일 길이가 60초다', async ({ launchWithMic }) => {
    test.setTimeout(120_000);
    const page = await openConnected(launchWithMic);
    await menu(page, '최대 길이').selectOption('60');
    await startButton(page).click();
    await expect(status(page)).toContainText('녹음 중');
    // 정지를 누르지 않아도 한도에서 스스로 저장된다.
    await expect(status(page)).toContainText('녹음 완료', { timeout: 75_000 });
    await expect(startButton(page)).toBeEnabled();

    const { bytes, base64 } = await downloadRecording(page);
    const header = readWavHeader(bytes);
    expectConsistentHeader(header, bytes, 16);
    test.info().annotations.push({ type: 'recording', description: `한도 자동 저장: 머리말 ${header.headerSeconds.toFixed(3)} s` });
    // 한도는 프레임 수(샘플레이트 × 60)로 잰다. 마지막 처리 블록이 한도를 넘는 만큼은 잘라 낸다.
    expect(Math.abs(header.headerSeconds - 60), '60초에서 멈춘다').toBeLessThanOrEqual(0.1);
    expect(Math.abs((await decode(page, base64)).duration - header.headerSeconds)).toBeLessThanOrEqual(0.01);
  });

  test('S5.1 고른 형식·비트 깊이·최대 길이는 새로고침 뒤에도 남는다', async ({ launchWithMic }) => {
    const page = await openConnected(launchWithMic);
    await menu(page, '비트 깊이').selectOption('24');
    await menu(page, '최대 길이').selectOption('120');
    await page.reload();
    await connectGuitar(page);
    await expect(menu(page, '녹음 형식')).toHaveValue('wav');
    await expect(menu(page, '비트 깊이')).toHaveValue('24');
    await expect(menu(page, '최대 길이')).toHaveValue('120');

    await chooseRecordingFormat(page, 'webm');
    await page.reload();
    await connectGuitar(page);
    await expect(menu(page, '녹음 형식')).toHaveValue('webm');
    // 숨겨진 동안에도 값은 남아 있다: WAV 로 돌아가면 그대로다.
    await chooseRecordingFormat(page, 'wav');
    await expect(menu(page, '비트 깊이')).toHaveValue('24');
    await expect(menu(page, '최대 길이')).toHaveValue('120');
  });
});
