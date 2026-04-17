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
            AppLogger.info(
                "[WebContainer] crypto_result id=\(payload.id) error=\(payload.error ?? "nil")",
                category: AppConfig.Log.webContainer
            )
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
        #if DEBUG
            webView.isInspectable = true
        #endif

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            // Full-bleed: CSS env(safe-area-inset-top) handles the Dynamic Island gap.
            webView.topAnchor.constraint(equalTo: view.topAnchor),
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

        AppLogger.info(
            "[WebContainer] loading initial payload", category: AppConfig.Log.webContainer)
        webView.load(URLRequest(url: url))

        // Demo: trigger a Swift-initiated crypto op after a delay.
        // Pyodide boots asynchronously in the Web Worker; the delay is conservative
        // for Debug builds on the Simulator. In production, drive this from
        // a lifecycle:done bridge message instead.
        #if DEBUG
            DispatchQueue.main.asyncAfter(deadline: .now() + AppConfig.Demo.cryptoDispatchDelay) { [weak self] in
                self?.runCryptoOperation([
                    "id": UUID().uuidString,
                    "type": AppConfig.Demo.operationType,
                    "data": AppConfig.Demo.hashData
                ])
            }
        #endif
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
        webView.evaluateJavaScript("window.handleNativeCommand(\(json))") { _, error in
            if let error = error {
                AppLogger.error(
                    "[WebContainer] evaluateJavaScript error: \(error)",
                    category: AppConfig.Log.webContainer)
            }
        }
    }
}
