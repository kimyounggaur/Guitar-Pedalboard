// S5.4 캐비닛 IR 불러오기(설계서 5.5 S5.4, RX-4, D7). 실제 브라우저에서 WAV 를 올려 본다.
//   ① 올리자마자 적용 ★(수용 기준): 모델이 '내 IR' 로 바뀌고, 컨볼버에 그 IR 이 실제로 들어간다. 저장 안내와 사용 조건(라이선스) 문구가 보인다
//   ② 새로고침 뒤에도 유지 ★: 이름·모델이 남고, 오디오를 시작하면 같은 IR 이 컨볼버에 다시 들어간다
//   ③ 1.5 초 IR 은 1 초로 잘리고 안내가 뜬다 ★: 저장소의 시료도 1 초이고 끝은 0 으로 내려가 있다. 1 초 이하는 안내가 없다
//   ④ 잘못된 파일은 이유를 알려 주고, 쓰던 IR 은 그대로다(지우지도, 모델을 바꾸지도 않는다)
//   ⑤ 지우기: 저장소에서 사라지고 모델은 기본 캐비닛으로 돌아가며 새로고침해도 그대로다
//   ⑥ '내 IR' 모델인데 저장된 IR 이 없으면(프리셋을 다른 기기에서 가져온 경우) 기본 캐비닛으로 대신 울린다고 알린다
//   ⑦ 이 브라우저가 IR 저장을 막으면 이번 접속에서만 쓸 수 있다고 알린다(올리는 것 자체는 된다)
//   ⑧ 한글 파일 이름·아주 긴 이름도 화면을 밀지 않는다(휴대폰 폭)
//   ⑨ 두 탭: 다른 탭이 올린 IR 을 모르는 탭이 '내 IR' 을 골라도 저장돼 있는 IR 을 없다고 하지 않는다(저장소를 다시 읽는다)
//   ⑩ 오디오 샘플레이트가 저장된 IR 과 다르면(연결 전에 48 kHz 로 저장 → 44.1 kHz 로 시작) 실제 Chrome 리샘플로 맞춰 컨볼버에 넣는다
//   ⑪ 24비트 스테레오·32비트 float WAV 도 받는다(실제 IR 팩의 흔한 형식)
// 켬/끔 음량 차 ≤ 1.5 dB(수용 기준)는 소리를 다루는 P-04 프로브가, 검사·자르기·정규화·리샘플의 모든 경우는 Node 시험(test:cabinet-ir·test:cabinet-ir-library)이 본다.
// 실제 상용 IR 팩의 소리·Safari/Firefox 의 IndexedDB 는 사람이 본다(보고서 '사람 확인 필요').
import { Buffer } from 'node:buffer';
import type { Locator, Page } from '@playwright/test';
import { connectGuitar, horizontalOverflow, openApp } from '../helpers/app';
import { BASE_URL } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { presetMessage, saveUserPreset } from '../helpers/preset-io';
import { idOfPedal, pedalGroup, readStoredBoard, storedParam } from '../helpers/storage';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

// 앱의 저장소 이름(src/audio/utils/cabinetIrStore.ts). 앱 코드를 import 하지 않는 e2e 규칙에 따라 같은 값을 적어 둔다.
// 바뀌면 아래 readStoredIr 이 저장된 IR 을 못 찾아 이 시험이 먼저 실패한다.
const DB_NAME = 'guitar-pedalboard-cabinet-ir';
const STORE_NAME = 'impulses';
const RECORD_KEY = 'user-ir';

const MSG = {
  tooBig: 'IR 파일은 4 MB 이하의 WAV 파일이어야 합니다.',
  tooLong: 'IR 파일은 10초 이하여야 합니다. (1초가 넘는 IR 은 앞 1초만 사용합니다.)',
  silent: '무음 IR은 사용할 수 없습니다.',
  stored: '이 브라우저에 저장되어 새로고침해도 유지됩니다.',
  notPersisted: '이 브라우저에 저장하지 못해 이번 접속에서만 쓸 수 있습니다.',
  missing: '저장된 내 IR 이 없어 기본 캐비닛(Modern 4×12)으로 재생 중입니다. WAV 파일을 불러와 주세요.',
  license: '직접 녹음했거나 사용이 허용된 IR 만 쓰세요.',
  limits: '불러온 파일은 이 브라우저 안에만 저장되며 서버로 보내지 않습니다.',
} as const;

