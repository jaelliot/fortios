// ── keri_runtime.ts ──────────────────────────────────────────────────────────
//
// Worker lifecycle, native bridge plumbing, and global error hooks.
//
// This module owns the Pyodide Web Worker instance, the pending-request map,
// and the Swift ↔ JS command channel.  It is intentionally free of DOM
// manipulation and demo-specific logic — those belong in main.ts.

import { createBridgeAdapter } from './bridge_adapter';
import { WORKER_ID_PREFIX } from './constants';
import PyodideWorker from './pyodide_worker?worker';
import type { BridgeAdapter, BridgeEnvelope, NativeCommand, WorkerInbound, WorkerOutbound } from './types';

// ── Bridge adapter (platform-agnostic) ────────────────────────────────────────
const bridge: BridgeAdapter = createBridgeAdapter();

export function postToBridge(payload: BridgeEnvelope): void {
    try { bridge.postMessage(payload); } catch { /* best-effort */ }
}

// ── Timestamp helper ──────────────────────────────────────────────────────────
export function isoNow(): string {
    return new Date().toISOString();
}

// ── Global error hooks ────────────────────────────────────────────────────────
export function installGlobalErrorHooks(): void {
    window.addEventListener('error', (ev: ErrorEvent) => {
        postToBridge({
            type: 'js_error',
            timestamp: isoNow(),
            message: ev.message ?? 'unknown error',
            stack: ev.error instanceof Error ? ev.error.stack : undefined,
            source: ev.filename,
            line: ev.lineno,
            col: ev.colno,
        });
    });

    window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
        const reason = ev.reason;
        postToBridge({
            type: 'unhandled_rejection',
            timestamp: isoNow(),
            message: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
            stack: reason instanceof Error ? reason.stack : undefined,
        });
    });
}

// ── Worker management ─────────────────────────────────────────────────────────
let worker: InstanceType<typeof PyodideWorker> | null = null;

type PendingEntry = { resolve: (v: WorkerOutbound) => void; reject: (e: Error) => void };
const pending = new Map<string, PendingEntry>();

let _idCounter = 0;
export function generateId(): string {
    return `${WORKER_ID_PREFIX}${Date.now()}-${++_idCounter}`;
}

/** Callback invoked for every uncorrelated worker log message (type 'log'). */
export type WorkerLogCallback = (message: string) => void;

let _logCallback: WorkerLogCallback | null = null;

/** Register a callback to receive worker log messages. */
export function onWorkerLog(cb: WorkerLogCallback): void {
    _logCallback = cb;
}

export function sendToWorker(cmd: WorkerInbound): Promise<WorkerOutbound> {
    return new Promise((resolve, reject) => {
        pending.set(cmd.id, { resolve, reject });
        worker!.postMessage(cmd);
    });
}

export async function initPyodide(): Promise<void> {
    worker = new PyodideWorker();

    worker.onerror = (ev: ErrorEvent) => {
        _logCallback?.(`[worker error] ${ev.message}`);
        for (const [id, entry] of pending) {
            pending.delete(id);
            entry.reject(new Error(ev.message));
        }
    };

    worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
        const result = ev.data;

        // Forward worker log messages to bridge + callback (not correlated to pending ops).
        if (result.type === 'log') {
            _logCallback?.(result.message);
            postToBridge({ type: 'log', timestamp: isoNow(), message: result.message });
            return;
        }

        const entry = pending.get(result.id);
        if (!entry) return;
        pending.delete(result.id);
        entry.resolve(result);
    };

    // Pass window.location.origin so the worker knows the app:// scheme base.
    // Vite inlines workers as blob: URLs — self.location.origin is 'null' there.
    const id = generateId();
    const result = await sendToWorker({ id, type: 'init', origin: window.location.origin });
    if (result.type === 'error') {
        throw new Error(`Pyodide boot failed: ${result.error}`);
    }
}

// ── Native command handler (called by Swift via evaluateJavaScript) ───────────

// Swift calls: window.handleNativeCommand({id, type, ...})
// Must NOT be async — WKWebView's evaluateJavaScript cannot serialize a Promise
// (triggers WKErrorDomain Code=5). Wrap async body in a void IIFE instead.
export function installNativeCommandHandler(): void {
    (window as unknown as { handleNativeCommand: (cmd: NativeCommand) => void }).handleNativeCommand =
        (cmd: NativeCommand) => {
            void (async () => {
                let message = '';
                let error: string | undefined;
                try {
                    const result = await sendToWorker(cmd as unknown as WorkerInbound);
                    message = JSON.stringify(result);
                } catch (e) {
                    error = String(e);
                }
                postToBridge({ type: 'crypto_result', timestamp: isoNow(), id: cmd.id, message, error });
            })();
        };
}
