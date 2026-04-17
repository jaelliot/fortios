// ── Shared type definitions for the JS ↔ Worker ↔ Swift bridge ────────────────
//
// Single source of truth. Both main.ts and pyodide_worker.ts import from here,
// eliminating the previous copy-paste duplication.
//
// Message protocol (all carry `id: string` for correlation):
//   IN  → Worker: init, blake3_hash, sign, verify, db_put, db_get, db_del, db_list
//   OUT ← Worker: ready, blake3_result, sign_result, verify_result, db_* results, error, log
//   Bridge → Swift: js_error, unhandled_rejection, log, lifecycle, crypto_result

// ── Worker inbound (main → worker) ───────────────────────────────────────────
export type WorkerInbound =
    | { id: string; type: 'init'; origin: string }
    | { id: string; type: 'blake3_hash'; data: string }
    | { id: string; type: 'sign'; message: string }
    | { id: string; type: 'verify'; message: string; signature: string; publicKey: string }
    | { id: string; type: 'db_put'; store: string; key: string; value: string }
    | { id: string; type: 'db_get'; store: string; key: string }
    | { id: string; type: 'db_del'; store: string; key: string }
    | { id: string; type: 'db_list'; store: string; prefix: string }
    | { id: string; type: 'visibility_change'; hidden: boolean };

// ── Worker outbound (worker → main) ──────────────────────────────────────────
export type WorkerOutbound =
    | { id: string; type: 'ready' }
    | { id: string; type: 'blake3_result'; hex: string }
    | { id: string; type: 'sign_result'; signature: string; publicKey: string }
    | { id: string; type: 'verify_result'; valid: boolean }
    | { id: string; type: 'db_put_result'; ok: boolean }
    | { id: string; type: 'db_get_result'; value: string | null }
    | { id: string; type: 'db_del_result'; ok: boolean }
    | { id: string; type: 'db_list_result'; entries: Array<{ key: string; value: string }> }
    | { id: string; type: 'error'; error: string }
    | { id: string; type: 'log'; message: string };

// ── Bridge envelope (JS → Swift via webkit.messageHandlers) ──────────────────
export type BridgeEnvelope =
    | { type: 'js_error'; timestamp: string; message: string; stack?: string; source?: string; line?: number; col?: number }
    | { type: 'unhandled_rejection'; timestamp: string; message: string; stack?: string }
    | { type: 'log'; timestamp: string; message: string }
    | { type: 'lifecycle'; timestamp: string; message: string }
    | { type: 'crypto_result'; timestamp: string; id: string; message: string; error?: string };

// ── Pyodide interface (minimal subset used by the worker) ────────────────────
export interface PyodideInterface {
    loadPackage(pkgs: string[]): Promise<void>;
    pyimport(name: string): any;
    runPythonAsync(code: string): Promise<any>;
    unpackArchive(buffer: ArrayBuffer, format: string, options?: { extractDir?: string }): void;
}

// ── Bridge adapter (platform-specific transport for JS → native messages) ────
/**
 * Abstraction over the native bridge transport.
 *
 * - **iOS:** Uses `window.webkit.messageHandlers` (WKWebView).
 * - **Android:** Uses `window[BRIDGE_HANDLER_NAME].postMessage()` via the host-provided secure bridge object.
 * - **Test/fallback:** No-op (messages are silently dropped).
 *
 * Injected at boot time via `initBridge()` in main.ts.
 */
export interface BridgeAdapter {
    postMessage(payload: BridgeEnvelope): void;
}

// ── Native command (Swift/Android → JS via evaluateJavaScript) ───────────────
export interface NativeCommand {
    id: string;
    type: string;
    [key: string]: unknown;
}
