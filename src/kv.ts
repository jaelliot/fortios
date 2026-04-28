/// <reference lib="webworker" />
//
// kv.ts
//
// Key-Value persistence interface and IndexedDB implementation.
//
// Extracted from worker_router.ts so that:
//   1. Storage is testable and mockable independently of message routing.
//   2. The concrete backend (IndexedDB, SQLite, in-memory) is swappable
//      without touching the router or any handler.
//
// The WorkerKV interface is the contract — consumers depend on it, never
// on the IndexedDB implementation directly.
//
// KVFactory returns store-scoped WorkerKV instances that share a single
// IDBDatabase connection.  Keys are composite: `${store}/${key}`.
//
// Reconnection resilience (Phase 2 audit fix):
//   WebKit kills `com.apple.WebKit.Networking` when the iOS app backgrounds,
//   permanently corrupting any held IDBDatabase reference.  Each operation
//   now catches UnknownError / InvalidStateError, closes the stale handle,
//   reopens the database, and retries once.
//   See: WebKit bugs #197050, #273827.

import { IDB_DATABASE_NAME, IDB_DEFAULT_STORE } from './constants';

/** Minimal async key-value interface — implemented by IdbKV, mockable in tests. */
export interface WorkerKV {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    del(key: string): Promise<boolean>;
    list(prefix: string): Promise<Array<{ key: string; value: string }>>;
    /** Proactively close the underlying connection (called on app background). */
    close(): void;
}

/** Factory that returns store-scoped WorkerKV instances sharing a single IDB connection. */
export interface KVFactory {
    /** Get a store-scoped KV instance. Instances are cached. */
    kv(store: string): WorkerKV;
    /** Close the shared IDB handle (call on app background). */
    close(): void;
}

/**
 * Open an IndexedDB-backed KVFactory.
 *
 * All store-scoped instances share a single IDBDatabase connection and a
 * single object store (`storeName`).  Keys are composite: `${store}/${key}`.
 * Prefix scanning uses `IDBKeyRange.bound` with cursor iteration.
 *
 * The connection is lazily (re-)established: if the held `IDBDatabase`
 * reference is null (closed, or never opened), `connect()` opens a fresh one.
 * Each operation wraps the transaction in `withRetry` — on a stale-connection
 * DOMException the handle is dropped, a new connection is opened, and the
 * operation is retried exactly once.
 */
export async function openIdbKVFactory(
    dbName: string = IDB_DATABASE_NAME,
    storeName: string = IDB_DEFAULT_STORE,
): Promise<KVFactory> {
    let db: IDBDatabase | null = null;
    const cache = new Map<string, WorkerKV>();

    async function connect(): Promise<IDBDatabase> {
        if (db) return db;
        db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = self.indexedDB.open(dbName, 1);
            req.onupgradeneeded = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains(storeName)) {
                    d.createObjectStore(storeName);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(new Error(`IDB open failed: ${req.error?.message}`));
        });
        db.onversionchange = () => {
            db?.close();
            db = null;
        };
        return db;
    }

    // Eagerly connect at construction to fail-fast during boot.
    await connect();

    async function withRetry<T>(op: (database: IDBDatabase) => Promise<T>): Promise<T> {
        try {
            return await op(await connect());
        } catch (e) {
            const name = e instanceof DOMException ? e.name : '';
            if (name === 'UnknownError' || name === 'InvalidStateError') {
                try { db?.close(); } catch { /* already dead */ }
                db = null;
                return await op(await connect());
            }
            throw e;
        }
    }

    function makeStoreKV(store: string): WorkerKV {
        const storePrefix = `${store}/`;

        return {
            get(key: string): Promise<string | null> {
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readonly');
                        const req = tx.objectStore(storeName).get(storePrefix + key);
                        req.onsuccess = () => resolve(req.result ?? null);
                        req.onerror = () => reject(new Error(`IDB get failed: ${req.error?.message}`));
                    }),
                );
            },
            set(key: string, value: string): Promise<void> {
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readwrite');
                        const req = tx.objectStore(storeName).put(value, storePrefix + key);
                        req.onsuccess = () => resolve();
                        req.onerror = () => reject(new Error(`IDB set failed: ${req.error?.message}`));
                    }),
                );
            },
            del(key: string): Promise<boolean> {
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readwrite');
                        const req = tx.objectStore(storeName).delete(storePrefix + key);
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => reject(new Error(`IDB del failed: ${req.error?.message}`));
                    }),
                );
            },
            list(prefix: string): Promise<Array<{ key: string; value: string }>> {
                const fullPrefix = storePrefix + prefix;
                const range = IDBKeyRange.bound(fullPrefix, fullPrefix + '\uffff');
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readonly');
                        const req = tx.objectStore(storeName).openCursor(range);
                        const entries: Array<{ key: string; value: string }> = [];
                        req.onsuccess = () => {
                            const cursor = req.result;
                            if (cursor) {
                                entries.push({
                                    key: (cursor.key as string).slice(storePrefix.length),
                                    value: cursor.value as string,
                                });
                                cursor.continue();
                            } else {
                                resolve(entries);
                            }
                        };
                        req.onerror = () => reject(new Error(`IDB list failed: ${req.error?.message}`));
                    }),
                );
            },
            close(): void {
                if (db) {
                    db.close();
                    db = null;
                }
            },
        };
    }

    return {
        kv(store: string): WorkerKV {
            let instance = cache.get(store);
            if (!instance) {
                instance = makeStoreKV(store);
                cache.set(store, instance);
            }
            return instance;
        },
        close(): void {
            if (db) {
                db.close();
                db = null;
            }
        },
    };
}
