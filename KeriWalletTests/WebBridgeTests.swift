import Foundation
import Testing

@testable import KeriWallet

@Suite("WebBridgeEnvelope decoding")
struct WebBridgeEnvelopeTests {

    private let decoder = JSONDecoder()

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
        let json = """
        {"type":"__unknown__","timestamp":"t","message":"x"}
        """
        let data = try #require(json.data(using: .utf8))
        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(WebBridgeEnvelope.self, from: data)
        }
    }

    @Test("throws when type field is missing")
    func throwsWhenTypeFieldMissing() throws {
        let json = """
        {"timestamp":"t","message":"x"}
        """
        let data = try #require(json.data(using: .utf8))
        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(WebBridgeEnvelope.self, from: data)
        }
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
