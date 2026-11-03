import { emptyData, type BackupData } from '../../shared/backup';

/**
 * The website keeps its whole data set as one document in IndexedDB. Every change is a read-modify-write inside a
 * single readwrite transaction, so two open tabs cannot overwrite each other's changes, and a change that throws
 * is rolled back entirely.
 */
const DB_NAME = 'paymate';
const STORE = 'documents';
const KEY = 'data';

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

export async function readData(): Promise<BackupData> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve({ ...emptyData(), ...(req.result as Partial<BackupData> | undefined) });
    req.onerror = () => reject(req.error);
  });
}

/** Runs `change` on the stored document and saves the result. `change` must be synchronous: the transaction ends when it returns. */
export async function updateData<T>(change: (data: BackupData) => T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    const get = store.get(KEY);
    get.onsuccess = () => {
      try {
        const data: BackupData = { ...emptyData(), ...(get.result as Partial<BackupData> | undefined) };
        result = change(data);
        store.put(data, KEY);
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
  });
}

/** Replaces the whole document. */
export function replaceData(data: BackupData): Promise<void> {
  return updateData((current) => {
    Object.assign(current, data);
  });
}
