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
import type { WorkerKV } from './worker_router';
import { openIdbKV, routeMessage } from './worker_router';

// loadPyodide is injected into the worker scope at runtime via importScripts.
declare function loadPyodide(opts: { indexURL: string }): Promise<PyodideInterface>;

// Populated on first 'init' message — not constants because blob workers
// have no meaningful self.location.origin.
let pyodideBase = '';
let wheelBase = '';
let pythonBase = '';
let pyodide: PyodideInterface | null = null;
let kv: WorkerKV | null = null;
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

/**
 * Fetch a Python source file and write it into Pyodide's virtual filesystem
 * at the given import path (relative to site-packages or cwd).
 */
async function installPythonFile(url: string, destPath: string): Promise<void> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`python file fetch failed: ${url} (${resp.status})`);
    const text = await resp.text();
    (pyodide as any).FS.writeFile(destPath, text);
}

async function boot(origin: string): Promise<void> {
    pyodideBase = `${origin}/pyodide/`;
    wheelBase = `${origin}/pyodide/wheels/`;
    pythonBase = `${origin}/python/`;

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

    // Install Python shim modules (pysodium compat, lmdb stub, IndexedDB backend)
    workerLog('installing python shims + IndexedDB backend');
    await Promise.all([
        installPythonFile(`${pythonBase}pysodium.py`, '/home/pyodide/pysodium.py'),
        installPythonFile(`${pythonBase}lmdb.py`, '/home/pyodide/lmdb.py'),
        installPythonFile(`${pythonBase}indexeddb_python.py`, '/home/pyodide/indexeddb_python.py'),
    ]);

    // Install hio subset (required for keripy imports: doing, decking, ogling, etc.)
    // The file list is driven by hio-manifest.json — generated at build time by
    // build-payload.sh so the build script is the single source of truth.
    workerLog('installing hio subset');
    const hioBase = `${pythonBase}hio/`;
    const hioRoot = '/home/pyodide/hio';

    const manifestResp = await fetch(`${pythonBase}hio-manifest.json`);
    if (!manifestResp.ok) throw new Error(`hio-manifest.json fetch failed (${manifestResp.status})`);
    const manifest: { dirs: string[]; files: string[] } = await manifestResp.json();

    // Create directory tree first (manifest dirs are relative to hio/).
    (pyodide as any).FS.mkdirTree(hioRoot);
    for (const dir of manifest.dirs) {
        (pyodide as any).FS.mkdirTree(`${hioRoot}/${dir}`);
    }

    await Promise.all(
        manifest.files.map((relPath) =>
            installPythonFile(`${hioBase}${relPath}`, `${hioRoot}/${relPath}`),
        ),
    );
    workerLog(`hio subset installed (${manifest.files.length} files)`);

    // NOTE: micropip is intentionally NOT loaded here.
    // The bundled app runs under `app://` with no network access to PyPI.
    // micropip.install() would fail even if the micropip wheel were bundled.
    // When keripy deps are needed, bundle them as wheels and use installWheel()
    // via the same unpackArchive pattern used for blake3/pychloride.

    // ── Persistence: pure-JS IndexedDB ──────────────────────────────────
    // Pyodide's create_proxy callbacks don't fire in WKWebView blob: Workers,
    // so Python↔IDB is broken.  Instead we open a plain JS IndexedDB store
    // and handle db_save / db_load / db_delete entirely in JavaScript.
    workerLog('opening JS-level IndexedDB');
    try {
        kv = await openIdbKV();
        workerLog('IndexedDB ready (JS-level persistence)');
    } catch (e) {
        workerLog(`IndexedDB open failed — ephemeral mode: ${e}`);
        kv = null;
    }

    // Pre-import crypto modules.
    workerLog('importing crypto modules');
    await pyodide.runPythonAsync(`
import blake3 as _blake3
import pychloride as _sodium
import binascii as _binascii
import json as _json
`);

    // Generate ephemeral Ed25519 session keypair (not persisted across launches).
    workerLog('generating ephemeral session keypair');
    await pyodide.runPythonAsync(`
_kp = _sodium.crypto_sign_keypair()
_pk_bytes = _kp[0]
_sk_bytes = _kp[1]
`);

    booted = true;
    workerLog(`boot complete — crypto ready, persistence: ${kv ? 'IndexedDB' : 'ephemeral'}`);
}

self.onmessage = async (ev: MessageEvent<WorkerInbound>) => {
    const cmd = ev.data;
    let out: WorkerOutbound;
    try {
        if (cmd.type === 'init') {
            await boot(cmd.origin);
            out = { id: cmd.id, type: 'ready' };
        } else {
            out = await routeMessage(cmd, pyodide, booted, kv);
        }
    } catch (e) {
        out = { id: cmd.id, type: 'error', error: String(e) };
    }
    self.postMessage(out);
};
