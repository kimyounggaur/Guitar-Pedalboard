export const MIDI_STORAGE_KEY = 'guitar-pedalboard:midi';

export interface MidiCcMapping {
  channel: number;
  cc: number;
  value: number;
  note?: never;
}

export interface MidiNoteMapping {
  channel: number;
  note: number;
  value: number;
  cc?: never;
}

export type MidiMapping = MidiCcMapping | MidiNoteMapping;
export type MidiMappings = Record<string, MidiMapping>;

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
}

export interface ParsedMidiCcMessage {
  kind: 'cc';
  channel: number;
  cc: number;
  value: number;
  bypassed: boolean;
}

export interface ParsedMidiNoteMessage {
  kind: 'note';
  channel: number;
  note: number;
  value: number;
  bypassed: boolean;
}

export type ParsedMidiMessage = ParsedMidiCcMessage | ParsedMidiNoteMessage;

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafePedalId(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '__proto__' &&
    value !== 'constructor' &&
    value !== 'prototype'
  );
}

export function isMidiMapping(value: unknown): value is MidiMapping {
  if (!isPlainRecord(value)) return false;

  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'channel' && key !== 'cc' && key !== 'note' && key !== 'value')) {
    return false;
  }

  const hasCc = Object.hasOwn(value, 'cc');
  const hasNote = Object.hasOwn(value, 'note');
  return (
    hasCc !== hasNote &&
    isIntegerInRange(value.channel, 1, 16) &&
    isIntegerInRange(value.value, 0, 127) &&
    (hasCc
      ? isIntegerInRange(value.cc, 0, 127)
      : isIntegerInRange(value.note, 0, 127))
  );
}

export function validateMidiMappings(value: unknown): MidiMappings {
  if (!isPlainRecord(value)) return {};

  const mappings: MidiMappings = {};
  Object.entries(value).forEach(([pedalId, mapping]) => {
    if (!isSafePedalId(pedalId) || !isMidiMapping(mapping)) return;
    mappings[pedalId] = { ...mapping };
  });
  return mappings;
}

export function parseMidiMappingsJson(value: string | null): MidiMappings {
  if (!value) return {};

  try {
    return validateMidiMappings(JSON.parse(value));
  } catch {
    return {};
  }
}

export function parseMidiMessage(
  data: ArrayLike<number> | null | undefined,
): ParsedMidiMessage | null {
  if (!data || data.length < 3) return null;

  const status = data[0];
  const data1 = data[1];
  const data2 = data[2];
  if (
    !isIntegerInRange(status, 0, 255) ||
    !isIntegerInRange(data1, 0, 127) ||
    !isIntegerInRange(data2, 0, 127)
  ) {
    return null;
  }

  const messageType = status & 0xf0;
  const channel = (status & 0x0f) + 1;

  if (messageType === 0xb0) {
    return {
      kind: 'cc',
      channel,
      cc: data1,
      value: data2,
      bypassed: data2 >= 64,
    };
  }

  if (messageType === 0x80 || messageType === 0x90) {
    return {
      kind: 'note',
      channel,
      note: data1,
      value: data2,
      bypassed: messageType === 0x90 && data2 > 0,
    };
  }

  return null;
}

export function createMidiMapping(message: ParsedMidiMessage): MidiMapping {
  return message.kind === 'cc'
    ? { channel: message.channel, cc: message.cc, value: message.value }
    : { channel: message.channel, note: message.note, value: message.value };
}

export function midiMappingMatches(
  mapping: MidiMapping,
  message: ParsedMidiMessage,
): boolean {
  if (mapping.channel !== message.channel) return false;
  return message.kind === 'cc'
    ? 'cc' in mapping && mapping.cc === message.cc
    : 'note' in mapping && mapping.note === message.note;
}

export function formatMidiMapping(mapping: MidiMapping): string {
  return 'cc' in mapping
    ? `Ch ${mapping.channel} · CC ${mapping.cc}`
    : `Ch ${mapping.channel} · Note ${mapping.note}`;
}
