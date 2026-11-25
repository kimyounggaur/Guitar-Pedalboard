// 브라우저 Web MIDI 와의 연결을 맡는다: 권한 확인, MIDIAccess 얻기, 입력 장치에 리스너 붙이고 떼기, 장치가 뽑혔다 꽂히면 다시 붙이기
// (S2.9, 설계서 4.11). 저장소·화면·페달을 모른다 — 메시지는 `onMessage` 로, 상태는 `onState` 로만 바깥에 알린다.
//
// 가장 중요한 규칙: **사용자 동작 없이는 권한 창을 띄우지 않는다.** 페이지를 열 때(`connectIfAllowed`)는 권한이 이미 허용(granted)일 때만
// 연결하고, 아니면 '연결이 필요함' 상태로 두어 화면이 버튼을 보여 주게 한다. 권한 창이 떠도 되는 길은 사용자가 누른 버튼(`connect`)뿐이다.
import type { MidiDeviceInfo } from './mapping';

/** 브라우저가 알려 주는 MIDI 권한. `unknown`: 권한 조회를 지원하지 않거나 조회에 실패했다(Firefox·Safari 등). */
export type MidiPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/**
 * 연결 상태.
 * - `unsupported`: 이 브라우저에 Web MIDI 가 없다
 * - `idle`: 아직 연결하지 않았다(저장된 매핑이 없거나 시작 전)
 * - `needs-permission`: 저장된 설정이 있지만 사용자가 연결 버튼을 눌러야 한다(권한이 prompt·알 수 없음)
 * - `denied`: 권한이 막혔거나 연결에 실패했다
 * - `connecting`: MIDIAccess 를 기다리는 중
 * - `connected`: MIDIAccess 를 얻고 입력 장치를 지켜보는 중(장치가 0개여도 연결된 것이다)
 */
export type MidiLink = 'unsupported' | 'idle' | 'needs-permission' | 'denied' | 'connecting' | 'connected';

export interface MidiServiceState {
  link: MidiLink;
  permission: MidiPermission;
  devices: MidiDeviceInfo[];
}

export interface MidiServiceHost {
  onMessage: (event: MIDIMessageEvent) => void;
  onState: (state: MidiServiceState) => void;
}

/** 카드에 쓰는 연결 표시(설계서 4.11 '매핑됨 · 연결됨 / 매핑됨 · 장치 없음'). 연결 전에는 장치 이야기를 하지 않는다. */
export function describeMidiConnection(link: MidiLink, deviceCount: number): string {
  if (link === 'connected') return deviceCount > 0 ? '연결됨' : '장치 없음';
  if (link === 'connecting') return '연결 중';
  return '연결 안 됨';
}

export class MidiService {
  /** dispose 마다 올라간다. 늦게 도착한 MIDIAccess 가 이미 끝난 세션에 붙지 않게 한다. */
  private generationValue = 0;
  private access: MIDIAccess | null = null;
  private pending: Promise<MIDIAccess> | null = null;
  private readonly attached = new Map<string, MIDIInput>();
  private permissionStatus: PermissionStatus | null = null;
  /** 저장된 설정 때문에 자동 연결을 시도한 적이 있다: 나중에 권한이 허용되면 저절로 이어서 연결한다. */
  private wantsAutoConnect = false;
  private state: MidiServiceState = { link: 'idle', permission: 'unknown', devices: [] };

  constructor(private readonly host: MidiServiceHost) {}

