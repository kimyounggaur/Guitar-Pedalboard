// MIDI 메시지 하나를 어디에 쓸지 정한다: 학습 중이면 매핑으로 저장하고, 아니면 매핑된 페달을 켜고 끈다(S2.9, 설계서 4.11).
// 브라우저·저장소·화면을 모른다. 바깥과는 `MidiRouterPorts` 로만 이야기하므로 Node 시험이 가짜 포트로 모든 경우를 돌려 볼 수 있다.
import {
  createMidiMapping,
  midiMappingMatches,
  type MidiMapping,
  type MidiMappings,
  type MidiMode,
  type ParsedMidiMessage,
} from './mapping';

/** 학습할 때 누름(64 이상) 뒤 이 시간 안에 뗌(64 미만)이 이어서 오면 `toggle` 로 본다. 설계서 4.11 의 1초. */
export const MIDI_MODE_PROBE_MS = 1000;

/** 학습이 끝난 뒤 방식을 어떻게 정했는지 알리는 내용. 화면이 문장으로 바꾼다. */
export interface MidiModeNotice {
  pedalId: string;
  /** `toggle`: 누름→뗌이 1초 안에 이어졌다 / `momentary`(latch): 1초 안에 뗌이 오지 않았다 */
  mode: MidiMode;
  mapping: MidiMapping;
}

export interface MidiRouterPorts {
  getMappings(): MidiMappings;
  /** 학습한 매핑을 저장하고 학습 상태를 끝낸다(한 번에). */
  learned(mappings: MidiMappings): void;
  /** 학습이 아닌 매핑 변경(방식 자동 지정)을 저장한다. */
  changeMappings(mappings: MidiMappings): void;
  getLearningPedalId(): string | null;
  /** 페달이 없는 학습을 끝낸다. */
  endLearning(): void;
  /** 페달이 지금 켜져 있는가. 그런 페달이 없으면 `undefined`. */
  pedalActive(pedalId: string): boolean | undefined;
  setPedalActive(pedalId: string, active: boolean): void;
  notifyMode(notice: MidiModeNotice): void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

interface ModeProbe {
  pedalId: string;
  mapping: MidiMapping;
  startedAt: number;
  timer: unknown;
}

function sameControl(left: MidiMapping, right: MidiMapping): boolean {
  if (left.channel !== right.channel) return false;
  if ('cc' in left || 'cc' in right) return 'cc' in left && 'cc' in right && left.cc === right.cc;
  return 'note' in left && 'note' in right && left.note === right.note;
}

export class MidiRouter {
  /** 토글 방식에서 '이미 눌려 있는' 스위치(누른 채 반복되는 값에 다시 전환하지 않기 위해). */
  private readonly pressed = new Map<string, boolean>();
  private probe: ModeProbe | null = null;

  constructor(private readonly ports: MidiRouterPorts) {}

  /** `timeStamp`: 메시지를 받은 시각(ms). 학습 때 누름과 뗌의 간격을 잴 때만 쓴다. */
  handle(message: ParsedMidiMessage, timeStamp: number): void {
    const learningPedalId = this.ports.getLearningPedalId();
    if (learningPedalId) {
      this.learn(learningPedalId, message, timeStamp);
      return;
    }
    if (this.probe && this.consumeProbe(message, timeStamp)) return;

    Object.entries(this.ports.getMappings()).forEach(([pedalId, mapping]) => {
      if (!midiMappingMatches(mapping, message)) return;

      const current = this.ports.pedalActive(pedalId);
      if (current === undefined) return;
      let active = message.active;
      if (mapping.mode === 'toggle') {
        const pressed = message.active;
        const wasPressed = this.pressed.get(pedalId) ?? false;
        this.pressed.set(pedalId, pressed);
        if (!pressed || wasPressed) return;
        active = !current;
      }
      // 이미 그 상태면 아무것도 하지 않는다(저장도 엔진 호출도 없다). 켜고 끄는 입구는 하나다.
      this.ports.setPedalActive(pedalId, active);
    });
  }

  /** 방식을 사용자가 바꾸거나 매핑을 지웠다: 그 페달의 눌림 기억과 방식 확인을 버린다. */
  forget(pedalId: string): void {
    this.pressed.delete(pedalId);
    if (this.probe?.pedalId === pedalId) this.clearProbe();
  }

  dispose(): void {
    this.clearProbe();
    this.pressed.clear();
  }

  private learn(pedalId: string, message: ParsedMidiMessage, timeStamp: number): void {
    if (this.ports.pedalActive(pedalId) === undefined) {
      this.ports.endLearning();
      return;
    }

    this.clearProbe();
    this.pressed.delete(pedalId);
    const mapping = createMidiMapping(message);
    this.ports.learned({ ...this.ports.getMappings(), [pedalId]: mapping });

    // 누름으로 시작했을 때만 뗌이 이어서 오는지 본다. 값이 없는(방식이 안 적힌) 매핑이 곧 latch 다.
    if (!message.active) return;
    const probe: ModeProbe = {
      pedalId,
      mapping,
      startedAt: timeStamp,
      timer: this.ports.setTimer(() => this.expireProbe(probe), MIDI_MODE_PROBE_MS),
    };
    this.probe = probe;
  }

  /** 방식을 가리는 1초 동안 온 메시지를 본다. 뗌이면 먹고 `toggle` 로 정한다. 먹었으면 true. */
  private consumeProbe(message: ParsedMidiMessage, timeStamp: number): boolean {
    const probe = this.probe;
    if (!probe) return false;
    const mapping = this.ports.getMappings()[probe.pedalId];
    if (!mapping || !sameControl(mapping, probe.mapping)) {
      this.clearProbe();
      return false;
    }
    if (!midiMappingMatches(mapping, message)) return false;
    if (timeStamp - probe.startedAt > MIDI_MODE_PROBE_MS) {
      this.expireProbe(probe);
      return false;
    }
    // 같은 누름 값이 또 오는 것은 방식을 가르지 않는다 — 평소처럼 처리한다.
    if (message.active) return false;

    this.clearProbe();
    this.ports.changeMappings({ ...this.ports.getMappings(), [probe.pedalId]: { ...mapping, mode: 'toggle' } });
    this.ports.notifyMode({ pedalId: probe.pedalId, mode: 'toggle', mapping });
    return true;
  }

  private expireProbe(probe: ModeProbe): void {
    if (this.probe !== probe) return;
    this.clearProbe();
    const mapping = this.ports.getMappings()[probe.pedalId];
    if (mapping && sameControl(mapping, probe.mapping)) {
      this.ports.notifyMode({ pedalId: probe.pedalId, mode: 'momentary', mapping });
    }
  }

  private clearProbe(): void {
    if (!this.probe) return;
    this.ports.clearTimer(this.probe.timer);
    this.probe = null;
  }
}
