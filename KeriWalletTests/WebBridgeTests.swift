import Foundation
import Testing

@testable import KeriWallet

@Suite("WebBridgeEnvelope decoding")
struct WebBridgeEnvelopeTests {

    private let decoder: JSONDecoder = JSONDecoder()

    private func envelope(_ json: String) throws -> WebBridgeEnvelope {
        let data = try #require(json.data(using: .utf8))
        return try decoder.decode(WebBridgeEnvelope.self, from: data)
    }

    // MARK: - Happy path

    @Test("decodes lifecycle message")
    func decodesLifecycle() throws {
        let env = try envelope("""
        {"type":"lifecycle","timestamp":"2026-01-01T00:00:00Z","message":"ready"}
        """)
        #expect(env.type == .lifecycle)
        #expect(env.message == "ready")
        #expect(env.stack == nil)
    }

    @Test("decodes js_error message with stack")
    func decodesJsError() throws {
        let env = try envelope("""
        {"type":"js_error","timestamp":"2026-01-01T00:00:00Z","message":"oops","stack":"at eval:1"}
        """)
        #expect(env.type == .jsError)
        #expect(env.stack == "at eval:1")
    }

    @Test("decodes log message")
    func decodesLog() throws {
        let env = try envelope("""
        {"type":"log","timestamp":"t","message":"hello"}
        """)
        #expect(env.type == .log)
        #expect(env.message == "hello")
    }

    @Test("decodes crypto_result message")
    func decodesCryptoResult() throws {
        let env = try envelope("""
        {"type":"crypto_result","timestamp":"t","message":"{}"}
        """)
        #expect(env.type == .cryptoResult)
    }

    @Test("decodes unhandled_rejection message")
    func decodesUnhandledRejection() throws {
        let env = try envelope("""
        {"type":"unhandled_rejection","timestamp":"t","message":"promise rejected"}
        """)
        #expect(env.type == .unhandledRejection)
    }

    // MARK: - Failure paths

    @Test("throws on unknown type discriminant")
    func throwsOnUnknownType() throws {
        let json: String = """
        {"type":"__unknown__","timestamp":"t","message":"x"}
        """
        let data = try #require(json.data(using: .utf8))
        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(WebBridgeEnvelope.self, from: data)
        }
    }

    @Test("throws when type field is missing")
    func throwsWhenTypeFieldMissing() throws {
        let json: String = """
        {"timestamp":"t","message":"x"}
        """
        let data = try #require(json.data(using: .utf8))
        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(WebBridgeEnvelope.self, from: data)
        }
    }
}

@Suite("WebBridge logging classification")
struct WebBridgeLoggingClassificationTests {

    private let decoder: JSONDecoder = JSONDecoder()

    private func envelope(_ json: String) throws -> WebBridgeEnvelope {
        let data = try #require(json.data(using: .utf8))
        return try decoder.decode(WebBridgeEnvelope.self, from: data)
    }

    @Test("known lifecycle states become notice breadcrumbs")
    func lifecycleBootIsNotice() throws {
        let disposition = WebBridge.logDisposition(for: try envelope("""
        {"type":"lifecycle","timestamp":"t","message":"boot"}
        """))

        #expect(disposition.level == .notice)
        #expect(disposition.message.contains("lifecycle: boot"))
    }

    @Test("unknown lifecycle states warn on bridge drift")
    func lifecycleDoneWarns() throws {
        let disposition = WebBridge.logDisposition(for: try envelope("""
        {"type":"lifecycle","timestamp":"t","message":"done"}
        """))

        #expect(disposition.level == .warning)
        #expect(disposition.message.contains("lifecycle drift"))
    }

    @Test("FortWeb lifecycle diagnostics map boot to notice")
    func fortwebLifecycleBootIsNotice() throws {
        let disposition = WebBridge.logDisposition(for: try envelope("""
        {"type":"lifecycle","timestamp":"t","message":"[fortweb.runtime] event=worker_lifecycle state=\\"boot\\""}
        """))

        #expect(disposition.level == .notice)
        #expect(disposition.message == "[WebBridge] lifecycle: boot")
    }

    @Test("FortWeb warning diagnostics keep warning severity")
    func fortwebWarningDiagnosticWarns() throws {
        let disposition = WebBridge.logDisposition(for: try envelope("""
        {"type":"log","timestamp":"t","message":"[fortweb.runtime] event=request_timeout level=\\"warning\\" method=\\"vaults.create\\""}
        """))

        #expect(disposition.level == .warning)
        #expect(disposition.message.contains("request_timeout"))
    }

