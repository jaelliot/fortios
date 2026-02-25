import Testing

@testable import KeriWallet

@Suite("AppConfig constants")
struct AppConfigTests {

    // MARK: - Scheme

    @Test("allowed schemes include app and about")
    func allowedSchemesContainExpected() {
        #expect(AppConfig.Scheme.allowedSchemes.contains("app"))
        #expect(AppConfig.Scheme.allowedSchemes.contains("about"))
    }

    @Test("entry URL uses the registered scheme name")
    func entryURLUsesScheme() {
        #expect(AppConfig.Scheme.entryURL.hasPrefix(AppConfig.Scheme.name + "://"))
    }

    @Test("defaultIndexPath is index.html")
    func defaultIndexPath() {
        #expect(AppConfig.Scheme.defaultIndexPath == "index.html")
    }

    // MARK: - Bridge

    @Test("bridge handler name matches BridgeContract")
    func bridgeHandlerNameMatchesBridgeContract() {
        #expect(AppConfig.Bridge.handlerName == BridgeContract.handlerName)
    }

    // MARK: - Payload

    @Test("maxResourceBytes is 20 MiB")
    func maxResourceBytes() {
        #expect(AppConfig.Payload.maxResourceBytes == 20 * 1024 * 1024)
    }

    @Test("bundleSubdirectory is non-empty")
    func bundleSubdirectoryNonEmpty() {
        #expect(!AppConfig.Payload.bundleSubdirectory.isEmpty)
    }

    // MARK: - HTTP

    @Test("crossOriginHeaders contains all three required keys")
    func crossOriginIsolationHeaders() {
        let keys = AppConfig.HTTP.crossOriginHeaders.map(\.0)
        #expect(keys.contains("Cross-Origin-Opener-Policy"))
        #expect(keys.contains("Cross-Origin-Embedder-Policy"))
        #expect(keys.contains("Cross-Origin-Resource-Policy"))
    }

    @Test("COOP header value is same-origin")
    func coopValue() {
        let headers = Dictionary(uniqueKeysWithValues: AppConfig.HTTP.crossOriginHeaders)
        #expect(headers["Cross-Origin-Opener-Policy"] == "same-origin")
    }

    @Test("COEP header value is require-corp")
    func coepValue() {
        let headers = Dictionary(uniqueKeysWithValues: AppConfig.HTTP.crossOriginHeaders)
        #expect(headers["Cross-Origin-Embedder-Policy"] == "require-corp")
    }
}