  get generation(): number {
    return this.generationValue;
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  getState(): MidiServiceState {
    return this.state;
  }

  /**
   * 페이지를 열 때처럼 사용자 동작이 없는 연결. 권한이 이미 허용돼 있을 때만 MIDIAccess 를 요청한다.
   * 허용이 아니면 권한 창을 띄우지 않고 `needs-permission`(prompt·알 수 없음) 또는 `denied` 로 둔다.
   * 연결에 실패하면 예외를 던진다.
   */
  async connectIfAllowed(): Promise<MidiLink> {
    if (!this.supported) return this.update({ link: 'unsupported' }).link;
    this.wantsAutoConnect = true;
    if (this.access) {
      this.syncInputs();
      return this.state.link;
    }

    const generation = this.generationValue;
    const permission = await this.queryPermission();
    if (generation !== this.generationValue) return this.state.link;
    if (permission === 'granted') {
      await this.connect();
    } else {
      this.update({ link: permission === 'denied' ? 'denied' : 'needs-permission' });
    }
    return this.state.link;
  }

  /** 사용자가 버튼을 눌러 연결한다(학습·'다시 연결'). 권한 창이 떠도 된다. 실패하면 예외를 던진다. */
  async connect(): Promise<MIDIAccess> {
    if (this.access) {
      this.syncInputs();
      return this.access;
    }
    if (!this.supported) {
      this.update({ link: 'unsupported' });
      throw new Error('Web MIDI를 지원하지 않는 브라우저입니다.');
    }

    const generation = this.generationValue;
    const request = this.pending ?? navigator.requestMIDIAccess({ sysex: false });
    this.pending = request;
    this.update({ link: 'connecting' });
    try {
      const access = await request;
      if (generation !== this.generationValue) return access;
      this.attach(access);
      return access;
    } catch (error) {
      if (generation === this.generationValue) this.update({ link: 'denied', devices: [] });
      throw error;
    } finally {
      if (this.pending === request) this.pending = null;
    }
  }

  /** 모든 리스너를 떼고 처음 상태로 돌아간다. 이 뒤에 도착하는 MIDIAccess 는 무시한다. */
  dispose(): void {
    this.generationValue += 1;
    this.pending = null;
    this.wantsAutoConnect = false;
    this.attached.forEach((input) => {
      if (input.onmidimessage === this.messageHandler) input.onmidimessage = null;
    });
    this.attached.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    if (this.permissionStatus) this.permissionStatus.onchange = null;
    this.permissionStatus = null;
    this.state = { link: this.supported ? 'idle' : 'unsupported', permission: 'unknown', devices: [] };
    this.host.onState(this.state);
  }

  private readonly messageHandler = (event: MIDIMessageEvent): void => {
    this.host.onMessage(event);
  };

  private readonly stateChangeHandler = (): void => {
    this.syncInputs();
  };

  private update(patch: Partial<MidiServiceState>): MidiServiceState {
    this.state = { ...this.state, ...patch };
    this.host.onState(this.state);
    return this.state;
  }

  private async queryPermission(): Promise<MidiPermission> {
    const permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!permissions || typeof permissions.query !== 'function') {
      this.update({ permission: 'unknown' });
      return 'unknown';
    }
    try {
      const status = await permissions.query({ name: 'midi', sysex: false } as PermissionDescriptor);
      if (this.permissionStatus !== status) {
        if (this.permissionStatus) this.permissionStatus.onchange = null;
        this.permissionStatus = status;
        status.onchange = () => this.handlePermissionChange(status);
      }
      const permission: MidiPermission =
        status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown';
      this.update({ permission });
      return permission;
    } catch {
      this.update({ permission: 'unknown' });
      return 'unknown';
    }
  }

  /** 사용자가 브라우저 설정에서 권한을 바꿨다. 허용으로 바뀌었고 연결을 기다리던 중이었다면 이어서 연결한다. */
  private handlePermissionChange(status: PermissionStatus): void {
    if (status !== this.permissionStatus) return;
    const permission: MidiPermission =
      status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown';
    this.update({ permission });
    if (permission === 'granted' && this.wantsAutoConnect && !this.access && !this.pending) {
      void this.connect().catch(() => undefined);
    }
  }

  private attach(access: MIDIAccess): void {
    if (this.access && this.access !== access) this.access.onstatechange = null;
    this.access = access;
    access.onstatechange = this.stateChangeHandler;
    this.update({ link: 'connected' });
    this.syncInputs();
  }

  /** 지금 꽂혀 있는 입력 장치에만 리스너를 붙이고, 뽑힌 장치의 것은 뗀다. 같은 장치에 두 번 붙이지 않는다. */
  private syncInputs(): void {
    const access = this.access;
    if (!access) return;

    const connectedInputs = new Map<string, MIDIInput>();
    access.inputs.forEach((input) => {
      if (input.state === 'connected') connectedInputs.set(input.id, input);
    });

    this.attached.forEach((input, inputId) => {
      if (connectedInputs.get(inputId) === input) return;
      if (input.onmidimessage === this.messageHandler) input.onmidimessage = null;
      this.attached.delete(inputId);
    });

    connectedInputs.forEach((input, inputId) => {
      const previousInput = this.attached.get(inputId);
      if (previousInput === input && input.onmidimessage === this.messageHandler) return;
      input.onmidimessage = this.messageHandler;
      this.attached.set(inputId, input);
    });

    const devices: MidiDeviceInfo[] = Array.from(connectedInputs.values())
      .map((input) => ({
        id: input.id,
        name: input.name ?? 'MIDI 입력',
        manufacturer: input.manufacturer ?? '',
        state: input.state,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    this.update({ devices });
  }
}