interface WavOptions {
  seconds: number;
  sampleRate?: number;
  channels?: 1 | 2;
  /** 시료 형식. 기본 16비트 PCM. */
  format?: 'pcm16' | 'pcm24' | 'float32';
  /** 'silent' 는 모든 시료가 0 이다. */
  kind?: 'decay' | 'silent';
}

/** 16비트 PCM WAV. 'decay' 는 맨 앞에 큰 값이 있고 잡음이 지수로 줄어드는 IR 모양이다(결정적). */
function wavBytes({ seconds, sampleRate = 48000, channels = 1, kind = 'decay', format = 'pcm16' }: WavOptions): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const bytesPerSample = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4;
  const dataBytes = frames * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format === 'float32' ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  if (kind === 'decay') {
    let state = 12345;
    for (let frame = 0; frame < frames; frame += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const noise = state / 0x80000000 - 1;
      const value = (frame === 0 ? 0.6 : 0.2 * noise) * Math.exp(-frame / (0.02 * sampleRate));
      const clamped = Math.max(-1, Math.min(1, value));
      for (let channel = 0; channel < channels; channel += 1) {
        const offset = 44 + (frame * channels + channel) * bytesPerSample;
        if (format === 'pcm16') view.setInt16(offset, Math.round(clamped * 32767), true);
        else if (format === 'float32') view.setFloat32(offset, clamped, true);
        else {
          const integer = Math.round(clamped * 8388607);
          view.setUint8(offset, integer & 255);
          view.setUint8(offset + 1, (integer >> 8) & 255);
          view.setUint8(offset + 2, (integer >> 16) & 255);
        }
      }
    }
  }
  return Buffer.from(bytes);
}

const wavFile = (name: string, options: WavOptions): { name: string; mimeType: string; buffer: Buffer } => ({
  name,
  mimeType: 'audio/wav',
  buffer: wavBytes(options),
});

const cabOf = (page: Page): Locator => pedalGroup(page, 'Cab');
const modelSelect = (page: Page): Locator => cabOf(page).getByLabel('캐비닛 모델');
const irInput = (page: Page): Locator => cabOf(page).locator('input[type="file"]');
const irAlert = (page: Page): Locator => cabOf(page).getByRole('alert');
const deleteButton = (page: Page): Locator => cabOf(page).getByRole('button', { name: '저장된 내 IR 지우기' });
const inUse = (page: Page, name: string): Locator => cabOf(page).getByText(`내 IR: ${name}`, { exact: true });

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await irInput(page).setInputFiles(file);
}

interface StoredIrSummary {
  name: string;
  sampleRate: number;
  cut: boolean;
  originalSeconds: number;
  channelCount: number;
  frames: number;
  first: number;
  last: number;
}

/** IndexedDB 에 저장된 IR 의 요약. 없으면 null. DB 가 없을 때 열면 빈 DB 가 생겨 앱의 저장을 막으므로, 있는지 먼저 본다. */
async function readStoredIr(page: Page): Promise<StoredIrSummary | null> {
  return page.evaluate(
    async ({ dbName, storeName, key }) => {
      const known = await indexedDB.databases();
      if (!known.some((database) => database.name === dbName)) return null;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!database.objectStoreNames.contains(storeName)) return null;
        const record = await new Promise<{
          name: string; sampleRate: number; cut: boolean; originalSeconds: number; channels: Float32Array[];
        } | undefined>((resolve, reject) => {
          const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (!record) return null;
        const channel = record.channels[0];
        return {
          name: record.name,
          sampleRate: record.sampleRate,
          cut: record.cut,
          originalSeconds: record.originalSeconds,
          channelCount: record.channels.length,
          frames: channel.length,
          first: channel[0],
          last: channel[channel.length - 1],
        };
      } finally {
        database.close();
      }
    },
    { dbName: DB_NAME, storeName: STORE_NAME, key: RECORD_KEY },
  );
}

