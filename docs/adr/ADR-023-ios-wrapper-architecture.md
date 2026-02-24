# ADR-023: iOS Wrapper Architecture (UIKit + WKWebView + Scheme Handler)

Date: 2026-02-19

## Context

We need a minimal native iOS wrapper to host a bundled Pyodide/WASM payload inside `WKWebView` and ship it via TestFlight/App Store. The wrapper must:

- Pass App Store review (no runtime code download, no general-purpose browser behavior).
- Serve `.wasm` files with correct MIME types (`application/wasm`).
- Provide a JS→native telemetry bridge for debugging.
- Be the simplest possible shell — it is not a feature-rich native app.

Research evaluated:

- **UI framework**: UIKit vs SwiftUI vs hybrid.
- **Asset serving**: `file://` URLs vs localhost HTTP server vs `WKURLSchemeHandler` (custom scheme).
- **Wrapper framework**: Pure UIKit vs Capacitor/Cordova/React Native.
- **Navigation posture**: open vs locked-down.

Key findings from research:

- `file://` loads commonly fail for `.wasm` due to missing/incorrect MIME types.
- Localhost HTTP servers violate the project's "no localhost dev mode" constraint.
- SwiftUI requires wrapping `WKWebView` in `UIViewRepresentable`, adding indirection for delegate access (`WKNavigationDelegate`, `WKURLSchemeHandler`). UIKit provides direct access.
- Hybrid frameworks (Capacitor, Cordova) increase App Review surface, debugging complexity, and dependency count without improving feasibility proof.

## Decision

1. **UIKit** (not SwiftUI) for the wrapper. Single `UIViewController` hosting a full-screen `WKWebView`.
2. **`WKURLSchemeHandler`** serves all payload assets via a custom scheme (`app://`). The native layer controls MIME types, especially `.wasm` → `application/wasm`.
3. **Deny-by-default `WKNavigationDelegate`** — only `app://` (custom scheme) and `about:blank` (required by WKWebView internally) are allowed. `http://`, `https://`, all other `about:` URLs, and unknown schemes are blocked. Redirects are evaluated as new decisions.
4. **`WKScriptMessageHandler`** telemetry bridge with a single handler name (`bridge`). Messages use a typed JSON envelope validated by a Decodable struct. Invalid messages are ignored (fail closed).
5. **WebContent process crash recovery** — `webViewWebContentProcessDidTerminate` logs the event and reloads the payload.
6. **Debug-only Simulator override** — an opt-in container override directory for updated payload assets, enabled only in Debug builds. ⚠️ **NOT YET IMPLEMENTED**.
7. **Bundle ID**: `com.kerifoundation.wallet`. **Minimum iOS**: 16.4.
8. **Composition over singletons** — policy objects (`WebNavigationPolicy`, `WebBridge`) are pure Swift types wired inside `viewDidLoad()` and held as strong `private var` ivars on the view controller. No constructor injection; no singletons. Unit-testable without `WKWebView`.

## Alternatives Rejected

| Alternative | Why Rejected |
|---|---|
| **SwiftUI** | Requires `UIViewRepresentable` wrapper for `WKWebView`; indirect access to `WKNavigationDelegate` and `WKURLSchemeHandler`; adds abstraction without benefit for a single-WebView wrapper |
| **Capacitor / Cordova / React Native** | Increases dependency surface, App Review risk, and debugging complexity; does not improve feasibility proof |
| **`loadFileURL`** (`file://`) | `.wasm` MIME type failures; CORS/origin restrictions; less control over response headers |
| **Localhost HTTP server** | Forbidden by project rules ("no localhost dev mode"); adds network stack complexity; ATS exceptions required |
| **SwiftUI app shell + UIKit WebView controller** | Mixed lifecycle (SwiftUI + UIKit hosting); additional indirection for marginal benefit in a single-screen app |

## Consequences

- Direct delegate access to all WKWebView APIs (navigation, scheme handler, script messages) without SwiftUI bridging layers.
- Battle-tested UIKit pattern for App Review — the most common and best-understood approach.
- Clear security boundary: web content is untrusted; native layer validates everything at the bridge.
- Policy objects are independently testable — unit tests don't need `WKWebView` instances.
- Trade-off: UIKit is less "modern" than SwiftUI, but delivers zero indirection for this use case.

## Status

Accepted.

## References

- [ADR-022](ADR-022-ios-wkwebview-pyodide-bundled-payload.md): Bundled payload decision (build determinism, no runtime fetch)
- [FINDINGS.md](../tasks/active/2026-02-19_ios-pyodide-appstore-feasibility/FINDINGS.md): Research findings and GO recommendation
- [KNOWN-GOOD-IOS-WKWEBVIEW-BASELINE.md](../tasks/active/2026-02-19_ios-pyodide-appstore-feasibility/KNOWN-GOOD-IOS-WKWEBVIEW-BASELINE.md): Baseline specification
- [iOS-WKWebView-Pyodide-Baseline-Research.md](../tasks/active/2026-02-19_ios-pyodide-appstore-feasibility/findings/iOS-WKWebView-Pyodide-Baseline-Research.md): Deep research report
- `.github/instructions/ios-swift-coding.instructions.md`: Swift coding standards derived from this decision
