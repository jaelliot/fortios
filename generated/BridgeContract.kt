// ── AUTO-GENERATED — do not edit manually ──────────────────────────────────
// Source: bridge-contract.json
// Regenerate: node tools/gen-bridge-contract.mjs
//
// This file provides the cross-language bridge constants for Android.
// Values here must match the TypeScript side (src/bridge-contract.ts) exactly.

package org.kerifoundation.fort.bridge

/**
 * Cross-language bridge constants generated from `bridge-contract.json`.
 * Use these instead of hardcoded string literals when referring to bridge
 * handler names or message type discriminants.
 */
object BridgeContract {

    // ── Contract Version ────────────────────────────────────────────────────

    const val VERSION = "1.0"

    // ── Bridge Handler ──────────────────────────────────────────────────────

    /** addJavascriptInterface name — must match JS: `window.AndroidBridge`. */
    const val HANDLER_NAME = "bridge"

    // ── Lifecycle States ──────────────────────────────────────────────────

    const val LIFECYCLE_BOOT = "boot"
    const val LIFECYCLE_PYODIDE_LOADING = "pyodide_loading"
    const val LIFECYCLE_CRYPTO_READY = "crypto_ready"
    const val LIFECYCLE_READY = "ready"
    const val LIFECYCLE_ERROR = "error"

    val ALL_LIFECYCLE_STATES = listOf(
        LIFECYCLE_BOOT,
        LIFECYCLE_PYODIDE_LOADING,
        LIFECYCLE_CRYPTO_READY,
        LIFECYCLE_READY,
        LIFECYCLE_ERROR,
    )

    // ── Bridge Message Types (JS → Android) ─────────────────────────────────

    const val BRIDGE_JS_ERROR = "js_error"
    const val BRIDGE_UNHANDLED_REJECTION = "unhandled_rejection"
    const val BRIDGE_LOG = "log"
    const val BRIDGE_LIFECYCLE = "lifecycle"
    const val BRIDGE_CRYPTO_RESULT = "crypto_result"

    val ALL_BRIDGE_MESSAGE_TYPES = listOf(
        BRIDGE_JS_ERROR,
        BRIDGE_UNHANDLED_REJECTION,
        BRIDGE_LOG,
        BRIDGE_LIFECYCLE,
        BRIDGE_CRYPTO_RESULT,
    )

    // ── Worker Command Types (main → worker) ─────────────────────────────

    const val WORKER_CMD_INIT = "init"
    const val WORKER_CMD_BLAKE3_HASH = "blake3_hash"
    const val WORKER_CMD_SIGN = "sign"
    const val WORKER_CMD_VERIFY = "verify"
    const val WORKER_CMD_DB_SAVE = "db_save"
    const val WORKER_CMD_DB_LOAD = "db_load"
    const val WORKER_CMD_DB_DELETE = "db_delete"

    val ALL_WORKER_COMMAND_TYPES = listOf(
        WORKER_CMD_INIT,
        WORKER_CMD_BLAKE3_HASH,
        WORKER_CMD_SIGN,
        WORKER_CMD_VERIFY,
        WORKER_CMD_DB_SAVE,
        WORKER_CMD_DB_LOAD,
        WORKER_CMD_DB_DELETE,
    )

    // ── Worker Result Types (worker → main) ──────────────────────────────

    const val WORKER_RES_READY = "ready"
    const val WORKER_RES_BLAKE3_RESULT = "blake3_result"
    const val WORKER_RES_SIGN_RESULT = "sign_result"
    const val WORKER_RES_VERIFY_RESULT = "verify_result"
    const val WORKER_RES_DB_SAVE_RESULT = "db_save_result"
    const val WORKER_RES_DB_LOAD_RESULT = "db_load_result"
    const val WORKER_RES_DB_DELETE_RESULT = "db_delete_result"
    const val WORKER_RES_ERROR = "error"
    const val WORKER_RES_LOG = "log"

    val ALL_WORKER_RESULT_TYPES = listOf(
        WORKER_RES_READY,
        WORKER_RES_BLAKE3_RESULT,
        WORKER_RES_SIGN_RESULT,
        WORKER_RES_VERIFY_RESULT,
        WORKER_RES_DB_SAVE_RESULT,
        WORKER_RES_DB_LOAD_RESULT,
        WORKER_RES_DB_DELETE_RESULT,
        WORKER_RES_ERROR,
        WORKER_RES_LOG,
    )
}
