import Foundation
import WebKit

enum PayloadSchemeError: Error {
    case invalidURL
    case disallowedPath
    case missingResource
    case resourceTooLarge
}

final class PayloadSchemeHandler: NSObject, WKURLSchemeHandler {
    private let maxBytes: Int
    /// Overrides the default Bundle.main-derived payload directory. Inject a
    /// temporary directory URL in unit tests to avoid requiring a real app bundle.
    private let payloadDirectory: URL?
    private let fileManager: FileManager

    init(
        maxBytes: Int = AppConfig.Payload.maxResourceBytes,
        payloadDirectory: URL? = nil,
        fileManager: FileManager = .default
    ) {
        self.maxBytes = maxBytes
        self.payloadDirectory = payloadDirectory
        self.fileManager = fileManager
        super.init()
    }

    private var resolvedBaseURL: URL? {
        if let dir = payloadDirectory { return dir }
        return Bundle.main.resourceURL?.appendingPathComponent(
            AppConfig.Payload.bundleSubdirectory, isDirectory: true)
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            AppLogger.error("[SchemeHandler] no URL on task", category: AppConfig.Log.schemeHandler)
            urlSchemeTask.didFailWithError(PayloadSchemeError.invalidURL)
            return
        }

        let requestPath = requestPath(for: url)
        if isInitialDocumentPath(requestPath) {
            AppLogger.notice(
                "[SchemeHandler] start initial document path=\(requestPath)",
                category: AppConfig.Log.schemeHandler)
        } else {
            AppLogger.debug(
                "[SchemeHandler] start path=\(requestPath)",
                category: AppConfig.Log.schemeHandler)
        }

        do {

            let (data, _, headers) = try loadResource(for: url)

            guard
                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: AppConfig.HTTP.version,
                    headerFields: headers
                )
            else {
                urlSchemeTask.didFailWithError(PayloadSchemeError.missingResource)
                return
            }

            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            AppLogger.warning(
                "[SchemeHandler] failed path=\(requestPath) error=\(String(describing: error))",
                category: AppConfig.Log.schemeHandler)
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No async work to cancel.
    }

    /// Exposed as `internal` (not `private`) so `@testable import KeriWallet`
    /// can exercise the full request-handling logic without requiring a live
    /// `WKURLSchemeTask`. Production callers use the `WKURLSchemeHandler` protocol.
    func loadResource(for url: URL) throws -> (Data, String, [String: String]) {
        guard url.scheme?.lowercased() == AppConfig.Scheme.name else {
            throw PayloadSchemeError.invalidURL
        }

        let relPath = try normalizedRelativePath(urlPath: url.path)

        guard let baseURL = resolvedBaseURL else {
            throw PayloadSchemeError.missingResource
        }

        let fileURL = baseURL.appendingPathComponent(relPath, isDirectory: false)

        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw PayloadSchemeError.missingResource
        }

        let attrs = try fileManager.attributesOfItem(atPath: fileURL.path)
        let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
        if size > maxBytes {
            throw PayloadSchemeError.resourceTooLarge
        }

        let data = try Data(contentsOf: fileURL)
        let mime = AppConfig.MIME.contentType(for: fileURL.pathExtension)
        let contentTypeHeader = AppConfig.MIME.isText(mime) ? "\(mime); charset=utf-8" : mime
        let headers: [String: String] = [
            "Content-Type": contentTypeHeader,
            "Content-Length": "\(data.count)"
        ]
        // Append cross-origin isolation headers (COOP/COEP/CORP).
        var allHeaders = headers
        for (key, value) in AppConfig.HTTP.crossOriginHeaders {
            allHeaders[key] = value
        }
        if isInitialDocumentPath(relPath) {
            AppLogger.notice(
                "[SchemeHandler] served initial document path=\(relPath) bytes=\(data.count)",
                category: AppConfig.Log.schemeHandler)
        } else {
            AppLogger.debug(
                "[SchemeHandler] served path=\(relPath) mime=\(mime) bytes=\(data.count)",
                category: AppConfig.Log.schemeHandler)
        }
        return (data, mime, allHeaders)
    }

    private func normalizedRelativePath(urlPath: String) throws -> String {
        let decoded = urlPath.removingPercentEncoding ?? urlPath
        let trimmed = decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded

        let parts = trimmed.split(separator: "/", omittingEmptySubsequences: true)
        if parts.isEmpty {
            return AppConfig.Scheme.defaultIndexPath
        }

        for part in parts {
            if part == "." || part == ".." {
                throw PayloadSchemeError.disallowedPath
            }
        }

        return parts.joined(separator: "/")
    }

    private func requestPath(for url: URL) -> String {
        url.path.isEmpty ? "/" : url.path
    }

    private func isInitialDocumentPath(_ path: String) -> Bool {
        path == "/" || path == AppConfig.Scheme.defaultIndexPath
            || path == "/\(AppConfig.Scheme.defaultIndexPath)"
    }
}
