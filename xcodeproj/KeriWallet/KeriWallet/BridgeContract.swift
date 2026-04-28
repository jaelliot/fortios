// ── AUTO-GENERATED — do not edit manually ──────────────────────────────────
// Source: bridge-contract.json
// Regenerate: node tools/gen-bridge-contract.mjs
//
// This file provides the cross-language bridge constants. Values here must
// match the TypeScript side (src/bridge-contract.ts) exactly.

import Foundation

/// Cross-language bridge constants generated from `bridge-contract.json`.
/// Use these instead of hardcoded string literals when referring to bridge
/// handler names or message type discriminants.
enum BridgeContract {

    // MARK: - Contract Version

    static let version = "1.0"

    // MARK: - Bridge Handler

    /// WKScriptMessageHandler name — must match JS: `webkit.messageHandlers.bridge`.
    static let handlerName = "bridge"

    // MARK: - Lifecycle States

    static let lifecycleBoot = "boot"
    static let lifecyclePyodideLoading = "pyodide_loading"
    static let lifecycleCryptoReady = "crypto_ready"
    static let lifecycleReady = "ready"
    static let lifecycleError = "error"

    static let allLifecycleStates: [String] = [
        lifecycleBoot,
        lifecyclePyodideLoading,
        lifecycleCryptoReady,
        lifecycleReady,
        lifecycleError,
    ]

    // MARK: - Bridge Message Types (JS → Swift)

    static let bridgeJsError = "js_error"
    static let bridgeUnhandledRejection = "unhandled_rejection"
    static let bridgeLog = "log"
    static let bridgeLifecycle = "lifecycle"
    static let bridgeCryptoResult = "crypto_result"

    static let allBridgeMessageTypes: [String] = [
        bridgeJsError,
        bridgeUnhandledRejection,
        bridgeLog,
        bridgeLifecycle,
        bridgeCryptoResult,
    ]

    // MARK: - Worker Command Types (main → worker)

    static let workerCmdInit = "init"
    static let workerCmdBlake3Hash = "blake3_hash"
    static let workerCmdSign = "sign"
    static let workerCmdVerify = "verify"
    static let workerCmdDbPut = "db_put"
    static let workerCmdDbGet = "db_get"
    static let workerCmdDbDel = "db_del"
    static let workerCmdDbList = "db_list"

    static let allWorkerCommandTypes: [String] = [
        workerCmdInit,
        workerCmdBlake3Hash,
        workerCmdSign,
        workerCmdVerify,
        workerCmdDbPut,
        workerCmdDbGet,
        workerCmdDbDel,
        workerCmdDbList,
    ]

    // MARK: - Worker Result Types (worker → main)

    static let workerResReady = "ready"
    static let workerResBlake3Result = "blake3_result"
    static let workerResSignResult = "sign_result"
    static let workerResVerifyResult = "verify_result"
    static let workerResDbPutResult = "db_put_result"
    static let workerResDbGetResult = "db_get_result"
    static let workerResDbDelResult = "db_del_result"
    static let workerResDbListResult = "db_list_result"
    static let workerResError = "error"
    static let workerResLog = "log"

    static let allWorkerResultTypes: [String] = [
        workerResReady,
        workerResBlake3Result,
        workerResSignResult,
        workerResVerifyResult,
        workerResDbPutResult,
        workerResDbGetResult,
        workerResDbDelResult,
        workerResDbListResult,
        workerResError,
        workerResLog,
    ]
}
