// Docs: docs/04 - Architecture/Data Model.md
// Purpose: one key-value store on the device, on IndexedDB.
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export function memoryStore(): Store {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
    keys: async (p) => [...m.keys()].filter((k) => k.startsWith(p)),
  };
}

export function idbStore(name = 'dholphin-v2'): Store {
  // The first database held made-up test titles. Nothing in it is worth keeping.
  indexedDB.deleteDatabase('dholphin');
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open;
    return new Promise<T>((resolve, reject) => {
      const q = fn(db.transaction('kv', mode).objectStore('kv'));
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  };
  return {
    get: <T>(k: string) => run<T>('readonly', (s) => s.get(k) as IDBRequest<T>).then((v) => v ?? undefined),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)).then(() => undefined),
    del: (k) => run('readwrite', (s) => s.delete(k)).then(() => undefined),
    keys: (p) => run('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(p, p + '￿'))).then((ks) => ks as string[]),
  };
}

/** Values that expire. */
export async function cached<T>(store: Store, key: string, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await store.get<{ at: number; v: T }>(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.v;
  try {
    const v = await load();
    await store.set(key, { at: Date.now(), v });
    return v;
  } catch (e) {
    if (hit) return hit.v; // Old data beats an error.
    throw e;
  }
}

/** Keys that belong to the household and live on a Dholphin server: profiles, accounts, history, list, ratings, keys. */
export const HOUSEHOLD = /^(profiles|setupDone|keys)$|^(prov|p):/;

/**
 * The household's data on a Dholphin server. Everything is read once at start (`load`) and kept in memory, with a copy
 * on the device so it still opens when the server can't be reached; a change is sent at once, and sent again later
 * if the server didn't take it. Docs: Server (store API).
 */
export async function serverStore(base: string, local: Store, fetcher: typeof fetch = fetch): Promise<Store & { pending(): number }> {
  const mem = new Map<string, unknown>();
  const copy = 'server:'; // The device's copy, in the local store.
  try {
    const r = await fetcher(`${base}?prefix=`);
    if (!r.ok) throw new Error(`The server answered ${r.status}`);
    const all = (await r.json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(all)) mem.set(k, v);
    for (const k of await local.keys(copy)) if (!(k.slice(copy.length) in all)) await local.del(k);
    await Promise.all(Object.entries(all).map(([k, v]) => local.set(copy + k, v)));
  } catch {
    for (const k of await local.keys(copy)) mem.set(k.slice(copy.length), await local.get(k));
  }
  // Changes not yet taken by the server, by key: the last one wins, and they are sent again every 20 seconds.
  const queue = new Map<string, { del: boolean; v?: unknown }>();
  const send = async (k: string) => {
    const c = queue.get(k);
    if (!c) return;
    try {
      const r = await fetcher(`${base}/${encodeURIComponent(k)}`, c.del ? { method: 'DELETE' } : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: c.v }) });
      if (r.ok && queue.get(k) === c) queue.delete(k);
    } catch { /* kept for the next try */ }
  };
  setInterval(() => queue.forEach((_, k) => void send(k)), 20_000);
  return {
    get: async <T>(k: string) => mem.get(k) as T | undefined,
    set: async (k, v) => {
      mem.set(k, v);
      await local.set(copy + k, v);
      queue.set(k, { del: false, v });
      void send(k);
    },
    del: async (k) => {
      mem.delete(k);
      await local.del(copy + k);
      queue.set(k, { del: true });
      void send(k);
    },
    keys: async (p) => [...mem.keys()].filter((k) => k.startsWith(p)),
    pending: () => queue.size,
  };
}

/** One store for the app: the household's keys go to `household`, everything else (caches, this device) to `device`. */
export function routedStore(device: Store, household: Store): Store {
  const pick = (k: string) => (HOUSEHOLD.test(k) ? household : device);
  return {
    get: (k) => pick(k).get(k),
    set: (k, v) => pick(k).set(k, v),
    del: (k) => pick(k).del(k),
    keys: async (p) => [...new Set([...(await device.keys(p)).filter((k) => !HOUSEHOLD.test(k)), ...(await household.keys(p)).filter((k) => HOUSEHOLD.test(k))])],
  };
}
