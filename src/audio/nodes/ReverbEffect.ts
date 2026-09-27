import { BaseEffect } from './BaseEffect';
import type { PedalState, ReverbParams } from '../types';
import {
  ImpulseCache,
  type ImpulseDescriptor,
} from '../utils/impulseCache';
import { rampParam, smoothParam } from '../utils/smoothing';

const IMPULSE_DEBOUNCE_MS = 180;
const IMPULSE_SWAP_FADE_SECONDS = 0.008;

interface PendingSwap {
  buffer: AudioBuffer;
  key: string;
  revision: number;
}

export class ReverbEffect extends BaseEffect {
  private readonly preDelay: DelayNode;
  private readonly convolver: ConvolverNode;
  private readonly lowCut: BiquadFilterNode;
  private readonly highCut: BiquadFilterNode;
  private debounceTimer: number | null = null;
  private swapTimer: number | null = null;
  private desiredKey: string | null = null;
  private appliedKey: string | null = null;
  private requestRevision = 0;
  private disposed = false;
  private pendingSwap: PendingSwap | null = null;

  constructor(
    context: AudioContext,
    pedal: PedalState,
    private readonly impulseCache: ImpulseCache,
  ) {
    super(context, pedal);
    this.preDelay = context.createDelay(0.25);
    this.convolver = context.createConvolver();
    this.lowCut = context.createBiquadFilter();
    this.highCut = context.createBiquadFilter();

    this.lowCut.type = 'highpass';
    this.highCut.type = 'lowpass';

    this.effectInput.connect(this.preDelay);
    this.preDelay.connect(this.convolver);
    this.convolver.connect(this.lowCut);
    this.lowCut.connect(this.highCut);
    this.highCut.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    const params = pedal.params as ReverbParams;
    super.update(pedal);

    smoothParam(this.preDelay.delayTime, params.preDelay / 1000, this.context);
    smoothParam(this.lowCut.frequency, params.lowCut, this.context);
    smoothParam(this.highCut.frequency, params.highCut, this.context);

    const descriptor = this.impulseCache.describe(params.mode, params.decay);
    if (descriptor.key === this.desiredKey) {
      if (this.pendingSwap) {
        this.armPendingSwap();
      }
      return;
    }

    this.selectImpulse(descriptor);
  }

  override dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.requestRevision += 1;
    this.clearDebounceTimer();
    this.clearSwapTimer();
    this.pendingSwap = null;
    this.preDelay.disconnect();
    this.convolver.disconnect();
    this.lowCut.disconnect();
    this.highCut.disconnect();
    super.dispose();
  }

  private selectImpulse(descriptor: ImpulseDescriptor): void {
    this.desiredKey = descriptor.key;
    const revision = ++this.requestRevision;

    this.clearDebounceTimer();
    this.cancelPendingSwap();

    if (descriptor.key === this.appliedKey) return;

    const cached = this.impulseCache.getCached(descriptor);
    if (cached) {
      this.queueSwap(cached, descriptor.key, revision);
      return;
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.impulseCache.request(descriptor).then(
        (buffer) => {
          if (this.isCurrentRequest(descriptor.key, revision)) {
            this.queueSwap(buffer, descriptor.key, revision);
          }
        },
        () => {
          if (this.isCurrentRequest(descriptor.key, revision)) {
            this.desiredKey = null;
          }
        },
      );
    }, IMPULSE_DEBOUNCE_MS);
  }

  private queueSwap(buffer: AudioBuffer, key: string, revision: number): void {
    if (!this.isCurrentRequest(key, revision)) return;

    this.pendingSwap = { buffer, key, revision };
    this.armPendingSwap();
  }

  private armPendingSwap(): void {
    const swap = this.pendingSwap;
    if (!swap || this.disposed) return;

    this.clearSwapTimer();
    rampParam(this.wetGain.gain, 0, this.context, IMPULSE_SWAP_FADE_SECONDS);
    this.swapTimer = window.setTimeout(() => {
      this.swapTimer = null;

      if (
        this.pendingSwap !== swap ||
        !this.isCurrentRequest(swap.key, swap.revision)
      ) {
        if (this.pendingSwap === swap) {
          this.pendingSwap = null;
          rampParam(
            this.wetGain.gain,
            this.getWetTarget(),
            this.context,
            IMPULSE_SWAP_FADE_SECONDS,
          );
        }
        return;
      }

      this.convolver.buffer = swap.buffer;
      this.appliedKey = swap.key;
      this.pendingSwap = null;
      rampParam(
        this.wetGain.gain,
        this.getWetTarget(),
        this.context,
        IMPULSE_SWAP_FADE_SECONDS,
      );
    }, IMPULSE_SWAP_FADE_SECONDS * 1000);
  }

  private isCurrentRequest(key: string, revision: number): boolean {
    return (
      !this.disposed &&
      this.desiredKey === key &&
      this.requestRevision === revision
    );
  }

  private cancelPendingSwap(): void {
    const hadPendingSwap = this.pendingSwap !== null || this.swapTimer !== null;
    this.clearSwapTimer();
    this.pendingSwap = null;

    if (hadPendingSwap && !this.disposed) {
      rampParam(
        this.wetGain.gain,
        this.getWetTarget(),
        this.context,
        IMPULSE_SWAP_FADE_SECONDS,
      );
    }
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer === null) return;
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private clearSwapTimer(): void {
    if (this.swapTimer === null) return;
    window.clearTimeout(this.swapTimer);
    this.swapTimer = null;
  }
}
