import { BRIDGE_HANDLER_NAME, LOADING_FADE_MS, PROOF_CHALLENGE, WORKER_ID_PREFIX } from './constants';
import PyodideWorker from './pyodide_worker?worker';
import type { BridgeAdapter, BridgeEnvelope, NativeCommand, WorkerInbound, WorkerOutbound } from './types';
import { createBridgeAdapter } from './bridge_adapter';

// ── DOM helpers ───────────────────────────────────────────────────────────────
const loadingEl = document.getElementById('loading');
const loadingStatusEl = document.getElementById('loading-status');
const appEl = document.getElementById('app');
const statusEl = document.getElementById('status');
const statusDotEl = document.getElementById('status-dot');
const outputEl = document.getElementById('output');

// Profile form elements (IndexedDB persistence demo)
const profileIdEl = document.getElementById('profile-id') as HTMLInputElement | null;
const profileNameEl = document.getElementById('profile-name') as HTMLInputElement | null;
const profileNoteEl = document.getElementById('profile-note') as HTMLTextAreaElement | null;
const btnSaveEl = document.getElementById('btn-save');
const btnLoadEl = document.getElementById('btn-load');
const dbStatusEl = document.getElementById('db-status');
const recordJsonEl = document.getElementById('record-json');

function setLoadingStatus(text: string): void {
    if (loadingStatusEl) loadingStatusEl.textContent = text;
}

function showApp(): void {
    if (loadingEl) loadingEl.classList.add('hidden');
    // Wait for fade-out transition before showing app
    setTimeout(() => {
        if (loadingEl) loadingEl.style.display = 'none';
        if (appEl) appEl.classList.add('visible');
    }, LOADING_FADE_MS);
}

function setStatus(text: string, state?: 'done' | 'error'): void {
    if (statusEl) statusEl.textContent = text;
    if (statusDotEl) {
        statusDotEl.classList.remove('done', 'error');
        if (state) statusDotEl.classList.add(state);
    }
}

function log(line: string): void {
    if (!outputEl) return;
    outputEl.textContent = `${outputEl.textContent ?? ''}${line}\n`;
}

function isoNow(): string {
    return new Date().toISOString();
}

// ── Bridge adapter (platform-agnostic) ────────────────────────────────────────
const bridge: BridgeAdapter = createBridgeAdapter();

function postToBridge(payload: BridgeEnvelope): void {
    try { bridge.postMessage(payload); } catch { /* best-effort */ }
}

