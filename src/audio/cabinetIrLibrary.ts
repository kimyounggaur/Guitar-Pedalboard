import { ko } from '../i18n/ko';
import type { UserCabinetImpulse } from './nodes/CabEffect';
import { normalizeUserImpulse } from './utils/cabinet';
import {
  MAX_CAB_IR_BYTES,
  limitImpulseLength,
  validateCabinetWav,
  validateImpulseSamples,
  type CabinetIrChannels,
} from './utils/cabinetIr';
import type { CabinetIrStore, StoredCabinetIr } from './utils/cabinetIrStore';

/** 화면에 보이는 IR 정보. */
export interface CabinetIrInfo {
  name: string;
  /** 1초가 넘어 잘렸는가. */
  cut: boolean;
  /** 자르기 전 길이(초). */
  originalSeconds: number;
}

export interface CabinetIrImportResult {
  info: CabinetIrInfo;
  /** 이 브라우저에 저장됐는가. false 면 이번 접속 동안만 쓸 수 있다(저장소가 막혔거나 가득 참). */
  persisted: boolean;
}

/** 브라우저 오디오가 하는 일. 라이브러리가 Web Audio 를 직접 만지지 않게 나눠서 Node 에서 가짜로 시험한다. */
export interface CabinetIrAudio {
  /** WAV 바이트를 디코딩한다. 결과는 `sampleRate` 로 맞춰진 시료다(decodeAudioData 의 약속). */
  decode(bytes: ArrayBuffer, sampleRate: number): Promise<CabinetIrChannels>;
  /** 시료를 다른 샘플레이트로 바꾼다(OfflineAudioContext). */
  resample(source: CabinetIrChannels, targetRate: number): Promise<CabinetIrChannels>;
  /** 시료로 AudioBuffer 를 만든다. */
  createBuffer(source: CabinetIrChannels): AudioBuffer;
}

/** 컨텍스트가 없을 때(오디오를 시작하기 전에 불러올 때) 디코딩에 쓰는 샘플레이트. 시작할 때 실제 컨텍스트에 맞춰 다시 바꾼다. */
export const DEFAULT_IR_DECODE_RATE = 48000;

interface Prepared extends UserCabinetImpulse {
  revision: number;
  sampleRate: number;
}

/**
 * 사용자 캐비닛 IR 하나를 맡는다(설계서 S5.4): WAV 가져오기 → 디코딩 → 1초로 자르기 → 저장소에 보관 →
 * 컨텍스트 샘플레이트로 맞추고 에너지 정규화한 AudioBuffer 만들기.
 * 저장소에는 자른 원본 시료를 두고, 정규화·샘플레이트 맞춤은 쓸 때마다 한다 — 다른 기기·다른 오디오 장치에서도 같은 IR 이 맞게 쓰이도록.
 */
export class CabinetIrLibrary {
  private stored: StoredCabinetIr | null = null;
  private loaded: Promise<void> | null = null;
  /** 저장된 IR 이 바뀔 때마다 오른다. 오래 걸리는 준비가 끝났을 때 그 사이 IR 이 바뀌었는지 보는 용도. */
  private revision = 0;
  private importToken = 0;
  private prepared: Prepared | null = null;
  private preparing: { revision: number; sampleRate: number; promise: Promise<UserCabinetImpulse | null> } | null = null;

  constructor(
    private readonly store: CabinetIrStore,
    private readonly audio: CabinetIrAudio,
    private readonly onChange: () => void = () => {},
  ) {}

  /** 지금 IR 의 정보. 아직 저장소를 읽지 않았으면 null 이다(`load()` 뒤에 믿을 수 있다). */
  info(): CabinetIrInfo | null {
    if (!this.stored) return null;
    return { name: this.stored.name, cut: this.stored.cut, originalSeconds: this.stored.originalSeconds };
  }

