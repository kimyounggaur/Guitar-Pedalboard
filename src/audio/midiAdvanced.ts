export const MIDI_ADVANCED_KEY = 'guitar-pedalboard:midi-advanced';
export interface MidiAdvancedConfig {
  channel: number;
  volumeCc: number | null;
  wahCc: number | null;
  programs: Record<string, string>;
}
export const DEFAULT_MIDI_ADVANCED: MidiAdvancedConfig = { channel: 1, volumeCc: null, wahCc: null, programs: {} };
const isCc = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 127;
export function validateMidiAdvanced(raw: unknown): MidiAdvancedConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_MIDI_ADVANCED, programs: {} };
  const value = raw as Record<string, unknown>;
  const channel = typeof value.channel === 'number' && Number.isInteger(value.channel) && value.channel >= 1 && value.channel <= 16 ? value.channel : 1;
  const volumeCc = isCc(value.volumeCc) ? value.volumeCc : null;
  const wahCc = isCc(value.wahCc) && value.wahCc !== volumeCc ? value.wahCc : null;
  const programs: Record<string, string> = {};
  if (value.programs && typeof value.programs === 'object' && !Array.isArray(value.programs)) {
    for (const [number, id] of Object.entries(value.programs)) {
      if (/^(0|[1-9]\d{0,2})$/.test(number) && Number(number) <= 127 && typeof id === 'string' && id.length > 0 && id.length <= 200) programs[number] = id;
    }
  }
  return { channel, volumeCc, wahCc, programs };
}
export function readMidiAdvanced(): MidiAdvancedConfig {
  try { return validateMidiAdvanced(JSON.parse(localStorage.getItem(MIDI_ADVANCED_KEY) ?? '{}')); }
  catch { return validateMidiAdvanced(null); }
}
export function parseAdvancedMessage(data: ArrayLike<number> | null | undefined, config: MidiAdvancedConfig): { type: 'program' | 'volume' | 'wah'; value: number } | null {
  if (!data || data.length < 2) return null;
  const [status, number, value] = [data[0], data[1], data[2]];
  if (!Number.isInteger(status) || status < 0 || status > 255 || (status & 15) + 1 !== config.channel || !isCc(number)) return null;
  if ((status & 0xf0) === 0xc0 && Object.hasOwn(config.programs, String(number))) return { type: 'program', value: number };
  if ((status & 0xf0) !== 0xb0 || !isCc(value)) return null;
  if (number === config.volumeCc) return { type: 'volume', value };
  if (number === config.wahCc) return { type: 'wah', value };
  return null;
}

export function dispatchAdvancedMessage(
  data: ArrayLike<number> | null | undefined,
  config: MidiAdvancedConfig,
  actions: { program: (id: string) => void; volume: (value: number) => void; wah: (value: number) => void },
): boolean {
  const message = parseAdvancedMessage(data, config);
  if (!message) return false;
  if (message.type === 'program') actions.program(config.programs[String(message.value)]);
  else if (message.type === 'volume') actions.volume(message.value / 127);
  else actions.wah(Math.round(message.value * 100 / 127));
  return true;
}
