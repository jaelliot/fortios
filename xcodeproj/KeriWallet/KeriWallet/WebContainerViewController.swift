import UIKit
import WebKit

final class WebContainerViewController: UIViewController {
    private var webView: WKWebView?
    private var navDelegate: WebNavDelegate?
    private var bridge: WebBridge?

    override func viewDidLoad() {
        super.viewDidLoad()

        overrideUserInterfaceStyle = AppConfig.Appearance.interfaceStyle
        view.backgroundColor = AppConfig.Appearance.backgroundColor

        let userContentController = WKUserContentController()

        let bridge = WebBridge()
        userContentController.add(bridge, name: AppConfig.Bridge.handlerName)
        self.bridge = bridge

        // Receive crypto operation results from Pyodide worker via JS bridge
        bridge.onCryptoResult = { [weak self] payload in
            _ = self  // suppress unused warning; callers can extend this
            if let error = payload.error, !error.isEmpty {
                AppLogger.warning(
                    "[WebContainer] crypto_result id=\(payload.id) error",
                    category: AppConfig.Log.webContainer)
                return
            }

            AppLogger.debug(
                "[WebContainer] crypto_result id=\(payload.id) ok",
                category: AppConfig.Log.webContainer)
        }

        let config = WKWebViewConfiguration()
        config.userContentController = userContentController

        config.setURLSchemeHandler(PayloadSchemeHandler(), forURLScheme: AppConfig.Scheme.name)

        let webView = WKWebView(frame: .zero, configuration: config)
        self.webView = webView

        let navDelegate = WebNavDelegate(policy: WebNavigationPolicy())
        self.navDelegate = navDelegate
        webView.navigationDelegate = navDelegate

        // Prevent white flash before HTML paints. Must be set before load.
        // underPageBackgroundColor uses a dynamic provider to match CSS bg in both modes.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.underPageBackgroundColor = AppConfig.Appearance.backgroundColor
        // CSS env(safe-area-inset-*) owns all insets — prevent UIKit double-counting.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // Keep visual scale at 1.0 so fixed tab bars align with hit testing (pinch/double-tap zoom otherwise offsets taps).
        webView.scrollView.minimumZoomScale = 1.0
        webView.scrollView.maximumZoomScale = 1.0
        webView.scrollView.bouncesZoom = false
        #if DEBUG
            webView.isInspectable = true
        #endif

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            // UIKit safe area handles the Dynamic Island / status bar gap natively.
            // The native view.backgroundColor fills behind the status bar.
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        loadInitialURL(webView: webView)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        AppConfig.Appearance.statusBarStyle
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: AppConfig.Bridge.handlerName)
    }

    private func loadInitialURL(webView: WKWebView) {
        guard let url = URL(string: AppConfig.Scheme.entryURL) else {
            AppLogger.error(
                "[WebContainer] invalid initial URL", category: AppConfig.Log.webContainer)
            return
        }

        AppLogger.notice(
            "[WebContainer] loading initial payload entry=\(AppConfig.Scheme.entryURL)",
            category: AppConfig.Log.webContainer)
        webView.load(URLRequest(url: url))
    }

    /// Dispatch a crypto operation to the Pyodide Web Worker via JS.
    /// Results are delivered asynchronously as `crypto_result` bridge messages
    /// handled by `bridge.onCryptoResult`.
    ///
    /// - Parameter command: Dictionary matching the `WorkerInbound` protocol
    ///   defined in `pyodide_worker.ts`. Required keys: `id` (String), `type` (String).
    ///   Optional keys depend on `type`:
    ///   - `blake3_hash`:  `data` (String)
    ///   - `sign`:         `message` (String)
    ///   - `verify`:       `message`, `signature`, `publicKey` (all String)
    func runCryptoOperation(_ command: [String: Any]) {
        guard let webView = webView else {
            AppLogger.warning(
                "[WebContainer] runCryptoOperation: webView not ready",
                category: AppConfig.Log.webContainer)
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: command),
            let json = String(data: data, encoding: .utf8)
        else {
            AppLogger.error(
                "[WebContainer] runCryptoOperation: JSON serialization failed",
                category: AppConfig.Log.webContainer)
            return
        }
        let js = """
        (function() {
            if (typeof window.handleNativeCommand !== 'function') {
                return '__bridge_missing__';
            }
            window.handleNativeCommand(\(json));
            return '__bridge_called__';
        })();
        """

        webView.evaluateJavaScript(js) { result, error in
            if let error = error {
                AppLogger.error(
                    "[WebContainer] evaluateJavaScript error: \(error)",
                    category: AppConfig.Log.webContainer)
                return
            }

            if let marker = result as? String, marker == "__bridge_missing__" {
                AppLogger.warning(
                    "[WebContainer] handleNativeCommand not available; skipping debug crypto dispatch",
                    category: AppConfig.Log.webContainer)
            }
        }
    }
}
