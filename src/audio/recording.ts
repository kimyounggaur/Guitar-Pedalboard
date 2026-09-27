const WEBM_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;

export function selectRecorderMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): string | undefined {
  if (!isTypeSupported) return undefined;
  return WEBM_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType));
}

export function createRecordingFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `pedalboard-${datePart}-${timePart}.webm`;
}