interface AssignedBuffer {
  length: number;
  sampleRate: number;
  channels: number;
}

/**
 * 컨볼버에 buffer 가 들어갈 때마다 기록한다(소리는 바뀌지 않는다). page.goto 전에 부른다.
 * `contextRate` 를 주면 앱이 만드는 AudioContext 의 샘플레이트를 그 값으로 정한다(기기마다 44.1·48 kHz 가 다른 상황을 만든다).
 */
async function trackConvolverBuffers(page: Page, contextRate?: number): Promise<void> {
  await page.addInitScript((forcedRate) => {
    if (forcedRate) {
      const NativeContext = window.AudioContext;
      (window as unknown as { AudioContext: unknown }).AudioContext = class extends NativeContext {
        constructor(options?: AudioContextOptions) {
          super({ ...(options ?? {}), sampleRate: forcedRate });
        }
      };
    }
    const assigned: Array<{ length: number; sampleRate: number; channels: number }> = [];
    const native = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
    if (!native || !native.get || !native.set) return;
    const getter = native.get;
    const setter = native.set;
    Object.defineProperty(ConvolverNode.prototype, 'buffer', {
      configurable: true,
      get(this: ConvolverNode) {
        return getter.call(this) as AudioBuffer | null;
      },
      set(this: ConvolverNode, value: AudioBuffer | null) {
        if (value) assigned.push({ length: value.length, sampleRate: value.sampleRate, channels: value.numberOfChannels });
        setter.call(this, value);
      },
    });
    Object.defineProperty(window, '__convolverBuffers', { configurable: true, value: assigned });
  }, contextRate ?? 0);
}

const assignedBuffers = (page: Page): Promise<AssignedBuffer[]> =>
  page.evaluate(() => (window as unknown as { __convolverBuffers: AssignedBuffer[] }).__convolverBuffers.slice());

/**
 * 사용자 IR 이 컨볼버에 들어갔는지. 만든 캐비닛의 IR 은 2채널이고 사용자 모노 IR 은 1채널이라 채널 수와 길이로 가려낸다.
 * 길이는 컨텍스트 샘플레이트로 맞춘 뒤의 프레임 수(초 × 샘플레이트, 리샘플 반올림 ±2).
 */
async function expectMonoIrApplied(page: Page, seconds: number): Promise<void> {
  await expect
    .poll(async () => (await assignedBuffers(page)).some((buffer) => buffer.channels === 1 && Math.abs(buffer.length - Math.round(seconds * buffer.sampleRate)) <= 2), {
      message: `컨볼버에 ${seconds}초 모노 IR 이 들어가야 한다`,
      timeout: 10_000,
    })
    .toBe(true);
}

