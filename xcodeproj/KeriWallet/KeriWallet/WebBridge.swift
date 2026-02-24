import Foundation
import WebKit

enum WebBridgeMessageType: String, Decodable {
    case jsError = "js_error"
    case unhandledRejection = "unhandled_rejection"
    case log
    case lifecycle
    case cryptoResult = "crypto_result"
}

/// Typed payload for crypto_result messages posted by JS after a Python op completes.
struct CryptoResultPayload: Decodable {
    /// Correlates to the `id` field of the originating WorkerCommand.
    let id: String
    /// JSON-encoded WorkerOutbound value (blake3_result, sign_result, verify_result, error).
    let message: String
    /// Non-nil when the operation failed; mirrors WorkerOutbound.error.
    let error: String?
}

struct WebBridgeEnvelope: Decodable {
    let type: WebBridgeMessageType
    let timestamp: String
    let message: String

    let stack: String?
    let source: String?
    let line: Int?
    let col: Int?
}

final class WebBridge: NSObject, WKScriptMessageHandler {
    /// Called on the main thread whenever a `crypto_result` message arrives from JS.
    /// Set this before the WebView loads its first URL.
    var onCryptoResult: ((CryptoResultPayload) -> Void)?

    override init() {
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard message.name == AppConfig.Bridge.handlerName else {
            AppLogger.error(
                "[WebBridge] unexpected handler name: \(message.name)", category: AppConfig.Log.webBridge)
            return
        }

        guard let envelope = decodeEnvelope(body: message.body) else {
            AppLogger.warning("[WebBridge] ignored malformed message", category: AppConfig.Log.webBridge)
            return
        }

        switch envelope.type {
        case .jsError, .unhandledRejection:
            AppLogger.error(
                "[WebBridge] \(envelope.type.rawValue): \(envelope.message)", category: AppConfig.Log.webBridge)
        case .log, .lifecycle:
            AppLogger.info(
                "[WebBridge] \(envelope.type.rawValue): \(envelope.message)", category: AppConfig.Log.webBridge)
        case .cryptoResult:
            if let callback = onCryptoResult {
                // Re-decode with the narrower CryptoResultPayload type
                if let dict = message.body as? [String: Any],
                    let data = try? JSONSerialization.data(withJSONObject: dict),
                    let payload = try? JSONDecoder().decode(CryptoResultPayload.self, from: data) {
                    AppLogger.info(
                        "[WebBridge] crypto_result id=\(payload.id) hasError=\(payload.error != nil)",
                        category: AppConfig.Log.webBridge
                    )
                    callback(payload)
                } else {
                    AppLogger.warning(
                        "[WebBridge] crypto_result: failed to decode CryptoResultPayload",
                        category: AppConfig.Log.webBridge)
                }
            } else {
                AppLogger.info(
                    "[WebBridge] crypto_result (no callback registered)", category: AppConfig.Log.webBridge)
            }
        }
    }

    private func decodeEnvelope(body: Any) -> WebBridgeEnvelope? {
        if let dict = body as? [String: Any] {
            return decodeFromJSONObject(dict)
        }

        if let str = body as? String,
            let data = str.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data),
            let dict = obj as? [String: Any] {
            return decodeFromJSONObject(dict)
        }

        return nil
    }

    private func decodeFromJSONObject(_ obj: [String: Any]) -> WebBridgeEnvelope? {
        guard JSONSerialization.isValidJSONObject(obj),
            let data = try? JSONSerialization.data(withJSONObject: obj)
        else {
            return nil
        }

        return try? JSONDecoder().decode(WebBridgeEnvelope.self, from: data)
    }
}
