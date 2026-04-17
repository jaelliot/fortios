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
// Reconnection resilience (Phase 2 audit fix):
//   WebKit kills `com.apple.WebKit.Networking` when the iOS app backgrounds,
//   permanently corrupting any held IDBDatabase reference.  Each operation
//   now catches UnknownError / InvalidStateError, closes the stale handle,
//   reopens the database, and retries once.
//   See: WebKit bugs #197050, #273827.

import { IDB_DATABASE_NAME, IDB_DEFAULT_STORE } from './constants';

const STORE_KEY_SEPARATOR = '/';
const PREFIX_SCAN_SENTINEL = '\uffff';

export interface KVEntry {
    key: string;
    value: string;
}

/** Minimal async key-value interface — implemented by IdbKV, mockable in tests. */
export interface WorkerKV {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    del(key: string): Promise<boolean>;
    list(prefix: string): Promise<KVEntry[]>;
    /** Proactively close the underlying connection (called on app background). */
    close(): void;
}

export interface KVFactory {
    (store: string): WorkerKV;
    close(): void;
}

/**
 * Open an IndexedDB-backed KV store.
 *
 * Uses a single object store (`storeName`) inside the database `dbName`.
 * Keys are strings, values are strings.  All operations are single-request
 * transactions — no batching needed for the wallet's access pattern.
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

    /** Open (or reuse) the underlying IDBDatabase handle. */
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
        // Prevent upgrade deadlocks — another tab/context bumping the version
        // should not block indefinitely (MDN: close db on versionchange).
        db.onversionchange = () => {
            db?.close();
            db = null;
        };
        return db;
    }

    // Eagerly connect at construction to fail-fast during boot.
    await connect();

    /**
     * Execute `op` against the current connection.  On a stale-handle
     * DOMException (UnknownError / InvalidStateError — thrown by WebKit
     * after the networking process is killed on background), close the dead
     * handle, reopen, and retry exactly once.
     */
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

    function composeKey(store: string, key: string): string {
        return `${store}${STORE_KEY_SEPARATOR}${key}`;
    }

    function close(): void {
        if (db) {
            db.close();
            db = null;
        }
    }

    function scopedKV(store: string): WorkerKV {
        const existing = cache.get(store);
        if (existing) return existing;

        const storePrefix = `${store}${STORE_KEY_SEPARATOR}`;
        const kv: WorkerKV = {
            get(key: string): Promise<string | null> {
                const fullKey = composeKey(store, key);
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readonly');
                        const req = tx.objectStore(storeName).get(fullKey);
                        req.onsuccess = () => resolve(req.result !== undefined ? (req.result as string) : null);
                        req.onerror = () => reject(new Error(`IDB get failed: ${req.error?.message}`));
                    }),
                );
            },
            set(key: string, value: string): Promise<void> {
                const fullKey = composeKey(store, key);
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readwrite');
                        const req = tx.objectStore(storeName).put(value, fullKey);
                        req.onsuccess = () => resolve();
                        req.onerror = () => reject(new Error(`IDB set failed: ${req.error?.message}`));
                    }),
                );
            },
            del(key: string): Promise<boolean> {
                const fullKey = composeKey(store, key);
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readwrite');
                        const objectStore = tx.objectStore(storeName);
                        const getReq = objectStore.get(fullKey);
                        getReq.onerror = () => reject(new Error(`IDB get failed: ${getReq.error?.message}`));
                        getReq.onsuccess = () => {
                            if (getReq.result === undefined) {
                                resolve(false);
                                return;
                            }

                            const delReq = objectStore.delete(fullKey);
                            delReq.onsuccess = () => resolve(true);
                            delReq.onerror = () => reject(new Error(`IDB del failed: ${delReq.error?.message}`));
                        };
                    }),
                );
            },
            list(prefix: string): Promise<KVEntry[]> {
                const fullPrefix = composeKey(store, prefix);
                const range = IDBKeyRange.bound(fullPrefix, fullPrefix + PREFIX_SCAN_SENTINEL);
                return withRetry((database) =>
                    new Promise((resolve, reject) => {
                        const tx = database.transaction(storeName, 'readonly');
                        const req = tx.objectStore(storeName).openCursor(range);
                        const entries: KVEntry[] = [];

                        req.onsuccess = () => {
                            const cursor = req.result;
                            if (!cursor) {
                                resolve(entries);
                                return;
                            }

                            entries.push({
                                key: String(cursor.key).slice(storePrefix.length),
                                value: cursor.value as string,
                            });
                            cursor.continue();
                        };

                        req.onerror = () => reject(new Error(`IDB list failed: ${req.error?.message}`));
                    }),
                );
            },
            close,
        };

        cache.set(store, kv);
        return kv;
    }

    const factory = ((store: string) => scopedKV(store)) as KVFactory;
    factory.close = close;

    return factory;
}
