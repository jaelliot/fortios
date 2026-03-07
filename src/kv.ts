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

import { IDB_DATABASE_NAME, IDB_DEFAULT_STORE } from './constants';

/** Minimal async key-value interface — implemented by IdbKV, mockable in tests. */
export interface WorkerKV {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    del(key: string): Promise<boolean>;
}

/**
 * Open an IndexedDB-backed KV store.
 *
 * Uses a single object store (`storeName`) inside the database `dbName`.
 * Keys are strings, values are strings.  All operations are single-request
 * transactions — no batching needed for the wallet's access pattern.
 */
export async function openIdbKV(
    dbName: string = IDB_DATABASE_NAME,
    storeName: string = IDB_DEFAULT_STORE,
): Promise<WorkerKV> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
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

    return {
        async get(key: string): Promise<string | null> {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).get(key);
                req.onsuccess = () => resolve(req.result !== undefined ? String(req.result) : null);
                req.onerror = () => reject(new Error(`IDB get failed: ${req.error?.message}`));
            });
        },
        async set(key: string, value: string): Promise<void> {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const req = tx.objectStore(storeName).put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(new Error(`IDB set failed: ${req.error?.message}`));
            });
        },
        async del(key: string): Promise<boolean> {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                // Check existence first, then delete
                const getReq = store.get(key);
                getReq.onsuccess = () => {
                    const existed = getReq.result !== undefined;
                    const delReq = store.delete(key);
                    delReq.onsuccess = () => resolve(existed);
                    delReq.onerror = () => reject(new Error(`IDB del failed: ${delReq.error?.message}`));
                };
                getReq.onerror = () => reject(new Error(`IDB del/get failed: ${getReq.error?.message}`));
            });
        },
    };
}
