// 프리셋 id 를 만든다(S2.4 선행 이동: `presetStore.ts` 에서 옮겼다. 내용은 그대로).
export function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
