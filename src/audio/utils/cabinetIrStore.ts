import { ko } from '../../i18n/ko';
import { MAX_CAB_IR_SECONDS } from './cabinetIr';

/**
 * 사용자 캐비닛 IR 의 영구 저장소(설계서 S5.4). 설정 저장소(localStorage 의 SafeStorage)와는 **따로** 둔다 —
 * IR 은 수백 KB 의 시료라 localStorage 의 5 MB 한도를 설정과 나눠 쓰면 설정 저장이 밀려난다.
 * 저장하는 것은 앞 1초로 자른 시료이며 정규화는 하지 않는다(정규화는 컨텍스트 샘플레이트에 맞춘 뒤에 한다).
 */
export interface StoredCabinetIr {
  name: string;
  sampleRate: number;
  /** 1초가 넘어 잘린 IR 인지. 새로고침 뒤에도 같은 안내를 보여 주려고 함께 둔다. */
  cut: boolean;
  /** 자르기 전 길이(초). */
  originalSeconds: number;
  /** 모노 1개 또는 스테레오 2개. 길이는 모두 같다. */
  channels: Float32Array[];
  savedAt: number;
}

export interface CabinetIrStore {
  /** 저장된 IR. 없거나 읽을 수 없으면 null. 저장소를 열지 못한 경우에만 던진다. */
  load(): Promise<StoredCabinetIr | null>;
  save(ir: StoredCabinetIr): Promise<void>;
  clear(): Promise<void>;
}

export const CAB_IR_DB_NAME = 'guitar-pedalboard-cabinet-ir';
export const CAB_IR_DB_VERSION = 1;
export const CAB_IR_STORE_NAME = 'impulses';
/** 저장하는 IR 은 하나뿐이다(Cab 페달은 하나). */
export const CAB_IR_RECORD_KEY = 'user-ir';

/** 저장소에서 읽은 값이 쓸 만한 IR 인지. 사용자가 개발자 도구로 건드렸거나 다른 버전이 쓴 값은 버린다. */
export function isStoredCabinetIr(value: unknown): value is StoredCabinetIr {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<StoredCabinetIr>;
  if (typeof record.name !== 'string' || typeof record.cut !== 'boolean') return false;
  if (typeof record.sampleRate !== 'number' || !(record.sampleRate >= 8000 && record.sampleRate <= 192000)) return false;
  if (typeof record.originalSeconds !== 'number' || !Number.isFinite(record.originalSeconds)) return false;
  if (typeof record.savedAt !== 'number') return false;
  const channels = record.channels;
  if (!Array.isArray(channels) || ![1, 2].includes(channels.length)) return false;
  const length = channels[0]?.length ?? 0;
  if (!(channels[0] instanceof Float32Array) || !(length > 0)) return false;
  if (length > Math.ceil(MAX_CAB_IR_SECONDS * record.sampleRate) + 1) return false;
  return channels.every((channel) => channel instanceof Float32Array && channel.length === length);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(ko.cabinetIr.storeFailed));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(ko.cabinetIr.storeFailed));
    transaction.onabort = () => reject(transaction.error ?? new Error(ko.cabinetIr.storeFailed));
  });
}

/**
 * IndexedDB 로 만든 저장소. 연결은 작업마다 열고 닫는다 — 오래 쥐고 있으면 다른 탭이 버전을 올릴 때 막는다.
 * `factory` 가 없으면(IndexedDB 를 막은 환경) 읽기는 null, 쓰기는 오류다.
 */
export function createIndexedDbIrStore(factory: IDBFactory | undefined = globalThis.indexedDB): CabinetIrStore {
  async function open(): Promise<IDBDatabase> {
    if (!factory) throw new Error(ko.cabinetIr.storeUnavailable);
    const request = factory.open(CAB_IR_DB_NAME, CAB_IR_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CAB_IR_STORE_NAME)) database.createObjectStore(CAB_IR_STORE_NAME);
    };
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(ko.cabinetIr.storeFailed));
    });
  }

  async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await open();
    try {
      const transaction = database.transaction(CAB_IR_STORE_NAME, mode);
      // 요청이 성공해도 트랜잭션이 끝나야(디스크에 쓰여야) 저장된 것이다. 둘 중 하나가 실패하면 나머지의 거절도 여기서 같이 처리된다.
      const [result] = await Promise.all([
        requestResult(work(transaction.objectStore(CAB_IR_STORE_NAME))),
        transactionDone(transaction),
      ]);
      return result;
    } finally {
      database.close();
    }
  }

  return {
    async load() {
      if (!factory) return null;
      const value = await withStore('readonly', (store) => store.get(CAB_IR_RECORD_KEY));
      return isStoredCabinetIr(value) ? value : null;
    },
    async save(ir) {
      await withStore('readwrite', (store) => store.put(ir, CAB_IR_RECORD_KEY));
    },
    async clear() {
      if (!factory) return;
      await withStore('readwrite', (store) => store.delete(CAB_IR_RECORD_KEY));
    },
  };
}
