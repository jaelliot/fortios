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

    init(maxBytes: Int = AppConfig.Payload.maxResourceBytes) {
        self.maxBytes = maxBytes
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            AppLogger.error("[SchemeHandler] no URL on task", category: AppConfig.Log.schemeHandler)
            urlSchemeTask.didFailWithError(PayloadSchemeError.invalidURL)
            return
        }

        AppLogger.info(
            "[SchemeHandler] start: \(url.absoluteString)", category: AppConfig.Log.schemeHandler)

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
                "[SchemeHandler] failed: \(String(describing: error)) url=\(url.absoluteString)",
                category: AppConfig.Log.schemeHandler)
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No async work to cancel.
    }

    private func loadResource(for url: URL) throws -> (Data, String, [String: String]) {
        guard url.scheme?.lowercased() == AppConfig.Scheme.name else {
            throw PayloadSchemeError.invalidURL
        }

        let relPath = try normalizedRelativePath(urlPath: url.path)

        guard
            let baseURL = Bundle.main.resourceURL?.appendingPathComponent(
                AppConfig.Payload.bundleSubdirectory, isDirectory: true)
        else {
            throw PayloadSchemeError.missingResource
        }

        let fileURL = baseURL.appendingPathComponent(relPath, isDirectory: false)

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw PayloadSchemeError.missingResource
        }

        let attrs = try FileManager.default.attributesOfItem(atPath: fileURL.path)
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
        AppLogger.info(
            "[SchemeHandler] served \(relPath) mime=\(mime) bytes=\(data.count)",
            category: AppConfig.Log.schemeHandler)
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
}
