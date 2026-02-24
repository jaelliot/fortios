import Foundation
import WebKit

struct WebNavigationPolicy {
    let allowedSchemes: Set<String>

    init(allowedSchemes: Set<String> = AppConfig.Scheme.allowedSchemes) {
        self.allowedSchemes = allowedSchemes
    }

    func isAllowed(url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "about" {
            return url.absoluteString == AppConfig.Scheme.aboutBlankURL
        }
        return allowedSchemes.contains(scheme)
    }
}

final class WebNavDelegate: NSObject, WKNavigationDelegate {
    private let policy: WebNavigationPolicy

    init(policy: WebNavigationPolicy) {
        self.policy = policy
        super.init()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            AppLogger.error("[WebNav] blocked: missing URL", category: AppConfig.Log.webNav)
            decisionHandler(.cancel)
            return
        }

        if policy.isAllowed(url: url) {
            decisionHandler(.allow)
            return
        }

        AppLogger.warning(
            "[WebNav] blocked navigation: scheme=\(url.scheme ?? "(nil)")",
            category: AppConfig.Log.webNav)
        decisionHandler(.cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        AppLogger.error("[WebNav] web content process terminated", category: AppConfig.Log.webNav)
        webView.reload()
    }
}