// ── Global error hooks ────────────────────────────────────────────────────────
function installGlobalErrorHooks(): void {
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
function generateId(): string {
    return `${WORKER_ID_PREFIX}${Date.now()}-${++_idCounter}`;
}

function sendToWorker(cmd: WorkerInbound): Promise<WorkerOutbound> {
    return new Promise((resolve, reject) => {
        pending.set(cmd.id, { resolve, reject });
        worker!.postMessage(cmd);
    });
}

async function initPyodide(): Promise<void> {
    worker = new PyodideWorker();

    worker.onerror = (ev: ErrorEvent) => {
        log(`[worker error] ${ev.message}`);
        for (const [id, entry] of pending) {
            pending.delete(id);
            entry.reject(new Error(ev.message));
        }
    };

    worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
        const result = ev.data;

        // Forward worker log messages to bridge + on-screen output (not correlated to pending ops).
        if (result.type === 'log') {
            log(result.message);
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

// ── Profile persistence (IndexedDB via worker) ───────────────────────────────

function setDbStatus(text: string, ok = true): void {
    if (dbStatusEl) {
        dbStatusEl.textContent = `${ok ? '●' : '○'} ${text}`;
        dbStatusEl.style.color = ok ? 'var(--status-done)' : 'var(--status-error)';
    }
}

async function saveProfile(): Promise<void> {
    const id = profileIdEl?.value.trim();
    const name = profileNameEl?.value.trim();
    if (!id) { setDbStatus('Profile ID is required.', false); return; }
    if (!name) { setDbStatus('Name is required.', false); return; }

    const record = {
        id,
        name,
        note: profileNoteEl?.value ?? '',
        updated_at: isoNow(),
    };

    const cmdId = generateId();
    const result = await sendToWorker({
        id: cmdId,
        type: 'db_save',
        key: `profile:${id}`,
        value: JSON.stringify(record),
    });

    if (result.type === 'db_save_result' && result.ok) {
        setDbStatus(`Saved profile '${id}'.`);
        if (recordJsonEl) recordJsonEl.textContent = JSON.stringify(record, null, 2);
        log(`saved profile id=${id}`);
    } else {
        setDbStatus(`Save failed: ${result.type === 'error' ? result.error : 'unknown'}`, false);
    }
}

async function loadProfile(): Promise<void> {
    const id = profileIdEl?.value.trim();
    if (!id) { setDbStatus('Enter a Profile ID to load.', false); return; }

    const cmdId = generateId();
    const result = await sendToWorker({
        id: cmdId,
        type: 'db_load',
        key: `profile:${id}`,
    });

    if (result.type === 'db_load_result') {
        if (result.value === null) {
            setDbStatus(`No profile found for '${id}'.`, false);
            if (recordJsonEl) recordJsonEl.textContent = 'No record loaded.';
        } else {
            try {
                const record = JSON.parse(result.value);
                if (profileNameEl) profileNameEl.value = record.name ?? '';
                if (profileNoteEl) profileNoteEl.value = record.note ?? '';
                if (recordJsonEl) recordJsonEl.textContent = JSON.stringify(record, null, 2);
                setDbStatus(`Loaded profile '${id}'.`);
                log(`loaded profile id=${id}`);
            } catch {
                setDbStatus('Stored data is corrupt (invalid JSON).', false);
                if (recordJsonEl) recordJsonEl.textContent = result.value;
            }
        }
    } else {
        setDbStatus(`Load failed: ${result.type === 'error' ? result.error : 'unknown'}`, false);
    }
}

function installProfileHandlers(): void {
    btnSaveEl?.addEventListener('click', () => { void saveProfile(); });
    btnLoadEl?.addEventListener('click', () => { void loadProfile(); });
    setDbStatus('Ready. Enter profile id and name, then Save or Load.');
}

// ── Boot-time proof ───────────────────────────────────────────────────────────
async function runProof(): Promise<void> {
    const probe = PROOF_CHALLENGE;

    const hashId = generateId();
    const hashRes = await sendToWorker({ id: hashId, type: 'blake3_hash', data: probe });
    log(`blake3: ${hashRes.type === 'blake3_result' ? hashRes.hex : `(error: ${hashRes.type === 'error' ? hashRes.error : hashRes.type})`}`);

    const signId = generateId();
    const signRes = await sendToWorker({ id: signId, type: 'sign', message: probe });
    if (signRes.type !== 'sign_result') { log(`sign failed: ${signRes.type === 'error' ? signRes.error : signRes.type}`); return; }
    const { signature, publicKey } = signRes;
    log(`signed ok, pk: ${publicKey.slice(0, 16)}…`);

    const verifyId = generateId();
    const verifyRes = await sendToWorker({ id: verifyId, type: 'verify', message: probe, signature, publicKey });
    log(`pychloride sign+verify: ${verifyRes.type === 'verify_result' ? verifyRes.valid : false}`);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    installGlobalErrorHooks();
    postToBridge({ type: 'lifecycle', timestamp: isoNow(), message: 'boot' });

    setLoadingStatus('Loading Pyodide…');
    await initPyodide();

    setLoadingStatus('Running crypto proof…');
    showApp();
    installProfileHandlers();

    setStatus('running proof');
    await runProof();

    setStatus('done', 'done');
    postToBridge({ type: 'lifecycle', timestamp: isoNow(), message: 'done' });
}

main().catch((e: unknown) => {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    setStatus(err, 'error');
    showApp();
    log(err);
});
