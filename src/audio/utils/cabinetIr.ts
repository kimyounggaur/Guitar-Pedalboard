export const MAX_CAB_IR_BYTES = 4 * 1024 * 1024;
export const MAX_CAB_IR_SECONDS = 2;

/** Validate the WAV container before decoding so oversized or malformed input is rejected early. */
export function validateCabinetWav(data: ArrayBuffer): void {
  if (data.byteLength < 44 || data.byteLength > MAX_CAB_IR_BYTES) {
    throw new Error('IR 파일은 4 MB 이하의 WAV 파일이어야 합니다.');
  }
  const view = new DataView(data);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(data, offset, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== data.byteLength) {
    throw new Error('올바른 WAV 파일이 아닙니다.');
  }
  let format = 0, channels = 0, sampleRate = 0, bits = 0, blockAlign = 0, dataSize = 0;
  let foundFormat = false, foundData = false;
  for (let offset = 12; offset + 8 <= data.byteLength;) {
    const name = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > data.byteLength - start) throw new Error('WAV 파일이 손상되었습니다.');
    if (name === 'fmt ') {
      if (foundFormat || size < 16) throw new Error('WAV 형식을 확인할 수 없습니다.');
      foundFormat = true;
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      bits = view.getUint16(start + 14, true);
    } else if (name === 'data') {
      if (foundData) throw new Error('WAV 오디오 데이터가 올바르지 않습니다.');
      foundData = true;
      dataSize = size;
    }
    offset = start + size + (size % 2);
    if (offset > data.byteLength) throw new Error('WAV 파일이 손상되었습니다.');
  }
  const validBits = format === 1 ? [8, 16, 24, 32].includes(bits) : format === 3 && bits === 32;
  if (!foundFormat || !foundData || !validBits || ![1, 2].includes(channels) ||
      sampleRate < 8000 || sampleRate > 192000 || blockAlign !== channels * bits / 8) {
    throw new Error('모노 또는 스테레오 PCM/32비트 float WAV 파일만 지원합니다.');
  }
  if (!dataSize || dataSize % blockAlign || dataSize / blockAlign / sampleRate > MAX_CAB_IR_SECONDS) {
    throw new Error('IR 길이는 2초 이하여야 합니다.');
  }
}

export function validateDecodedCabinetIr(buffer: AudioBuffer): void {
  if (![1, 2].includes(buffer.numberOfChannels) || buffer.duration <= 0 ||
      buffer.duration > MAX_CAB_IR_SECONDS + 0.001) {
    throw new Error('IR 길이는 2초 이하, 채널은 모노 또는 스테레오여야 합니다.');
  }
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    for (let i = 0; i < channel.length; i++) {
      if (!Number.isFinite(channel[i]) || Math.abs(channel[i]) > 8) {
        throw new Error('IR에 사용할 수 없는 오디오 값이 있습니다.');
      }
      peak = Math.max(peak, Math.abs(channel[i]));
    }
  }
  if (peak < 1e-7) throw new Error('무음 IR은 사용할 수 없습니다.');
}
