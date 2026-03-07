/// <reference lib="webworker" />
//
// worker_router.ts
//
// Pure message dispatch layer — NO importScripts, NO loadPyodide, NO side-effects.
//
// This module is extracted from pyodide_worker.ts to enable unit testing of
// the command routing and Python invocation logic independently from the WASM
// bootstrap. Tests inject a mock PyodideInterface via routeMessage().
//
// Boundary:
//   pyodide_worker.ts — owns boot(), importScripts(), self.onmessage lifecycle
//   worker_router.ts  — owns per-command handlers and the dispatch switch
//   kv.ts             — owns the WorkerKV interface and IndexedDB implementation
//

import type { WorkerKV } from './kv';
import type { PyodideInterface, WorkerInbound, WorkerOutbound } from './types';

// Re-export WorkerKV so existing consumers that import from worker_router still work.
export { openIdbKV } from './kv';
export type { WorkerKV } from './kv';

// ── Per-command handlers ─────────────────────────────────────────────────────

export async function handleBlake3Hash(
    id: string,
    data: string,
    pyodide: PyodideInterface,
): Promise<WorkerOutbound> {
    const hex: string = await pyodide.runPythonAsync(
        `_binascii.hexlify(_blake3.blake3(${JSON.stringify(data)}.encode()).digest()).decode()`,
    );
    return { id, type: 'blake3_result', hex };
}

export async function handleSign(
    id: string,
    message: string,
    pyodide: PyodideInterface,
): Promise<WorkerOutbound> {
    const result = await pyodide.runPythonAsync(`
_msg = ${JSON.stringify(message)}.encode()
_sig = _sodium.crypto_sign_detached(_msg, _sk_bytes)
(_binascii.hexlify(_sig).decode(), _binascii.hexlify(_pk_bytes).decode())
`);
    const [signature, publicKey] = result.toJs
        ? (result.toJs() as [string, string])
        : (result as [string, string]);
    if (result.destroy) result.destroy();
    return { id, type: 'sign_result', signature, publicKey };
}

export async function handleVerify(
    id: string,
    message: string,
    signature: string,
    publicKey: string,
    pyodide: PyodideInterface,
): Promise<WorkerOutbound> {
    const result = await pyodide.runPythonAsync(`
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
    const valid: boolean = result?.toJs ? Boolean(result.toJs()) : Boolean(result);
    if (result?.destroy) result.destroy();
    return { id, type: 'verify_result', valid };
}

// ── IndexedDB handlers (pure JS — no Pyodide) ───────────────────────────────

const IDB_UNAVAILABLE = 'IndexedDB not available (ephemeral mode)';

export async function handleDbSave(
    id: string,
    key: string,
    value: string,
    kv: WorkerKV | null,
): Promise<WorkerOutbound> {
    if (!kv) throw new Error(IDB_UNAVAILABLE);
    await kv.set(key, value);
    return { id, type: 'db_save_result', ok: true };
}

export async function handleDbLoad(
    id: string,
    key: string,
    kv: WorkerKV | null,
): Promise<WorkerOutbound> {
    if (!kv) throw new Error(IDB_UNAVAILABLE);
    const value = await kv.get(key);
    return { id, type: 'db_load_result', value };
}

export async function handleDbDelete(
    id: string,
    key: string,
    kv: WorkerKV | null,
): Promise<WorkerOutbound> {
    if (!kv) throw new Error(IDB_UNAVAILABLE);
    const ok = await kv.del(key);
    return { id, type: 'db_delete_result', ok };
}

// ── Message dispatch ─────────────────────────────────────────────────────────

/**
 * Route a worker command to the appropriate handler.
 *
 * `pyodide` and `booted` are injected by `pyodide_worker.ts` — passing `null`
 * or `false` when the worker is not yet initialised produces an `error` result
 * rather than throwing, so `self.onmessage` never rejects.
 *
 * `kv` is the pure-JS IndexedDB key-value store (or `null` in ephemeral mode).
 *
 * The `init` command is intentionally NOT handled here — it belongs to the
 * boot lifecycle in `pyodide_worker.ts`.
 */
export async function routeMessage(
    cmd: Exclude<WorkerInbound, { type: 'init' }>,
    pyodide: PyodideInterface | null,
    booted: boolean,
    kv: WorkerKV | null = null,
): Promise<WorkerOutbound> {
    if (!booted || pyodide === null) {
        return { id: cmd.id, type: 'error', error: 'worker not initialized' };
    }

    switch (cmd.type) {
        case 'blake3_hash':
            return handleBlake3Hash(cmd.id, cmd.data, pyodide);
        case 'sign':
            return handleSign(cmd.id, cmd.message, pyodide);
        case 'verify':
            return handleVerify(cmd.id, cmd.message, cmd.signature, cmd.publicKey, pyodide);
        case 'db_save':
            return handleDbSave(cmd.id, cmd.key, cmd.value, kv);
        case 'db_load':
            return handleDbLoad(cmd.id, cmd.key, kv);
        case 'db_delete':
            return handleDbDelete(cmd.id, cmd.key, kv);
        default: {
            const exhaustive: never = cmd;
            return {
                id: (exhaustive as WorkerInbound).id,
                type: 'error',
                error: `unknown command: ${(exhaustive as WorkerInbound).type}`,
            };
        }
    }
}
