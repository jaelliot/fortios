/// <reference lib="webworker" />
//
// pyodide_worker.ts
// Runs Pyodide in a classic Web Worker (IIFE bundle, no ES module imports at runtime).
// Python ops: blake3 hashing, pychloride Ed25519 sign/verify.
//
// Type definitions and constants are imported from shared modules (types.ts, constants.ts)
// and bundled by Vite at build time — the worker runtime uses importScripts only for Pyodide.

import { BLAKE3_WHEEL, PYCHLORIDE_WHEEL, WORKER_LOG_ID } from './constants';
import type { PyodideInterface, WorkerInbound, WorkerOutbound } from './types';
import { routeMessage } from './worker_router';

// loadPyodide is injected into the worker scope at runtime via importScripts.
declare function loadPyodide(opts: { indexURL: string }): Promise<PyodideInterface>;

// Populated on first 'init' message — not constants because blob workers
// have no meaningful self.location.origin.
let pyodideBase = '';
let wheelBase = '';
let pyodide: PyodideInterface | null = null;
let booted = false;

/** Fire-and-forget log message back to main thread (forwarded to bridge). */
function workerLog(msg: string): void {
    self.postMessage({ id: WORKER_LOG_ID, type: 'log', message: `[worker] ${msg}` } satisfies WorkerOutbound);
}

/**
 * Fetch a wheel via JavaScript fetch() (works with app:// scheme handler)
 * and unpack it directly into Pyodide's site-packages using unpackArchive.
 * No micropip URL parsing involved.
 */
async function installWheel(url: string): Promise<void> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`wheel fetch failed: ${url} (${resp.status})`);
    const buffer = await resp.arrayBuffer();
    (pyodide as any).unpackArchive(buffer, 'wheel');
}

async function boot(origin: string): Promise<void> {
    pyodideBase = `${origin}/pyodide/`;
    wheelBase = `${origin}/pyodide/wheels/`;

    // importScripts is synchronous — injects loadPyodide() into the worker scope.
    workerLog('loading pyodide.js');
    self.importScripts(`${pyodideBase}pyodide.js`);

    workerLog('initializing pyodide runtime');
    pyodide = await loadPyodide({ indexURL: pyodideBase });

    // Wheels are bundled offline in public/pyodide/wheels/ — no CDN.
    // The download script gives pychloride a stable filename: pychloride.whl
    const blake3Url = `${wheelBase}${BLAKE3_WHEEL}`;
    const pychlorideUrl = `${wheelBase}${PYCHLORIDE_WHEEL}`;

    // Fetch wheels via JS fetch() (works with app:// scheme handler) and
    // unpack directly into site-packages using pyodide.unpackArchive().
    // This bypasses micropip entirely — no URL parsing, no network resolution.
    workerLog('fetching + unpacking wheels');
    await Promise.all([
        installWheel(blake3Url),
        installWheel(pychlorideUrl),
    ]);

    // Pre-import and generate a persistent Ed25519 session keypair.
    workerLog('importing crypto modules + generating session keypair');
    await pyodide.runPythonAsync(`
import blake3 as _blake3
import pychloride as _sodium
import binascii as _binascii

_kp = _sodium.crypto_sign_keypair()
_pk_bytes = _kp[0]   # public key  (32 bytes)
_sk_bytes = _kp[1]   # secret key  (64 bytes)
`);

    booted = true;
    workerLog('boot complete');
}

self.onmessage = async (ev: MessageEvent<WorkerInbound>) => {
    const cmd = ev.data;
    let out: WorkerOutbound;
    try {
        if (cmd.type === 'init') {
            await boot(cmd.origin);
            out = { id: cmd.id, type: 'ready' };
        } else {
            out = await routeMessage(cmd, pyodide, booted);
        }
    } catch (e) {
        out = { id: cmd.id, type: 'error', error: String(e) };
    }
    self.postMessage(out);
};
