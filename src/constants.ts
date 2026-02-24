// ── Runtime constants for the JS ↔ Worker ↔ Swift bridge ─────────────────────
//
// Single source of truth for string literals and numeric values shared between
// main.ts and pyodide_worker.ts. Keeps them in sync and makes refactoring safe.

// Re-export bridge handler name from the auto-generated contract so consumers
// don't need to know about the generated file.
export { BRIDGE_HANDLER_NAME } from './bridge-contract';

// ── Worker IDs ───────────────────────────────────────────────────────────────
/** Prefix for generated worker command IDs. */
export const WORKER_ID_PREFIX = 'w';

/** Synthetic `id` used for uncorrelated log messages from the worker. */
export const WORKER_LOG_ID = '_log';

// ── Timing ───────────────────────────────────────────────────────────────────
/**
 * Milliseconds to wait for the CSS fade-out transition before showing the app.
 * Must match `--fade-duration` in index.html (currently `0.4s`).
 */
export const LOADING_FADE_MS = 400;

// ── Wheel filenames ──────────────────────────────────────────────────────────
/** Blake3 WASM wheel filename (bundled in public/pyodide/wheels/). */
export const BLAKE3_WHEEL = 'blake3-1.0.8-cp313-cp313-pyodide_2025_0_wasm32.whl';

/** Pychloride wheel filename (stable name set by download-pyodide.sh). */
export const PYCHLORIDE_WHEEL = 'pychloride.whl';

// ── Demo / Proof ─────────────────────────────────────────────────────────────
/** Challenge string used in the boot-time proof-of-concept crypto cycle. */
export const PROOF_CHALLENGE = 'keriwasm proof vector v1';
