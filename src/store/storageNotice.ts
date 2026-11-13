/** Notify the interface without interrupting in-memory changes when persistence fails. */
export const STORAGE_FAILURE_EVENT = 'pedalboard-storage-failure';
export function notifyStorageFailure(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FAILURE_EVENT));
}