test.describe('S5.4 캐비닛 IR 불러오기', () => {
  test('① 올리자마자 적용: 모델이 내 IR 로 바뀌고 컨볼버에 들어가며, 저장 안내와 사용 조건 문구가 보인다', async ({ page }) => {
    await trackConvolverBuffers(page);
    await openApp(page);
    await connectGuitar(page);
    expect(await readStoredIr(page), '처음에는 저장된 IR 이 없다').toBeNull();
    await expect(deleteButton(page)).toHaveCount(0);

    await upload(page, wavFile('my-cab.wav', { seconds: 0.137 }));
    await expect(inUse(page, 'my-cab.wav')).toBeVisible({ timeout: 15_000 });
    await expect(modelSelect(page), '올리자마자 모델이 내 IR 이다').toHaveValue('my-ir');
    await expect(irAlert(page)).toHaveCount(0);
    await expect(cabOf(page).getByText(MSG.stored)).toBeVisible();
    await expect(cabOf(page).getByText(MSG.license, { exact: false })).toBeVisible();
    await expect(cabOf(page).getByText(MSG.limits, { exact: false })).toBeVisible();
    await expect(cabOf(page).getByText('원본은', { exact: false }), '1초 이하는 잘림 안내가 없다').toHaveCount(0);

    await expectMonoIrApplied(page, 0.137);
    await expect.poll(async () => storedParam(await readStoredBoard(page), idOfPedal('Cab'), 'model'), { message: '모델도 저장된다' }).toBe('my-ir');
    const record = await readStoredIr(page);
    expect(record).toMatchObject({ name: 'my-cab.wav', cut: false, channelCount: 1 });
    expect(Math.abs((record?.frames ?? 0) - Math.round(0.137 * (record?.sampleRate ?? 0)))).toBeLessThanOrEqual(2);
  });

  test('② 새로고침 뒤에도 유지된다: 이름·모델이 남고, 오디오를 시작하면 같은 IR 이 컨볼버에 다시 들어간다', async ({ page }) => {
    await trackConvolverBuffers(page);
    await openApp(page);
    await connectGuitar(page);
    await upload(page, wavFile('keep-me.wav', { seconds: 0.137 }));
    await expect(inUse(page, 'keep-me.wav')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await readStoredIr(page))?.name).toBe('keep-me.wav');

    await openApp(page); // 새로고침(같은 주소를 다시 연다)
    await expect(inUse(page, 'keep-me.wav'), '오디오를 시작하기 전에도 이름이 보인다').toBeVisible({ timeout: 15_000 });
    await expect(modelSelect(page)).toHaveValue('my-ir');
    await expect(cabOf(page).getByText(MSG.stored)).toBeVisible();
    await expect(cabOf(page).getByText('저장된 내 IR 이 없어')).toHaveCount(0);

    await connectGuitar(page);
    await expectMonoIrApplied(page, 0.137);
  });

  test('③ 1.5 초 IR 은 1 초로 잘리고 안내가 뜬다: 저장된 시료도 1 초이고 끝은 0 으로 내려가 있다', async ({ page }) => {
    await trackConvolverBuffers(page);
    await openApp(page);
    await connectGuitar(page);

    await upload(page, wavFile('long-room.wav', { seconds: 1.5 }));
    await expect(inUse(page, 'long-room.wav')).toBeVisible({ timeout: 15_000 });
    await expect(cabOf(page).getByText('원본은 1.50초여서 앞 1초만 사용합니다.')).toBeVisible();
    await expectMonoIrApplied(page, 1);

    const record = await readStoredIr(page);
    expect(record?.cut).toBe(true);
    expect(record?.originalSeconds).toBeCloseTo(1.5, 2);
    expect(record?.frames, '저장된 시료는 정확히 1 초').toBe(record?.sampleRate);
    expect(Math.abs(record?.last ?? 1), '자른 끝은 0 으로 내려간다(딸깍 소리 방지)').toBeLessThan(1e-4);
    expect(Math.abs(record?.first ?? 0), '앞쪽은 그대로다').toBeGreaterThan(0.05);

    // 같은 앱에서 짧은 IR 로 바꾸면 잘림 안내가 사라진다.
    await upload(page, wavFile('short.wav', { seconds: 0.9 }));
    await expect(inUse(page, 'short.wav')).toBeVisible({ timeout: 15_000 });
    await expect(cabOf(page).getByText('원본은', { exact: false })).toHaveCount(0);
    expect((await readStoredIr(page))?.cut).toBe(false);
  });

  test('④ 잘못된 파일은 이유를 알려 주고 쓰던 IR 은 그대로다', async ({ page }) => {
    await openApp(page);
    await connectGuitar(page);
    await upload(page, wavFile('good.wav', { seconds: 0.2 }));
    await expect(inUse(page, 'good.wav')).toBeVisible({ timeout: 15_000 });

    const failures: Array<[string, { name: string; mimeType: string; buffer: Buffer }, string | RegExp]> = [
      ['4 MB 초과', { name: 'big.wav', mimeType: 'audio/wav', buffer: Buffer.from(new Uint8Array(4 * 1024 * 1024 + 1)) }, MSG.tooBig],
      ['WAV 가 아닌 확장자', { name: 'cab.mp3', mimeType: 'audio/mpeg', buffer: wavBytes({ seconds: 0.1 }) }, MSG.tooBig],
      ['10 초 초과', wavFile('too-long.wav', { seconds: 11, sampleRate: 8000 }), MSG.tooLong],
      ['무음', wavFile('silent.wav', { seconds: 0.1, kind: 'silent' }), MSG.silent],
      ['깨진 WAV', { name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from(new Uint8Array(100)) }, /WAV/],
    ];
    for (const [label, file, expected] of failures) {
      await upload(page, file);
      await expect(irAlert(page), label).toBeVisible();
      await expect(irAlert(page), label).toContainText(expected);
      await expect(inUse(page, 'good.wav'), `${label}: 쓰던 IR 은 그대로`).toBeVisible();
      await expect(modelSelect(page), `${label}: 모델도 그대로`).toHaveValue('my-ir');
      expect((await readStoredIr(page))?.name, `${label}: 저장된 IR 도 그대로`).toBe('good.wav');
    }

    await upload(page, wavFile('better.wav', { seconds: 0.2 }));
    await expect(inUse(page, 'better.wav')).toBeVisible({ timeout: 15_000 });
    await expect(irAlert(page), '성공하면 오류 문구가 사라진다').toHaveCount(0);
  });

  test('⑤ 지우기: 저장소에서 사라지고 모델은 기본 캐비닛으로 돌아가며 새로고침해도 그대로다', async ({ page }) => {
    await openApp(page);
    await connectGuitar(page);
    await upload(page, wavFile('gone.wav', { seconds: 0.2 }));
    await expect(inUse(page, 'gone.wav')).toBeVisible({ timeout: 15_000 });
    await expect(modelSelect(page)).toHaveValue('my-ir');

    await deleteButton(page).click();
    await expect(inUse(page, 'gone.wav')).toHaveCount(0);
    await expect(deleteButton(page)).toHaveCount(0);
    await expect(modelSelect(page), '모델이 내 IR 로 남아 화면과 소리가 어긋나지 않는다').toHaveValue('v30-4x12');
    await expect(cabOf(page).getByText(MSG.missing), '지운 직후에 없다는 안내가 뜨지 않는다').toHaveCount(0);
    await expect.poll(() => readStoredIr(page)).toBeNull();

    await openApp(page);
    await expect(inUse(page, 'gone.wav')).toHaveCount(0);
    await expect(modelSelect(page)).toHaveValue('v30-4x12');
    expect(await readStoredIr(page)).toBeNull();
  });

  test('⑥ 내 IR 모델인데 저장된 IR 이 없으면 기본 캐비닛으로 대신 울린다고 알리고, IR 을 올리면 안내가 사라진다', async ({ page }) => {
    await openApp(page);
    await connectGuitar(page);
    await expect(cabOf(page).getByText(MSG.missing)).toHaveCount(0);

    await modelSelect(page).selectOption('my-ir');
    await expect(cabOf(page).getByText(MSG.missing)).toBeVisible();
    await expect(cabOf(page).getByText('내 IR:', { exact: false })).toHaveCount(0);

    await modelSelect(page).selectOption('greenback-4x12');
    await expect(cabOf(page).getByText(MSG.missing), '다른 모델로 바꾸면 안내가 사라진다').toHaveCount(0);

    await modelSelect(page).selectOption('my-ir');
    await upload(page, wavFile('arrived.wav', { seconds: 0.2 }));
    await expect(inUse(page, 'arrived.wav')).toBeVisible({ timeout: 15_000 });
    await expect(cabOf(page).getByText(MSG.missing)).toHaveCount(0);
  });

  test('⑥-2 프리셋이 내 IR 모델을 가리키는데 IR 이 지워졌으면 불러올 때 같은 안내가 뜬다(저장된 프리셋은 IR 을 담지 않는다)', async ({ page }) => {
    await openApp(page);
    await connectGuitar(page);
    await upload(page, wavFile('preset-ir.wav', { seconds: 0.2 }));
    await expect(inUse(page, 'preset-ir.wav')).toBeVisible({ timeout: 15_000 });
    await saveUserPreset(page, 'With My IR');

    await deleteButton(page).click();
    await expect(modelSelect(page)).toHaveValue('v30-4x12');

    await page.locator('.preset-list .preset-load-button').filter({ hasText: 'With My IR' }).click();
    await expect(modelSelect(page), '프리셋의 모델이 그대로 적용된다').toHaveValue('my-ir');
    await expect(cabOf(page).getByText(MSG.missing)).toBeVisible();
    await expect(presetMessage(page)).not.toHaveText('');
  });

  test('⑦ 이 브라우저가 IR 저장을 막으면 이번 접속에서만 쓸 수 있다고 알리고, 올리는 것은 된다', async ({ page }) => {
    await page.addInitScript(() => {
      // 저장소를 여는 모든 시도를 보안 오류로 만든다(일부 개인정보 보호 모드·정책이 이렇게 동작한다).
      IDBFactory.prototype.open = function open(): IDBOpenDBRequest {
        const request = { error: null as unknown, onerror: null as null | ((event: Event) => void), onsuccess: null } as unknown as IDBOpenDBRequest;
        setTimeout(() => {
          Object.defineProperty(request, 'error', { configurable: true, value: new DOMException('blocked', 'SecurityError') });
          request.onerror?.(new Event('error'));
        }, 0);
        return request;
      };
    });
    await trackConvolverBuffers(page);
    await openApp(page);
    await connectGuitar(page);

    await upload(page, wavFile('session-only.wav', { seconds: 0.137 }));
    await expect(inUse(page, 'session-only.wav')).toBeVisible({ timeout: 15_000 });
    await expect(cabOf(page).getByText(MSG.notPersisted)).toBeVisible();
    await expect(cabOf(page).getByText(MSG.stored)).toHaveCount(0);
    await expect(modelSelect(page)).toHaveValue('my-ir');
    await expect(irAlert(page), '저장 실패는 오류가 아니라 안내다').toHaveCount(0);
    await expectMonoIrApplied(page, 0.137);
  });

  test('⑧ 한글 파일 이름과 아주 긴 이름도 화면을 밀지 않는다(휴대폰 폭)', async ({ browser }) => {
    const context = await browser.newContext({ ...PHONE, baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      await openApp(page);
      const before = await horizontalOverflow(page);
      const longName = `내 캐비닛 IR ${'아주긴이름'.repeat(12)} 최종본 v2.wav`;
      await upload(page, wavFile(longName, { seconds: 1.5 }));
      await expect(inUse(page, longName)).toBeVisible({ timeout: 15_000 });
      await expect(cabOf(page).getByText('원본은 1.50초여서 앞 1초만 사용합니다.')).toBeVisible();
      expect(await horizontalOverflow(page), '긴 이름과 안내 문구가 가로 스크롤을 만들지 않는다').toBeLessThanOrEqual(before);
      expect((await readStoredIr(page))?.name, '한글 이름이 그대로 저장된다').toBe(longName);
    } finally {
      await context.close();
    }
  });

  test('⑨ 두 탭: 다른 탭이 올린 IR 을 모르는 탭이 내 IR 모델을 골라도 저장된 IR 을 없다고 하지 않는다', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    try {
      const first = await context.newPage();
      const second = await context.newPage();
      await openApp(first);
      await openApp(second); // 이 탭은 IR 이 없던 때 저장소를 읽었다
      await upload(first, wavFile('from-first-tab.wav', { seconds: 0.2 }));
      await expect(inUse(first, 'from-first-tab.wav')).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () => (await readStoredIr(first))?.name).toBe('from-first-tab.wav');

      await second.bringToFront();
      await expect(inUse(second, 'from-first-tab.wav'), '아직 고르기 전에는 이 탭의 화면이 그대로다').toHaveCount(0);
      await modelSelect(second).selectOption('my-ir');
      await expect(inUse(second, 'from-first-tab.wav'), '내 IR 을 고르면 저장소를 다시 읽어 IR 을 찾는다').toBeVisible({ timeout: 10_000 });
      await expect(cabOf(second).getByText(MSG.missing), '저장돼 있는 IR 을 없다고 안내하지 않는다').toHaveCount(0);

      // 첫 탭이 지우면, 그 뒤에 내 IR 을 고르는 탭은 정말 없다는 안내를 받는다.
      await first.bringToFront();
      await deleteButton(first).click();
      await expect.poll(() => readStoredIr(first)).toBeNull();
      await second.bringToFront();
      await modelSelect(second).selectOption('greenback-4x12');
      await modelSelect(second).selectOption('my-ir');
      await expect(cabOf(second).getByText(MSG.missing)).toBeVisible({ timeout: 10_000 });
      await expect(inUse(second, 'from-first-tab.wav')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('⑩ 오디오 샘플레이트가 저장된 IR 과 다르면 실제 Chrome 리샘플로 맞춰 컨볼버에 넣는다', async ({ page }) => {
    await trackConvolverBuffers(page, 44100);
    await openApp(page);
    // 연결 전에는 컨텍스트가 없어 48 kHz 로 읽어 저장한다. 44.1 kHz 컨텍스트가 뜨면 저장된 시료를 맞춰야 한다.
    await upload(page, wavFile('pre-connect.wav', { seconds: 0.137, sampleRate: 48000 }));
    await expect(inUse(page, 'pre-connect.wav')).toBeVisible({ timeout: 15_000 });
    expect((await readStoredIr(page))?.sampleRate, '연결 전에는 기본 48 kHz 로 저장된다').toBe(48000);

    await connectGuitar(page);
    await expect
      .poll(async () => (await assignedBuffers(page)).some((buffer) => buffer.channels === 1 && buffer.sampleRate === 44100 && Math.abs(buffer.length - Math.round(0.137 * 44100)) <= 2), {
        message: '44.1 kHz 컨텍스트에는 44.1 kHz 로 맞춘 IR 이 들어가야 한다',
        timeout: 10_000,
      })
      .toBe(true);
    expect((await readStoredIr(page))?.sampleRate, '저장된 원본은 그대로다(기기가 바뀌어도 다시 맞출 수 있도록)').toBe(48000);
    await expect(irAlert(page)).toHaveCount(0);
  });

  test('⑪ 24비트 스테레오·32비트 float WAV 도 받는다', async ({ page }) => {
    await trackConvolverBuffers(page);
    await openApp(page);
    await connectGuitar(page);

    await upload(page, wavFile('stereo-24bit.wav', { seconds: 0.2, sampleRate: 44100, channels: 2, format: 'pcm24' }));
    await expect(inUse(page, 'stereo-24bit.wav')).toBeVisible({ timeout: 15_000 });
    await expect(irAlert(page)).toHaveCount(0);
    expect(await readStoredIr(page)).toMatchObject({ name: 'stereo-24bit.wav', channelCount: 2 });

    await upload(page, wavFile('mono-float.wav', { seconds: 0.2, sampleRate: 44100, format: 'float32' }));
    await expect(inUse(page, 'mono-float.wav')).toBeVisible({ timeout: 15_000 });
    await expect(irAlert(page)).toHaveCount(0);
    expect(await readStoredIr(page)).toMatchObject({ name: 'mono-float.wav', channelCount: 1 });
    await expectMonoIrApplied(page, 0.2);
  });
});