    @Test("FortWeb request start diagnostics stay low-volume")
    func fortwebRequestStartDiagnosticIsDebug() throws {
        let disposition = WebBridge.logDisposition(for: try envelope("""
        {"type":"log","timestamp":"t","message":"[fortweb.runtime] event=request_start level=\\"info\\" method=\\"vaults.list\\""}
        """))

        #expect(disposition.level == .debug)
        #expect(disposition.message.contains("runtime:"))
    }

    @Test("error-like log messages escalate to error")
    func errorLogEscalates() throws {
        let disposition = WebBridge.logDisposition(for: try envelope("""
        {"type":"log","timestamp":"t","message":"fatal worker error"}
        """))

        #expect(disposition.level == .error)
        #expect(disposition.message.contains("escalated to error"))
    }

    @Test("crypto result errors warn for operator breadcrumbs")
    func cryptoResultErrorWarns() {
        let disposition = WebBridge.cryptoResultDisposition(
            for: CryptoResultPayload(id: "op-1", message: "", error: "worker failed"))

        #expect(disposition.level == .warning)
        #expect(disposition.message.contains("id=op-1"))
    }
}

// MARK: - BridgeContract cross-language consistency

@Suite("BridgeContract cross-language consistency")
struct BridgeContractTests {

    @Test("handler name is non-empty string")
    func handlerNameNonEmpty() {
        #expect(!BridgeContract.handlerName.isEmpty)
    }

    @Test("all bridge message type constants are non-empty")
    func bridgeMessageTypesNonEmpty() {
        for t in BridgeContract.allBridgeMessageTypes {
            #expect(!t.isEmpty)
        }
    }

    @Test("all worker command type constants are non-empty")
    func workerCommandTypesNonEmpty() {
        for t in BridgeContract.allWorkerCommandTypes {
            #expect(!t.isEmpty)
        }
    }

    @Test("all worker result type constants are non-empty")
    func workerResultTypesNonEmpty() {
        for t in BridgeContract.allWorkerResultTypes {
            #expect(!t.isEmpty)
        }
    }

    @Test("WebBridgeMessageType raw values align with BridgeContract")
    func webBridgeMessageTypeAligned() {
        #expect(WebBridgeMessageType.jsError.rawValue == BridgeContract.bridgeJsError)
        #expect(WebBridgeMessageType.unhandledRejection.rawValue == BridgeContract.bridgeUnhandledRejection)
        #expect(WebBridgeMessageType.log.rawValue == BridgeContract.bridgeLog)
        #expect(WebBridgeMessageType.lifecycle.rawValue == BridgeContract.bridgeLifecycle)
        #expect(WebBridgeMessageType.cryptoResult.rawValue == BridgeContract.bridgeCryptoResult)
    }
}

// MARK: - CryptoResultPayload decoding

@Suite("CryptoResultPayload decoding")
struct CryptoResultPayloadTests {

    private let decoder: JSONDecoder = JSONDecoder()

    private func payload(_ json: String) throws -> CryptoResultPayload {
        let data = try #require(json.data(using: .utf8))
        return try decoder.decode(CryptoResultPayload.self, from: data)
    }

    @Test("decodes successful result with id and message")
    func decodesSuccess() throws {
        let p = try payload("""
        {"id":"w1234","message":"{\\"type\\":\\"blake3_result\\",\\"hex\\":\\"ab\\"}"}
        """)
        #expect(p.id == "w1234")
        #expect(p.message.contains("blake3_result"))
        #expect(p.error == nil)
    }

    @Test("decodes result with error field")
    func decodesError() throws {
        let p = try payload("""
        {"id":"w5678","message":"","error":"worker not initialized"}
        """)
        #expect(p.id == "w5678")
        #expect(p.error == "worker not initialized")
    }

    @Test("throws when id field is missing")
    func throwsWhenIdMissing() throws {
        let json: String = """
        {"message":"{}"}
        """
        let data = try #require(json.data(using: .utf8))
        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(CryptoResultPayload.self, from: data)
        }
    }

    @Test("throws when message field is missing")
    func throwsWhenMessageMissing() throws {
        let json: String = """
        {"id":"w1"}
        """
        let data = try #require(json.data(using: .utf8))
        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(CryptoResultPayload.self, from: data)
        }
    }
}
