import Foundation
import Testing

@testable import KeriWallet

// MARK: - Helpers

/// Writes a file at `url` with the given bytes and returns its URL.
private func writeFile(_ url: URL, content: String) throws -> URL {
    try content.write(to: url, atomically: true, encoding: .utf8)
    return url
}

// MARK: - MIME Tests

@Suite("AppConfig.MIME")
struct MIMETests {
    @Test("known extensions map to correct MIME types")
    func knownExtensions() {
        #expect(AppConfig.MIME.contentType(for: "html") == "text/html")
        #expect(AppConfig.MIME.contentType(for: "js") == "text/javascript")
        #expect(AppConfig.MIME.contentType(for: "mjs") == "text/javascript")
        #expect(AppConfig.MIME.contentType(for: "css") == "text/css")
        #expect(AppConfig.MIME.contentType(for: "json") == "application/json")
        #expect(AppConfig.MIME.contentType(for: "wasm") == "application/wasm")
        #expect(AppConfig.MIME.contentType(for: "whl") == "application/zip")
        #expect(AppConfig.MIME.contentType(for: "py") == "text/plain")
    }

    @Test("unknown extension falls back to octet-stream")
    func unknownExtension() {
        #expect(AppConfig.MIME.contentType(for: "xyz") == "application/octet-stream")
        #expect(AppConfig.MIME.contentType(for: "") == "application/octet-stream")
    }

    @Test("extension lookup is case-insensitive")
    func caseInsensitive() {
        #expect(AppConfig.MIME.contentType(for: "JS") == "text/javascript")
        #expect(AppConfig.MIME.contentType(for: "HTML") == "text/html")
    }

    @Test("text MIME types get charset suffix")
    func textMIMEIsText() {
        #expect(AppConfig.MIME.isText("text/html"))
        #expect(AppConfig.MIME.isText("text/javascript"))
        #expect(AppConfig.MIME.isText("application/json"))
        #expect(!AppConfig.MIME.isText("application/wasm"))
        #expect(!AppConfig.MIME.isText("application/octet-stream"))
    }
}

// MARK: - Path Normalisation Tests

@Suite("PayloadSchemeHandler path normalisation")
struct PathNormalisationTests {

    private func makeHandler(dir: URL) -> PayloadSchemeHandler {
        PayloadSchemeHandler(payloadDirectory: dir)
    }

    @Test("root path resolves to index.html")
    func rootPathResolvesToIndex() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let indexURL: URL = tmp.appendingPathComponent("index.html")
        _ = try writeFile(indexURL, content: "<html></html>")

        let handler = makeHandler(dir: tmp)
        // Access via a URL with empty path — should serve index.html
        let url = URL(string: "\(AppConfig.Scheme.name)://local/")!
        let (data, _, _) = try handler.loadResource(for: url)
        #expect(!data.isEmpty)
    }

    @Test("percent-encoded path is decoded")
    func percentEncodedPath() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        _ = try writeFile(tmp.appendingPathComponent("hello world.js"), content: "// ok")

        let handler = makeHandler(dir: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/hello%20world.js")!
        let (data, mime, _) = try handler.loadResource(for: url)
        #expect(!data.isEmpty)
        #expect(mime.hasPrefix("text/javascript"))
    }

    @Test("dot-dot segment throws disallowedPath")
    func dotDotThrows() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let handler = makeHandler(dir: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/../etc/passwd")!
        #expect(throws: PayloadSchemeError.disallowedPath) {
            _ = try handler.loadResource(for: url)
        }
    }

    @Test("single-dot segment throws disallowedPath")
    func singleDotThrows() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let handler = makeHandler(dir: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/./index.html")!
        #expect(throws: PayloadSchemeError.disallowedPath) {
            _ = try handler.loadResource(for: url)
        }
    }

    @Test("missing file throws missingResource")
    func missingFileThrows() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let handler = makeHandler(dir: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/nonexistent.js")!
        #expect(throws: PayloadSchemeError.missingResource) {
            _ = try handler.loadResource(for: url)
        }
    }

    @Test("oversized file throws resourceTooLarge")
    func oversizedFileThrows() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        _ = try writeFile(tmp.appendingPathComponent("big.js"), content: "x")

        // Set maxBytes to 0 to force the size guard
        let handler = PayloadSchemeHandler(maxBytes: 0, payloadDirectory: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/big.js")!
        #expect(throws: PayloadSchemeError.resourceTooLarge) {
            _ = try handler.loadResource(for: url)
        }
    }

    @Test("non-app scheme throws invalidURL")
    func wrongSchemeThrows() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let handler = makeHandler(dir: tmp)
        let url: URL = URL(string: "https://example.com/index.html")!
        #expect(throws: PayloadSchemeError.invalidURL) {
            _ = try handler.loadResource(for: url)
        }
    }

    @Test("COOP/COEP/CORP headers are present in response")
    func crossOriginIsolationHeaders() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        _ = try writeFile(tmp.appendingPathComponent("index.html"), content: "<html></html>")

        let handler = makeHandler(dir: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/index.html")!
        let (_, _, headers) = try handler.loadResource(for: url)

        #expect(headers["Cross-Origin-Opener-Policy"] == "same-origin")
        #expect(headers["Cross-Origin-Embedder-Policy"] == "require-corp")
        #expect(headers["Cross-Origin-Resource-Policy"] == "cross-origin")
    }

    @Test("binary file returns correct MIME and no charset suffix")
    func binaryFileMIME() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        // Write a small binary file posing as a .wasm module
        let wasmURL: URL = tmp.appendingPathComponent("test.wasm")
        let wasmBytes: Data = Data([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00])
        try wasmBytes.write(to: wasmURL)

        let handler = makeHandler(dir: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/test.wasm")!
        let (data, mime, _) = try handler.loadResource(for: url)

        #expect(data == wasmBytes)
        #expect(mime == "application/wasm")
        // Binary MIME must NOT have charset suffix
        #expect(!mime.contains("charset"))
    }

    @Test("wheel file returns application/zip MIME")
    func wheelFileMIME() throws {
        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let whlURL: URL = tmp.appendingPathComponent("package.whl")
        try Data([0x50, 0x4B, 0x03, 0x04]).write(to: whlURL)

        let handler = makeHandler(dir: tmp)
        let url = URL(string: "\(AppConfig.Scheme.name)://local/package.whl")!
        let (_, mime, _) = try handler.loadResource(for: url)

        #expect(mime == "application/zip")
        #expect(!mime.contains("charset"))
    }

    @Test("serving index retains an operator-visible breadcrumb")
    func servingIndexRetainsBreadcrumb() throws {
        AppLogger.resetRetainedBreadcrumbs()

        let tmp: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        _ = try writeFile(tmp.appendingPathComponent("index.html"), content: "<html></html>")

        let handler = makeHandler(dir: tmp)
        _ = try handler.loadResource(for: URL(string: "\(AppConfig.Scheme.name)://local/index.html")!)

        let breadcrumb = AppLogger.retainedBreadcrumbs().last
        #expect(breadcrumb?.level == .notice)
        #expect(breadcrumb?.category == AppConfig.Log.schemeHandler)
        #expect(breadcrumb?.message.contains("served initial document") == true)
    }
}
