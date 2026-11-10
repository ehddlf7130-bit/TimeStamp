// IndexedDB: the patrol session and its photos survive reloads and iOS tab eviction.

export interface PatrolSession {
  date: string;      // YYYY-MM-DD
  start: string;     // HH:mm
  end: string;       // HH:mm
  size: number;      // output px, 0 = camera maximum
  autoShare: boolean;
  nextSlot?: number; // next planned slot; optional for sessions saved by the old version
  resolutionVersion?: 1; // distinguishes the old 1080 default from an explicit new choice
}

/** New shots use the planned time; legacy shots have no slotIndex and keep their original time. */
export interface Shot { id: number; time: number; slotIndex?: number; blob: Blob; thumb: Blob }

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
export const deleteShot = (id: number) => tx('shots', 'readwrite', (s) => { s.delete(id); });

/** Photos and progress must commit together, including when storage is full. */
async function writePatrol(action: (t: IDBTransaction) => void): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['shots', 'meta'], 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('저장 공간이 부족합니다.'));
    try { action(t); } catch (e) { t.abort(); reject(e); }
  });
}

export const saveCapture = (shot: Shot, session: PatrolSession) => writePatrol((t) => {
  t.objectStore('shots').put(shot);
  t.objectStore('meta').put(session, 'session');
});

export const startPatrol = (session: PatrolSession) => writePatrol((t) => {
  t.objectStore('shots').clear();
  t.objectStore('meta').put(session, 'session');
});

export function clearPatrol() {
  return writePatrol((t) => {
    t.objectStore('shots').clear();
    t.objectStore('meta').delete('session');
  });
}

/** Ask Safari not to evict stored photos under storage pressure. */
export function persist() {
  navigator.storage?.persist?.().catch(() => {});
}
