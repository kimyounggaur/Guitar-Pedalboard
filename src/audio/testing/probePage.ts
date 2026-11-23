// probe.html 의 진입점. scripts/audio-render-probe.mjs 가 헤드리스 Chrome 에서 이 페이지를 열고
// window.__probe.run(id, sampleRate) 를 불러 결과를 받아 간다. `--mode test` 빌드에만 들어간다.
import { ImpulseCache } from '../utils/impulseCache';
import { installNodeCounter } from './nodeCounter';
import { createProbeContext, probes, type Metrics, type ProbeContext } from './probes';

export interface ProbeRunResult {
  id: string;
  sampleRate: number;
  title: string;
  metrics: Metrics;
  notes: string[];
  milliseconds: number;
}

const nodeCounter = installNodeCounter();
const sessions = new Map<number, ProbeContext>();

/** 샘플레이트마다 임펄스 응답 캐시를 하나 두고 프로브 전체가 나눠 쓴다(같은 키는 같은 버퍼가 되어 결정적이다). */
function contextFor(sampleRate: number): ProbeContext {
  let session = sessions.get(sampleRate);
  if (!session) {
    const cache = new ImpulseCache(new OfflineAudioContext(1, 1, sampleRate));
    session = createProbeContext(sampleRate, cache, nodeCounter);
    sessions.set(sampleRate, session);
  }
  return session;
}

const api = {
  ready: true,
  userAgent: navigator.userAgent,
  list() {
    return probes.map(({ id, title, describe, steps }) => ({ id, title, describe, steps }));
  },
  async run(id: string, sampleRate: number): Promise<ProbeRunResult> {
    const probe = probes.find((candidate) => candidate.id === id);
    if (!probe) throw new Error(`알 수 없는 프로브입니다: ${id}`);
    const started = performance.now();
    const output = await probe.run(contextFor(sampleRate));
    return {
      id,
      sampleRate,
      title: probe.title,
      metrics: output.metrics,
      notes: output.notes ?? [],
      milliseconds: Math.round(performance.now() - started),
    };
  },
};

declare global {
  interface Window {
    __probe?: typeof api;
  }
}

window.__probe = api;
document.body.textContent = '오디오 렌더 프로브 준비됨';
