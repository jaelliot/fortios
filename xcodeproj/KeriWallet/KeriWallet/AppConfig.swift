//
//  AppConfig.swift
//
//  Single source of truth for all compile-time constants in KeriWallet.
//  Caseless enums prevent accidental instantiation — every value is `static let`.
//
//  This file consolidates magic numbers and duplicated string literals from:
//  PayloadSchemeHandler, WebContainerViewController, WebNavigationPolicy,
//  WebBridge, and AppLogger. If you need to change a scheme name, handler name,
//  MIME mapping, or brand color — change it here, once.
//

import UIKit

// MARK: - AppConfig

enum AppConfig {

    // MARK: - URL Scheme

    enum Scheme {
        /// Custom URL scheme registered with WKWebView for serving bundled assets.
        static let name = "app"
        /// Initial URL loaded by the web container.
        static let entryURL = "app://local/index.html"
        /// Schemes the navigation policy allows. `about` is needed for `about:blank`.
        static let allowedSchemes: Set<String> = ["app", "about"]
        /// The only `about:` URL we permit — WebKit uses it internally.
        static let aboutBlankURL = "about:blank"
        /// Default `index.html` path returned when the URL path is empty (root `/`).
        static let defaultIndexPath = "index.html"
    }

    // MARK: - JS ↔ Swift Bridge

    enum Bridge {
        /// WKScriptMessageHandler name — must match JS: `webkit.messageHandlers.bridge`.
        /// Delegates to the auto-generated `BridgeContract` for cross-language safety.
        static let handlerName = BridgeContract.handlerName
    }

    // MARK: - Bundled Web Payload

    enum Payload {
        /// Bundle subdirectory containing the Vite `dist/` output (synced by `sync-payload.sh`).
        static let bundleSubdirectory = "WebPayload"
        /// Maximum size (in bytes) of any single resource served by the scheme handler.
        /// 20 MiB — generous ceiling; Pyodide `.wasm` is ~12 MiB.
        static let maxResourceBytes = 20 * 1024 * 1024
    }

    // MARK: - HTTP Response

    enum HTTP {
        /// HTTP version used in synthesized `HTTPURLResponse`.
        static let version = "HTTP/1.1"

        /// Cross-origin isolation headers required by SharedArrayBuffer / Pyodide threading.
        static let crossOriginHeaders: [(String, String)] = [
            ("Cross-Origin-Opener-Policy", "same-origin"),
            ("Cross-Origin-Embedder-Policy", "require-corp"),
            ("Cross-Origin-Resource-Policy", "cross-origin")
        ]
    }

    // MARK: - MIME Types

    enum MIME {
        /// Extension → MIME mapping. Add new entries here rather than in a switch.
        private static let mimeTypes: [String: String] = [
            "html": "text/html",
            "js": "text/javascript",
            "mjs": "text/javascript",
            "css": "text/css",
            "json": "application/json",
            "wasm": "application/wasm",
            "woff2": "font/woff2",
            "png": "image/png",
            "svg": "image/svg+xml",
            "whl": "application/zip",
            "py": "text/plain",
            "toml": "application/toml",
            "zip": "application/zip"
        ]

        /// Map a file extension to its MIME content-type.
        static func contentType(for ext: String) -> String {
            mimeTypes[ext.lowercased()] ?? "application/octet-stream"
        }

        /// Whether a MIME type should get a `; charset=utf-8` suffix.
        static func isText(_ mime: String) -> Bool {
            mime.hasPrefix("text/") || mime == "application/json"
                || mime == "application/javascript"
        }
    }

    // MARK: - Logging

    enum Log {
        /// Reverse-DNS subsystem for OSLog. Matches `PRODUCT_BUNDLE_IDENTIFIER`.
        static let subsystem = "com.kerifoundation.wallet"
        /// Default category used when none is specified.
        static let defaultCategory = "app"

        // Per-module categories — use these at call sites instead of bare strings.
        static let schemeHandler = "SchemeHandler"
        static let webBridge = "WebBridge"
        static let webContainer = "WebContainer"
        static let webNav = "WebNav"
    }

    // MARK: - Brand Colors

    /// Background colors that match the CSS custom properties in `index.html`.
    /// Used by `WebContainerViewController` to set `underPageBackgroundColor`
    /// so the WKWebView never flashes white before the HTML paints.
    enum Brand {
        // Dark mode: --bg-dark: #0d0d0f  → RGB(13, 13, 15)
        static let darkBackground = UIColor(
            red: 13.0 / 255.0, green: 13.0 / 255.0, blue: 15.0 / 255.0, alpha: 1)
        // Light mode: --ref-neutral-10: #f7f8f4 → RGB(247, 248, 244)
        static let lightBackground = UIColor(
            red: 247.0 / 255.0, green: 248.0 / 255.0, blue: 244.0 / 255.0, alpha: 1)
    }

    // MARK: - Host Appearance

    /// The FortWeb-backed shell is currently light-only. Keep the native container,
    /// safe-area background, and status bar in the matching host appearance until
    /// the web payload exposes an appearance bridge to native.
    enum Appearance {
        static let interfaceStyle: UIUserInterfaceStyle = .light
        static let statusBarStyle: UIStatusBarStyle = .darkContent
        static let backgroundColor = Brand.lightBackground
    }
}