  /** 저장소에서 IR 을 읽는다. 한 번만 읽고, 읽기 실패는 '저장된 IR 없음' 으로 본다(앱 시작을 막지 않는다). */
  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        let record: StoredCabinetIr | null = null;
        try { record = await this.store.load(); } catch { record = null; }
        // 읽는 동안 사용자가 새 IR 을 불러왔으면 그것이 더 새롭다.
        if (this.revision === 0 && record) {
          this.stored = record;
          this.revision += 1;
          this.onChange();
        }
      })();
    }
    return this.loaded;
  }

  async importFile(file: File, sampleRate: number = DEFAULT_IR_DECODE_RATE): Promise<CabinetIrImportResult> {
    if (!file.name.toLowerCase().endsWith('.wav') || file.size > MAX_CAB_IR_BYTES) {
      throw new Error(ko.cabinetIr.fileTooBig);
    }
    const token = ++this.importToken;
    const bytes = await file.arrayBuffer();
    validateCabinetWav(bytes);
    let decoded: CabinetIrChannels;
    try { decoded = await this.audio.decode(bytes, sampleRate); }
    catch { throw new Error(ko.cabinetIr.readFailed); }
    const limited = limitImpulseLength(decoded);
    validateImpulseSamples(limited);
    if (token !== this.importToken) throw new Error(ko.cabinetIr.cancelled);

    // 사용자가 시작 직후 불러오는 경우에도 저장소의 옛 값이 새 값을 덮지 않게, 읽기가 끝난 것으로 친다.
    this.loaded ??= Promise.resolve();
    const record: StoredCabinetIr = {
      name: file.name,
      sampleRate: limited.sampleRate,
      cut: limited.cut,
      originalSeconds: limited.originalSeconds,
      channels: limited.channels,
      savedAt: Date.now(),
    };
    this.stored = record;
    this.revision += 1;
    this.prepared = null;
    let persisted = true;
    try { await this.store.save(record); } catch { persisted = false; }
    this.onChange();
    return { info: this.info() as CabinetIrInfo, persisted };
  }

  /** 저장된 IR 을 지운다. 저장소를 못 지워도 이번 접속에서는 쓰지 않는다. */
  async remove(): Promise<void> {
    this.importToken += 1;
    this.loaded ??= Promise.resolve();
    this.stored = null;
    this.revision += 1;
    this.prepared = null;
    this.onChange();
    try { await this.store.clear(); } catch { /* 이번 접속에서는 이미 쓰지 않는다 */ }
  }

  /** 이 샘플레이트로 이미 준비된 IR(동기). 준비하지 않았거나 그 사이 IR 이 바뀌었으면 null. */
  ready(sampleRate: number): UserCabinetImpulse | null {
    const prepared = this.prepared;
    if (!prepared || prepared.revision !== this.revision || prepared.sampleRate !== sampleRate) return null;
    return prepared;
  }

  /** 이 샘플레이트에 맞춘 IR 을 준비한다. 저장된 IR 이 없거나 만들지 못하면 null(오디오 시작을 막지 않는다). */
  async prepare(sampleRate: number): Promise<UserCabinetImpulse | null> {
    await this.load();
    const revision = this.revision;
    const ready = this.ready(sampleRate);
    if (ready) return ready;
    if (this.preparing?.revision === revision && this.preparing.sampleRate === sampleRate) return this.preparing.promise;
    const promise = this.build(sampleRate, revision).finally(() => {
      if (this.preparing?.promise === promise) this.preparing = null;
    });
    this.preparing = { revision, sampleRate, promise };
    return promise;
  }

  private async build(sampleRate: number, revision: number): Promise<UserCabinetImpulse | null> {
    const record = this.stored;
    if (!record) return null;
    try {
      let source: CabinetIrChannels = { sampleRate: record.sampleRate, channels: record.channels };
      if (record.sampleRate !== sampleRate) {
        source = limitImpulseLength(await this.audio.resample(source, sampleRate));
      }
      const { channels, makeupDb } = normalizeUserImpulse(source.channels, sampleRate);
      const buffer = this.audio.createBuffer({ sampleRate, channels });
      if (revision !== this.revision) return this.prepare(sampleRate);
      this.prepared = { buffer, makeupDb, revision, sampleRate };
      return this.prepared;
    } catch {
      return null;
    }
  }
}
