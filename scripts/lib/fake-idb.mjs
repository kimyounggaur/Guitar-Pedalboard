// IndexedDB 의 아주 작은 가짜(S5.4). 저장소 코드가 쓰는 만큼만 흉내 낸다 — 열기·업그레이드·get/put/delete·트랜잭션 완료·연결 닫기.
//
// 진짜 IndexedDB 와 같은 점: 요청 결과는 다음 매크로 태스크에 오고, 트랜잭션 완료는 그 뒤에 오며, 저장한 값은 구조적 복사본이다.
// 시험이 심을 수 있는 고장: failOpen(열기 오류), failRequests(요청 오류), abortWrites(쓰기 트랜잭션 중단), holdComplete(완료를 풀어 줄 때까지 미룸).
// 시험이 볼 수 있는 것: databases(이름 → 저장소 → 키 → 값), openConnections(닫지 않은 연결 수), log(작업 순서).
import { deserialize, serialize } from 'node:v8';
import { setTimeout } from 'node:timers';

/** 구조적 복사(진짜 IndexedDB 가 저장·읽기 때 하는 것). Float32Array 같은 타입 배열도 그대로 복사한다. */
function structuredClone(value) {
  return deserialize(serialize(value));
}

export function createFakeIndexedDb() {
  const databases = new Map();
  const state = {
    databases,
    openConnections: 0,
    log: [],
    failOpen: null,
    failRequests: null,
    abortWrites: false,
    holdComplete: false,
    held: [],
  };
  const later = (callback) => setTimeout(callback, 0);

  function makeRequest() {
    return { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null };
  }

  function makeStore(database, storeName, transaction) {
    const data = database.stores.get(storeName);
    const issue = (kind, key, apply) => {
      const request = makeRequest();
      state.log.push(`${kind}:${storeName}:${key}`);
      later(() => {
        if (state.failRequests) {
          request.error = new Error(state.failRequests);
          request.onerror?.();
          transaction.fail(request.error);
          return;
        }
        request.result = apply();
        request.onsuccess?.();
        transaction.requestDone();
      });
      transaction.pending += 1;
      return request;
    };
    return {
      get: (key) => issue('get', key, () => (data.has(key) ? structuredClone(data.get(key)) : undefined)),
      put: (value, key) => issue('put', key, () => {
        if (transaction.mode !== 'readwrite') throw new Error('readonly transaction');
        transaction.writes.push(() => data.set(key, structuredClone(value)));
        return key;
      }),
      delete: (key) => issue('delete', key, () => {
        if (transaction.mode !== 'readwrite') throw new Error('readonly transaction');
        transaction.writes.push(() => data.delete(key));
        return undefined;
      }),
    };
  }

  function makeTransaction(database, storeNames, mode) {
    const transaction = {
      mode, pending: 0, writes: [], finished: false, error: null,
      oncomplete: null, onerror: null, onabort: null,
      objectStore: (name) => {
        if (!database.stores.has(name)) throw new Error(`no store ${name}`);
        return makeStore(database, name, transaction);
      },
      requestDone() {
        transaction.pending -= 1;
        if (transaction.pending > 0 || transaction.finished) return;
        const finish = () => {
          if (transaction.finished) return;
          transaction.finished = true;
          if (state.abortWrites && mode === 'readwrite') {
            transaction.error = new Error('aborted');
            transaction.onabort?.();
            return;
          }
          for (const write of transaction.writes) write();
          transaction.oncomplete?.();
        };
        if (state.holdComplete) state.held.push(finish); else later(finish);
      },
      fail(error) {
        if (transaction.finished) return;
        transaction.finished = true;
        transaction.error = error;
        transaction.onabort?.();
      },
    };
    void storeNames;
    return transaction;
  }

  const factory = {
    open(name, version) {
      const request = makeRequest();
      state.log.push(`open:${name}:${version}`);
      later(() => {
        if (state.failOpen) {
          request.error = new Error(state.failOpen);
          request.onerror?.();
          return;
        }
        let database = databases.get(name);
        const isNew = !database;
        if (isNew) {
          database = { version, stores: new Map() };
          databases.set(name, database);
        }
        const connection = {
          closed: false,
          get objectStoreNames() { return { contains: (store) => database.stores.has(store) }; },
          createObjectStore: (store) => { database.stores.set(store, new Map()); },
          transaction: (storeNames, mode = 'readonly') => makeTransaction(database, storeNames, mode),
          close() {
            if (connection.closed) return;
            connection.closed = true;
            state.openConnections -= 1;
            state.log.push(`close:${name}`);
          },
        };
        state.openConnections += 1;
        request.result = connection;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory, state, release: () => { const held = state.held.splice(0); held.forEach((finish) => finish()); } };
}
