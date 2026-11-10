// IndexedDB: the patrol session and its photos survive reloads and iOS tab eviction.

export interface PatrolSession {
  date: string;      // YYYY-MM-DD
  start: string;     // HH:mm
  end: string;       // HH:mm
  size: number;      // output px, 0 = camera maximum
  autoShare: boolean;
}

/** One photo. `time` is the Korean wall-clock moment the shutter was pressed (ms). */
export interface Shot { id: number; time: number; blob: Blob; thumb: Blob }

const DB = 'patrol-camera';
let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('meta');
      req.result.createObjectStore('shots', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('저장 공간이 부족합니다.'));
  });
}

export const loadSession = () => tx<PatrolSession | undefined>('meta', 'readonly', (s) => s.get('session'));
export const saveSession = (v: PatrolSession) => tx('meta', 'readwrite', (s) => { s.put(v, 'session'); });
export const loadShots = () => tx<Shot[]>('shots', 'readonly', (s) => s.getAll());
export const saveShot = (v: Shot) => tx('shots', 'readwrite', (s) => { s.put(v); });
export const deleteShot = (id: number) => tx('shots', 'readwrite', (s) => { s.delete(id); });

export async function clearPatrol() {
  await tx('shots', 'readwrite', (s) => { s.clear(); });
  await tx('meta', 'readwrite', (s) => { s.delete('session'); });
}

/** Ask Safari not to evict stored photos under storage pressure. */
export function persist() {
  navigator.storage?.persist?.().catch(() => {});
}
