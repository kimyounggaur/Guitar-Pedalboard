import type { ReverbMode } from '../types';
import type {
  ImpulseWorkerRequest,
  ImpulseWorkerResponse,
} from '../workers/impulseProtocol';
import { createImpulseResponse } from './impulse';

export const MAX_IMPULSE_CACHE_ENTRIES = 24;

export interface ImpulseDescriptor {
  key: string;
  mode: ReverbMode;
  seconds: number;
  sampleRate: number;
}

interface PendingWorkerRequest {
  descriptor: ImpulseDescriptor;
  resolve: (buffer: AudioBuffer) => void;
  reject: (reason?: unknown) => void;
}

function createDisposedError(): Error {
  const error = new Error('Impulse cache has been disposed.');
  error.name = 'AbortError';
  return error;
}

export class ImpulseCache {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly inFlightByKey = new Map<string, Promise<AudioBuffer>>();
  private readonly pendingById = new Map<string, PendingWorkerRequest>();
  private worker: Worker | null = null;
  private requestCounter = 0;
  private disposed = false;

  constructor(private readonly context: AudioContext) {
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('../workers/impulse.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (event: MessageEvent<ImpulseWorkerResponse>) => {
          this.handleWorkerMessage(event.data);
        };
        this.worker.onerror = (event) => {
          event.preventDefault();
          this.disableWorkerAndFallback();
        };
        this.worker.onmessageerror = () => {
          this.disableWorkerAndFallback();
        };
      }
    } catch {
      this.worker = null;
    }
  }

  describe(mode: ReverbMode, decay: number): ImpulseDescriptor {
    const seconds = Number(Math.min(6, Math.max(0.2, decay)).toFixed(1));
    const sampleRate = this.context.sampleRate;

    return {
      key: `${mode}:${seconds.toFixed(1)}:${sampleRate}`,
      mode,
      seconds,
      sampleRate,
    };
  }

  getCached(descriptor: ImpulseDescriptor): AudioBuffer | undefined {
    const buffer = this.buffers.get(descriptor.key);
    if (!buffer) return undefined;

    this.buffers.delete(descriptor.key);
    this.buffers.set(descriptor.key, buffer);
    return buffer;
  }

  request(descriptor: ImpulseDescriptor): Promise<AudioBuffer> {
    if (this.disposed) {
      return Promise.reject(createDisposedError());
    }

    const cached = this.getCached(descriptor);
    if (cached) return Promise.resolve(cached);

    const existing = this.inFlightByKey.get(descriptor.key);
    if (existing) return existing;

    const source = this.worker
      ? this.requestFromWorker(descriptor)
      : this.createSynchronously(descriptor);
    const tracked = source
      .then((buffer) => {
        if (!this.disposed) {
          this.remember(descriptor.key, buffer);
        }
        return buffer;
      })
      .finally(() => {
        if (this.inFlightByKey.get(descriptor.key) === tracked) {
          this.inFlightByKey.delete(descriptor.key);
        }
      });

    this.inFlightByKey.set(descriptor.key, tracked);
    return tracked;
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;

    const disposedError = createDisposedError();
    this.pendingById.forEach(({ reject }) => reject(disposedError));
    this.pendingById.clear();
    this.inFlightByKey.clear();
    this.buffers.clear();
  }

  private requestFromWorker(descriptor: ImpulseDescriptor): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        this.createSynchronously(descriptor).then(resolve, reject);
        return;
      }

      const id = `ir-${++this.requestCounter}`;
      const request: ImpulseWorkerRequest = {
        id,
        seconds: descriptor.seconds,
        mode: descriptor.mode,
        sampleRate: descriptor.sampleRate,
      };

      this.pendingById.set(id, { descriptor, resolve, reject });

      try {
        worker.postMessage(request);
      } catch {
        this.pendingById.delete(id);
        this.disableWorkerAndFallback();
        this.createSynchronously(descriptor).then(resolve, reject);
      }
    });
  }

  private handleWorkerMessage(response: ImpulseWorkerResponse): void {
    const pending = this.pendingById.get(response.id);
    if (!pending) return;

    this.pendingById.delete(response.id);

    if ('error' in response) {
      this.createSynchronously(pending.descriptor).then(pending.resolve, pending.reject);
      return;
    }

    if (
      !(response.left instanceof Float32Array) ||
      !(response.right instanceof Float32Array) ||
      response.left.length === 0 ||
      response.left.length !== response.right.length
    ) {
      this.createSynchronously(pending.descriptor).then(pending.resolve, pending.reject);
      return;
    }

    try {
      const buffer = this.context.createBuffer(
        2,
        response.left.length,
        pending.descriptor.sampleRate,
      );
      buffer.copyToChannel(response.left, 0);
      buffer.copyToChannel(response.right, 1);
      pending.resolve(buffer);
    } catch {
      this.createSynchronously(pending.descriptor).then(pending.resolve, pending.reject);
    }
  }

  private disableWorkerAndFallback(): void {
    this.worker?.terminate();
    this.worker = null;

    const pending = [...this.pendingById.values()];
    this.pendingById.clear();
    pending.forEach(({ descriptor, resolve, reject }) => {
      this.createSynchronously(descriptor).then(resolve, reject);
    });
  }

  private createSynchronously(descriptor: ImpulseDescriptor): Promise<AudioBuffer> {
    if (this.disposed) {
      return Promise.reject(createDisposedError());
    }

    try {
      return Promise.resolve(
        createImpulseResponse(this.context, descriptor.seconds, descriptor.mode),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private remember(key: string, buffer: AudioBuffer): void {
    this.buffers.delete(key);
    this.buffers.set(key, buffer);

    while (this.buffers.size > MAX_IMPULSE_CACHE_ENTRIES) {
      const oldestKey = this.buffers.keys().next().value;
      if (oldestKey === undefined) break;
      this.buffers.delete(oldestKey);
    }
  }
}
