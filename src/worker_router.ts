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
//

import type { PyodideInterface, WorkerInbound, WorkerOutbound } from './types';

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

// ── Message dispatch ─────────────────────────────────────────────────────────

/**
 * Route a worker command to the appropriate handler.
 *
 * `pyodide` and `booted` are injected by `pyodide_worker.ts` — passing `null`
 * or `false` when the worker is not yet initialised produces an `error` result
 * rather than throwing, so `self.onmessage` never rejects.
 *
 * The `init` command is intentionally NOT handled here — it belongs to the
 * boot lifecycle in `pyodide_worker.ts`.
 */
export async function routeMessage(
    cmd: Exclude<WorkerInbound, { type: 'init' }>,
    pyodide: PyodideInterface | null,
    booted: boolean,
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
