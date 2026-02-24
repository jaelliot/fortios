// ── AUTO-GENERATED — do not edit manually ──────────────────────────────────
// Source: bridge-contract.json
// Regenerate: node tools/gen-bridge-contract.mjs

// ── Bridge handler ──────────────────────────────────────────────────────────
export const BRIDGE_HANDLER_NAME = "bridge" as const;

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

export const WORKER_COMMAND_TYPES = [
    WORKER_CMD_INIT,
    WORKER_CMD_BLAKE3_HASH,
    WORKER_CMD_SIGN,
    WORKER_CMD_VERIFY,
] as const;

// ── Worker result types (worker → main) ─────────────────────────────────────
export const WORKER_RES_READY = "ready" as const;
export const WORKER_RES_BLAKE3_RESULT = "blake3_result" as const;
export const WORKER_RES_SIGN_RESULT = "sign_result" as const;
export const WORKER_RES_VERIFY_RESULT = "verify_result" as const;
export const WORKER_RES_ERROR = "error" as const;
export const WORKER_RES_LOG = "log" as const;

export const WORKER_RESULT_TYPES = [
    WORKER_RES_READY,
    WORKER_RES_BLAKE3_RESULT,
    WORKER_RES_SIGN_RESULT,
    WORKER_RES_VERIFY_RESULT,
    WORKER_RES_ERROR,
    WORKER_RES_LOG,
] as const;
