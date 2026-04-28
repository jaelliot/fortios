// ── AUTO-GENERATED — do not edit manually ──────────────────────────────────
// Source: bridge-contract.json
// Regenerate: node tools/gen-bridge-contract.mjs

// ── Contract version ────────────────────────────────────────────────────────
export const BRIDGE_CONTRACT_VERSION = "1.0" as const;

// ── Bridge handler ──────────────────────────────────────────────────────────
export const BRIDGE_HANDLER_NAME = "bridge" as const;

// ── Lifecycle states ────────────────────────────────────────────────────────
export const LIFECYCLE_BOOT = "boot" as const;
export const LIFECYCLE_PYODIDE_LOADING = "pyodide_loading" as const;
export const LIFECYCLE_CRYPTO_READY = "crypto_ready" as const;
export const LIFECYCLE_READY = "ready" as const;
export const LIFECYCLE_ERROR = "error" as const;

export const LIFECYCLE_STATES = [
    LIFECYCLE_BOOT,
    LIFECYCLE_PYODIDE_LOADING,
    LIFECYCLE_CRYPTO_READY,
    LIFECYCLE_READY,
    LIFECYCLE_ERROR,
] as const;

// ── Bridge message types (JS → Swift) ──────────────────────────────────────
export const BRIDGE_JS_ERROR = "js_error" as const;
export const BRIDGE_UNHANDLED_REJECTION = "unhandled_rejection" as const;
export const BRIDGE_LOG = "log" as const;
export const BRIDGE_LIFECYCLE = "lifecycle" as const;
export const BRIDGE_CRYPTO_RESULT = "crypto_result" as const;

export const BRIDGE_MESSAGE_TYPES = [
    BRIDGE_JS_ERROR,
    BRIDGE_UNHANDLED_REJECTION,
    BRIDGE_LOG,
    BRIDGE_LIFECYCLE,
    BRIDGE_CRYPTO_RESULT,
] as const;

// ── Worker command types (main → worker) ────────────────────────────────────
export const WORKER_CMD_INIT = "init" as const;
export const WORKER_CMD_BLAKE3_HASH = "blake3_hash" as const;
export const WORKER_CMD_SIGN = "sign" as const;
export const WORKER_CMD_VERIFY = "verify" as const;
export const WORKER_CMD_DB_SAVE = "db_save" as const;
export const WORKER_CMD_DB_LOAD = "db_load" as const;
export const WORKER_CMD_DB_DELETE = "db_delete" as const;

export const WORKER_COMMAND_TYPES = [
    WORKER_CMD_INIT,
    WORKER_CMD_BLAKE3_HASH,
    WORKER_CMD_SIGN,
    WORKER_CMD_VERIFY,
    WORKER_CMD_DB_SAVE,
    WORKER_CMD_DB_LOAD,
    WORKER_CMD_DB_DELETE,
] as const;

// ── Worker result types (worker → main) ─────────────────────────────────────
export const WORKER_RES_READY = "ready" as const;
export const WORKER_RES_BLAKE3_RESULT = "blake3_result" as const;
export const WORKER_RES_SIGN_RESULT = "sign_result" as const;
export const WORKER_RES_VERIFY_RESULT = "verify_result" as const;
export const WORKER_RES_DB_SAVE_RESULT = "db_save_result" as const;
export const WORKER_RES_DB_LOAD_RESULT = "db_load_result" as const;
export const WORKER_RES_DB_DELETE_RESULT = "db_delete_result" as const;
export const WORKER_RES_ERROR = "error" as const;
export const WORKER_RES_LOG = "log" as const;

export const WORKER_RESULT_TYPES = [
    WORKER_RES_READY,
    WORKER_RES_BLAKE3_RESULT,
    WORKER_RES_SIGN_RESULT,
    WORKER_RES_VERIFY_RESULT,
    WORKER_RES_DB_SAVE_RESULT,
    WORKER_RES_DB_LOAD_RESULT,
    WORKER_RES_DB_DELETE_RESULT,
    WORKER_RES_ERROR,
    WORKER_RES_LOG,
] as const;
