import { ko } from '../../i18n/ko';

export const MAX_CAB_IR_BYTES = 4 * 1024 * 1024;
/** 컨볼버에 쓰는 IR 길이(초). 더 긴 파일은 앞 이만큼만 쓰고 나머지는 잘라낸다(설계서 S5.4). */
export const MAX_CAB_IR_SECONDS = 1;
/**
 * 받아들이는 파일의 길이 상한(초). 이보다 긴 것은 IR 이 아니라 녹음이므로 받지 않는다.
 * 4 MB 로는 8 kHz·8비트 모노가 8분 넘게 들어가고, 그것을 디코딩하면 순간 메모리가 100 MB 를 넘으므로 길이도 따로 막는다.
 */
export const MAX_CAB_IR_FILE_SECONDS = 10;
/** 자른 끝을 부드럽게 내리는 시간(초). 잘린 면이 딸깍 소리를 내지 않게 한다. */
export const CAB_IR_CUT_FADE_SECONDS = 0.01;
/** 디코딩 때 샘플 수가 한두 개 어긋나는 것을 '잘렸다'고 알리지 않으려는 여유(초). */
const CUT_TOLERANCE_SECONDS = 0.001;

/** Validate the WAV container before decoding so oversized or malformed input is rejected early. */
export function validateCabinetWav(data: ArrayBuffer): void {
  if (data.byteLength < 44 || data.byteLength > MAX_CAB_IR_BYTES) {
    throw new Error(ko.cabinetIr.fileTooBig);
  }
  const view = new DataView(data);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(data, offset, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== data.byteLength) {
    throw new Error(ko.cabinetIr.notWav);
  }
  let format = 0, channels = 0, sampleRate = 0, bits = 0, blockAlign = 0, dataSize = 0;
  let foundFormat = false, foundData = false;
  for (let offset = 12; offset + 8 <= data.byteLength;) {
    const name = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > data.byteLength - start) throw new Error(ko.cabinetIr.corrupted);
    if (name === 'fmt ') {
      if (foundFormat || size < 16) throw new Error(ko.cabinetIr.formatUnknown);
      foundFormat = true;
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      bits = view.getUint16(start + 14, true);
    } else if (name === 'data') {
      if (foundData) throw new Error(ko.cabinetIr.dataInvalid);
      foundData = true;
      dataSize = size;
    }
    offset = start + size + (size % 2);
    if (offset > data.byteLength) throw new Error(ko.cabinetIr.corrupted);
  }
  const validBits = format === 1 ? [8, 16, 24, 32].includes(bits) : format === 3 && bits === 32;
  if (!foundFormat || !foundData || !validBits || ![1, 2].includes(channels) ||
      sampleRate < 8000 || sampleRate > 192000 || blockAlign !== channels * bits / 8) {
    throw new Error(ko.cabinetIr.unsupportedFormat);
  }
  if (!dataSize || dataSize % blockAlign || dataSize / blockAlign / sampleRate > MAX_CAB_IR_FILE_SECONDS) {
    throw new Error(ko.cabinetIr.tooLong);
  }
}

/** 디코딩된 IR 을 채널 배열로 본 모양. 시료는 모두 컨텍스트 샘플레이트 기준이다. */
export interface CabinetIrChannels {
  sampleRate: number;
  channels: Float32Array[];
}

export interface CabinetIrCut extends CabinetIrChannels {
  /** 1초를 넘어 잘렸으면 true(화면에 안내한다). 샘플 한두 개 차이는 잘린 것으로 치지 않는다. */
  cut: boolean;
  /** 자르기 전 길이(초). */
  originalSeconds: number;
}

/** 디코딩된 AudioBuffer 에서 채널 복사본을 꺼낸다(원본 버퍼를 건드리지 않는다). */
export function channelsOf(buffer: AudioBuffer): CabinetIrChannels {
  if (![1, 2].includes(buffer.numberOfChannels) || !(buffer.length > 0) || !(buffer.sampleRate > 0)) {
    throw new Error(ko.cabinetIr.decodedShape);
  }
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    channels.push(Float32Array.from(buffer.getChannelData(channel)));
  }
  return { sampleRate: buffer.sampleRate, channels };
}

/**
 * IR 을 최대 `MAX_CAB_IR_SECONDS` 로 자른다. 잘리면 끝 `CAB_IR_CUT_FADE_SECONDS` 를 반코사인으로 내려 딸깍 소리를 막는다.
 * 새 배열을 돌려주며 입력은 바꾸지 않는다.
 */
export function limitImpulseLength(source: CabinetIrChannels): CabinetIrCut {
  const { sampleRate } = source;
  const frames = source.channels[0]?.length ?? 0;
  const limit = Math.floor(MAX_CAB_IR_SECONDS * sampleRate);
  const originalSeconds = frames / sampleRate;
  if (frames <= limit) {
    return { sampleRate, channels: source.channels.map((channel) => Float32Array.from(channel)), cut: false, originalSeconds };
  }
  const cut = frames > limit + Math.ceil(CUT_TOLERANCE_SECONDS * sampleRate);
  const fadeFrames = cut ? Math.min(limit, Math.round(CAB_IR_CUT_FADE_SECONDS * sampleRate)) : 0;
  const channels = source.channels.map((channel) => {
    const kept = Float32Array.from(channel.subarray(0, limit));
    for (let index = 0; index < fadeFrames; index++) {
      // 끝에서 fadeFrames 번째(=1)부터 마지막(=0 에 가까움)까지.
      const position = (index + 1) / fadeFrames;
      kept[limit - fadeFrames + index] *= 0.5 * (1 + Math.cos(Math.PI * position));
    }
    return kept;
  });
  return { sampleRate, channels, cut, originalSeconds };
}

/** 시료 값과 무음을 확인한다. 자른 뒤의 IR 에 대해 부른다(앞 1초가 무음인 긴 파일을 놓치지 않는다). */
export function validateImpulseSamples(source: CabinetIrChannels): void {
  if (![1, 2].includes(source.channels.length) || !(source.channels[0]?.length > 0)) {
    throw new Error(ko.cabinetIr.decodedShape);
  }
  let peak = 0;
  for (const channel of source.channels) {
    for (let i = 0; i < channel.length; i++) {
      if (!Number.isFinite(channel[i]) || Math.abs(channel[i]) > 8) {
        throw new Error(ko.cabinetIr.badSample);
      }
      peak = Math.max(peak, Math.abs(channel[i]));
    }
  }
  if (peak < 1e-7) throw new Error(ko.cabinetIr.silent);
}
