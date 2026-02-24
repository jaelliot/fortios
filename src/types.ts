// ── Shared type definitions for the JS ↔ Worker ↔ Swift bridge ────────────────
//
// Single source of truth. Both main.ts and pyodide_worker.ts import from here,
// eliminating the previous copy-paste duplication.
//
// Message protocol (all carry `id: string` for correlation):
//   IN  → Worker: init, blake3_hash, sign, verify
//   OUT ← Worker: ready, blake3_result, sign_result, verify_result, error, log
//   Bridge → Swift: js_error, unhandled_rejection, log, lifecycle, crypto_result

// ── Worker inbound (main → worker) ───────────────────────────────────────────
export type WorkerInbound =
    | { id: string; type: 'init'; origin: string }
    | { id: string; type: 'blake3_hash'; data: string }
    | { id: string; type: 'sign'; message: string }
    | { id: string; type: 'verify'; message: string; signature: string; publicKey: string };

// ── Worker outbound (worker → main) ──────────────────────────────────────────
export type WorkerOutbound =
    | { id: string; type: 'ready' }
    | { id: string; type: 'blake3_result'; hex: string }
    | { id: string; type: 'sign_result'; signature: string; publicKey: string }
    | { id: string; type: 'verify_result'; valid: boolean }
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

// ── Native command (Swift → JS via evaluateJavaScript) ───────────────────────
export interface NativeCommand {
    id: string;
    type: string;
    [key: string]: unknown;
}
