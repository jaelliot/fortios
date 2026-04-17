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

// ── Pyodide ──────────────────────────────────────────────────────────────────
/** Pinned Pyodide version — must match download-pyodide.sh and wheel tags. */
export const PYODIDE_VERSION = '0.29.1';

// ── IndexedDB ────────────────────────────────────────────────────────────────
/** Database name used by IndexedDBer for wallet persistence. */
export const IDB_DATABASE_NAME = 'keri-wallet';

/** IndexedDB store name for the default key-value namespace. */
export const IDB_DEFAULT_STORE = 'main';

// ── FortWeb storage proof mapping ──────────────────────────────────────────
/** FortWeb registry database name used by the browser lane. */
export const FORTWEB_REGISTRY_NAME = 'fortweb-vault-registry';

/** FortWeb registry subdb name used to store vault metadata records. */
export const FORTWEB_REGISTRY_STORE = 'vaults.';

/** Prefix FortWeb uses for per-vault storage names. */
export const FORTWEB_WALLET_STORAGE_PREFIX = 'fortweb-vault-';

/** FortWeb key-state subdb used inside each vault storage namespace. */
export const FORTWEB_KF_STATE_SUBDB = 'kfst.';

/** Map the FortWeb registry DB + subdb pair onto the Fort-ios store-scoped worker seam. */
export function fortwebRegistryWorkerStore(): string {
	return `${FORTWEB_REGISTRY_NAME}:${FORTWEB_REGISTRY_STORE}`;
}

/** Build the FortWeb per-vault storage name exactly as the browser worker does. */
export function fortwebVaultStorageName(vaultId: string): string {
	return `${FORTWEB_WALLET_STORAGE_PREFIX}${vaultId}`;
}

/** Map one FortWeb per-vault subdb onto the Fort-ios store-scoped worker seam. */
export function fortwebVaultWorkerStore(
	vaultId: string,
	subdb: string = FORTWEB_KF_STATE_SUBDB,
): string {
	return `${fortwebVaultStorageName(vaultId)}:${subdb}`;
}

// ── Demo / Proof ─────────────────────────────────────────────────────────────
/** Challenge string used in the boot-time proof-of-concept crypto cycle. */
export const PROOF_CHALLENGE = 'keriwasm proof vector v1';
