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

async function handleBlake3Hash(id: string, data: string): Promise<WorkerOutbound> {
    const hex: string = await pyodide!.runPythonAsync(
        `_binascii.hexlify(_blake3.blake3(${JSON.stringify(data)}.encode()).digest()).decode()`,
    );
    return { id, type: 'blake3_result', hex };
}

async function handleSign(id: string, message: string): Promise<WorkerOutbound> {
    const result = await pyodide!.runPythonAsync(`
_msg = ${JSON.stringify(message)}.encode()
_sig = _sodium.crypto_sign_detached(_msg, _sk_bytes)
(_binascii.hexlify(_sig).decode(), _binascii.hexlify(_pk_bytes).decode())
`);
    // Pyodide returns a Python tuple — convert to JS array.
    const [signature, publicKey] = result.toJs
        ? (result.toJs() as [string, string])
        : (result as [string, string]);
    if (result.destroy) result.destroy();
    return { id, type: 'sign_result', signature, publicKey };
}

async function handleVerify(
    id: string,
    message: string,
    signature: string,
    publicKey: string,
): Promise<WorkerOutbound> {
    const result = await pyodide!.runPythonAsync(`
try:
    _sodium.crypto_sign_verify_detached(
        _binascii.unhexlify(${JSON.stringify(signature)}),
        ${JSON.stringify(message)}.encode(),
        _binascii.unhexlify(${JSON.stringify(publicKey)}),
    )
    _vresult = True
except Exception:
    _vresult = False
_vresult
`);
    // Pyodide may return a PyProxy wrapping the Python bool rather than a native
    // JS boolean — same issue as handleSign. Explicitly extract via .toJs() and
    // release the proxy to avoid postMessage serialisation failures.
    const valid: boolean = result?.toJs ? Boolean(result.toJs()) : Boolean(result);
    if (result?.destroy) result.destroy();
    return { id, type: 'verify_result', valid };
}

self.onmessage = async (ev: MessageEvent<WorkerInbound>) => {
    const cmd = ev.data;
    let out: WorkerOutbound;
    try {
        switch (cmd.type) {
            case 'init':
                await boot(cmd.origin);
                out = { id: cmd.id, type: 'ready' };
                break;
            case 'blake3_hash':
                if (!booted) { out = { id: cmd.id, type: 'error', error: 'worker not initialized' }; break; }
                out = await handleBlake3Hash(cmd.id, cmd.data);
                break;
            case 'sign':
                if (!booted) { out = { id: cmd.id, type: 'error', error: 'worker not initialized' }; break; }
                out = await handleSign(cmd.id, cmd.message);
                break;
            case 'verify':
                if (!booted) { out = { id: cmd.id, type: 'error', error: 'worker not initialized' }; break; }
                out = await handleVerify(cmd.id, cmd.message, cmd.signature, cmd.publicKey);
                break;
            default: {
                const exhaustive: never = cmd;
                out = { id: (exhaustive as { id: string }).id, type: 'error', error: 'unknown command' };
            }
        }
    } catch (e) {
        out = { id: cmd.id, type: 'error', error: String(e) };
    }
    self.postMessage(out);
};
