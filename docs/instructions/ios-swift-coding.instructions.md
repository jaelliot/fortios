---
applyTo: "libs/Fort-ios/**/*.swift"
---

# iOS Swift Coding Standards (UIKit + WKWebView)

> Scope: UIKit-first app, iOS 16.4+, single WKWebView, `WKURLSchemeHandler`, strict navigation allowlist, minimal JS→native bridge.
>
> See also: `ios-wkwebview-pyodide-bundled-payload.instructions.md` (entrypoint), `ios-xcode-workflow.instructions.md` (build/CI).
>
> Linting: SwiftLint enforces these standards automatically. See ADR-028 (`docs/adr/ADR-028-ios-swiftlint-type-inference-strategy.md`).

---

## Zero-Tolerance Anti-Patterns (Blockers)

Any of these in a PR is a hard block. Do not merge.

| ❌ Anti-pattern | Why | ✅ Required pattern |
|---|---|---|
| Allow-all navigation in `WKWebView` | App becomes a general browser; phishing/data exfil risk | Deny-by-default allowlist in `WKNavigationDelegate` |
| Broad ATS bypass (`NSAllowsArbitraryLoads = true`) | Downgrades transport security app-wide | Keep ATS on; use narrow `NSExceptionDomains` only when unavoidable |
| Accepting arbitrary JS messages without validation | Bridge becomes a remote control surface | Validate handler name + strict schema; fail closed |
| Storing tokens/secrets in `UserDefaults` | Easy to extract; not designed for secrets | Use Keychain for secrets/tokens |
| Logging secrets/PII or full web message bodies | Leaks to crash reports and analytics | Redact; log only minimal metadata |
| Doing I/O on main thread / main actor | Jank, hangs, watchdog terminations | Offload work; UI updates on main actor only |
| Accepting deprecated TLS / insecure server trust | MITM risk | Default handling unless a documented, justified trust policy exists |
| Force unwraps (`!`) in production code | Crash on unexpected nil | Use `guard let` / `if let` with explicit error paths |
| `WKWebView.navigationDelegate` assigned without a strong owner | Delegate is `weak`; inline allocation is freed immediately, silently disabling the navigation lockdown | Store `navDelegate` as a `private var` on the view controller |
| `WKScriptMessageHandler` that references its owning `UIViewController` without `[weak self]` | `WKUserContentController.add(_:name:)` holds a **strong** reference to the handler (unlike `navigationDelegate`, which is `weak`). If the handler captures the VC strongly, a retain cycle forms: VC → webView → userContentController → handler → VC. Neither object can be deallocated. | Handler must be a self-contained type with no back-reference, **or** capture the VC as `[weak self]` in any closure inside the handler |
| Storing `decisionHandler` and calling it asynchronously | The `WKNavigationActionPolicy` `decisionHandler` closure must be called exactly once, synchronously, before the delegate method returns. Deferring it (storing and calling later) is undefined behavior — it crashes at runtime with a `WebKit` assertion. | Call `decisionHandler(.allow)` or `decisionHandler(.cancel)` on **every code path** within the delegate method body before returning |
| Using `os.Logger` directly, `print()`, or `NSLog()` | No level filtering; no project-wide privacy defaults; `os.Logger` injection pollutes component init signatures | Use `AppLogger.xxx(..., category:, privacy:)` — see Logging section below |
| Using `// TODO` or `// FIXME` comments to mark pending implementation | Silent plain-text comments are invisible to the build system. Xcode never surfaces them after the initial file edit; they silently drift and ship unimplemented. | Use `#warning("TODO: ...")` for pending stubs so Xcode generates a visible build-navigator warning on every compile. Use `#error("NOT IMPLEMENTED")` to gate compilation for code that **must not ship** unfinished. |

---

## Architecture & Composition

### ✅ Do

- Keep a thin `UIViewController` shell that delegates navigation policy, resource loading, message handling, and telemetry to **separate, testable Swift types**.
- Use composition; wire dependencies inside `viewDidLoad()` and store strong references as `private var` ivars.
- Keep policy logic in pure Swift types (`WebNavigationPolicy`, `WebBridge`) that are unit-testable without `WKWebView`.

### ❌ Don't

- Make a global singleton "ServiceLocator" for everything.
- Put networking, persistence, or crypto directly in `WKNavigationDelegate` callbacks.
- Create god-object view controllers.

### Example

```swift
final class WebContainerViewController: UIViewController {
    private var webView: WKWebView?
    // navDelegate must be a strong ivar — WKWebView.navigationDelegate is weak
    private var navDelegate: WebNavDelegate?
    private var bridge: WebBridge?

    override func viewDidLoad() {
        super.viewDidLoad()
        let policy = WebNavigationPolicy()
        let delegate = WebNavDelegate(policy: policy)
        self.navDelegate = delegate   // strong reference
        webView?.navigationDelegate = delegate
    }
}
```

---

## WKWebView Navigation Hardening

### ✅ Do

- Implement `WKNavigationDelegate` and decide policy for both `WKNavigationAction` (before load) and `WKNavigationResponse` (after headers).
- Use a **deny-by-default allowlist**:
  - Allowed schemes: `app` (custom scheme) and `about` (restricted to `about:blank` only, which WKWebView uses internally).
  - Allowed hosts: exact match (never suffix match like `*.example.com`).
- Treat **redirects** as full new navigation decisions.
- Handle `webViewWebContentProcessDidTerminate` as a recoverable failure (log + reload).

### ❌ Don't

- Allow arbitrary `http://` to make something "work".
- Allow all subdomains of a public domain.
- Check only the initial request URL while ignoring redirect chains.

### Example (deny-by-default)

```swift
struct WebNavigationPolicy {
    let allowedSchemes: Set<String>

    init(allowedSchemes: Set<String> = ["app", "about"]) {
        self.allowedSchemes = allowedSchemes
    }

    func isAllowed(url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        // about:blank is used internally by WKWebView; all other about: URLs are blocked
        if scheme == "about" { return url.absoluteString == "about:blank" }
        return allowedSchemes.contains(scheme)
    }
}

final class WebNavDelegate: NSObject, WKNavigationDelegate {
    private let policy: WebNavigationPolicy

    init(policy: WebNavigationPolicy) {
        self.policy = policy
        super.init()
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            AppLogger.error("[WebNav] blocked: missing URL", category: "WebNav")
            decisionHandler(.cancel)
            return
        }
        if policy.isAllowed(url: url) { decisionHandler(.allow); return }
        AppLogger.warning("[WebNav] blocked navigation: scheme=\(url.scheme ?? "(nil)")", category: "WebNav")
        decisionHandler(.cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        AppLogger.error("[WebNav] web content process terminated", category: "WebNav")
        webView.reload()
    }
}
```

---

## Custom Scheme Handler (`WKURLSchemeHandler`)

### ✅ Do

- Serve only app-owned, allowlisted resources from the bundle.
- Strict path parsing: normalize, reject `..` traversal, reject unexpected query params.
- Return explicit errors early; don't try to guess the resource.
- Explicit content-type mapping (hardcoded table, `.wasm` → `application/wasm`).
- Bound response sizes (no unbounded memory growth loading large files).

### ❌ Don't

- Map arbitrary filesystem paths into the scheme handler.
- Serve user documents or secrets to web content.
- Read whole blobs into memory without size limits.

### Minimum checks

- [ ] Path normalization
- [ ] No directory traversal (`..`, `%2e%2e`)
- [ ] Strict content-type mapping
- [ ] Bounded response size

---

## JavaScript → Native Bridge (`WKScriptMessageHandler`)

### ✅ Do

- Use **one** handler name (`bridge`) or a small, fixed allowlist.
- Validate:
  - handler name
  - `message.body` type
  - JSON schema for the expected payload (Decodable struct)
  - treat web content as **untrusted**
- Prefer **fire-and-forget telemetry**. If replies are needed, keep the reply protocol minimal.
- Remove script message handlers when tearing down the WebView (symmetric setup/teardown).

### ❌ Don't

- Execute arbitrary JS from native based on message contents (`evaluateJavaScript` with message-provided strings).
- Trust `message.body` — ever.
- Implement dozens of "commands" over `postMessage` (you've built a second unversioned API).
- Allow unbounded request/reply loops.

### Example (typed message validation)

```swift
struct TelemetryPayload: Decodable {
    let type: String
    let timestamp: String
    let message: String
    let stack: String?
}

final class WebBridge: NSObject, WKScriptMessageHandler {
    func userContentController(_ ucc: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "bridge" else { return }

        guard let json = message.body as? String,
              let data = json.data(using: .utf8),
              let payload = try? JSONDecoder().decode(TelemetryPayload.self, from: data) else {
            // Unknown shape → ignore. Do not crash.
            return
        }

        handleTelemetry(payload)
    }

    private func handleTelemetry(_ payload: TelemetryPayload) {
        // Record minimal, redacted telemetry.
    }
}
```

---

## Networking & ATS (App Transport Security)

### ✅ Do

- Keep ATS enabled by default.
- Use `NSExceptionDomains` for legacy endpoints you can't fix yet.
- Treat any ATS exception as **temporary with an exit plan**.

### ❌ Don't

- Set `NSAllowsArbitraryLoads` globally.
- Use insecure HTTP endpoints in production.
- Use `NSAllowsArbitraryLoadsInWebContent` unless absolutely unavoidable (it's a security downgrade).

---

## Secrets & Privacy

### ✅ Do

- Store secrets/tokens in **Keychain**.
- Use **LocalAuthentication** to gate sensitive operations.
- Request permissions at **point-of-need** with a clear rationale, never upfront.

### ❌ Don't

- Store credentials in `UserDefaults`, logs, analytics, or crash reports.
- Implement your own biometric pipeline (LocalAuthentication gives success/failure only).
- Log full URLs, headers, bridge message bodies, or user data.

---

## Concurrency & Threading

### ✅ Do

- Treat WebKit delegate callbacks as performance-sensitive; keep them fast.
- UI updates on the main actor only; heavier work off main.
- Make cancellation meaningful for long operations.
- Use `async`/`await` naturally; propagate `async` instead of converting.
- Mark any class that owns `@Published` UI state or that must only be touched from the main thread with `@MainActor`. This gives compiler-level enforcement instead of a fragile convention — no more scattered `DispatchQueue.main.async` callsites.

### ❌ Don't

- Block the main thread with JSON parsing, file reads, crypto, or network waits.
- Use semaphores or busy-wait to turn async into sync (deadlocks and priority inversions).
- Leave message handlers installed forever (leaks, unexpected behavior across sessions).
- Call `.sync` on a serial queue (including `DispatchQueue.main`) from a task already executing on that same queue — it blocks waiting for itself and deadlocks immediately. Use `.async` for any re-entrant dispatch onto a serial queue.

---

## Swift Language Safety

### ✅ Do

- Prefer `guard let` / `if let` with explicit error paths at every boundary.
- Use typed models (Decodable structs) for all external inputs: web messages, network JSON, deep links.
- Prefer `Result`-style flows or `throw` for failures instead of returning nil and hoping callers notice.
- Use typed error enums (`WebError.invalidURL`, `WebError.disallowedNavigation`).
- Collapse `switch` cases with identical bodies into a single multi-pattern case: `case .private, .sensitive:` instead of two separate cases with the same body. Reduces duplication and makes it obvious the two values are intentionally equivalent.
- **Prefer Swift-idiomatic type inference** for locals and obvious initializers. Do NOT add explicit types that the compiler already infers — SwiftLint's `redundant_type_annotation` rule enforces this. Write `let name = "hello"` not `let name: String = "hello"`. See ADR-028 (`docs/adr/ADR-028-ios-swiftlint-type-inference-strategy.md`).

### ❌ Don't

- Use `!` as a shortcut for "this should never be nil" in production code.
- Swallow errors silently in navigation policy, scheme handlers, or bridge handlers.
- Use `Any` without validation at trust boundaries.

### Example (fail closed)

```swift
enum WebError: Error {
    case invalidURL
    case disallowedNavigation
    case traversalAttempt
}

func requireURL(_ url: URL?) throws -> URL {
    guard let url else { throw WebError.invalidURL }
    return url
}
```

---

## Assertions & Invariant Checking

Use Swift's assertion family to make internal programmer errors fail loudly in Debug builds. These are **not** for validating external input — that's `guard`/`throw`. They are for invariants that should be impossible to violate given correct usage of a module.

| Directive | Active in Debug | Active in Release | Use when |
|---|---|---|---|
| `assert(condition, message)` | ✅ | ❌ (stripped) | Internal programmer contract; violation means a bug in calling code |
| `assertionFailure(message)` | ✅ | ❌ (stripped) | Unreachable branch that indicates a logic error |
| `precondition(condition, message)` | ✅ | ✅ | Unrecoverable invariant — continuing with a violated state would corrupt data or create a security hole |
| `preconditionFailure(message)` | ✅ | ✅ | Truly unreachable path in production (e.g., exhaustive switch default) |

### ✅ Do

```swift
// AppLogger: an empty category string produces an uncategorised OSLog entry
// and is always a programmer mistake, never a runtime condition.
private static func osLog(for category: String) -> OSLog {
    assert(!category.isEmpty, "AppLogger: category must not be empty — pass an explicit category string")
    // ...
}

// WebNavigationPolicy: an empty allowedSchemes set means nothing is navigable;
// this is always a misconfiguration, not a valid runtime state.
init(allowedSchemes: Set<String> = ["app", "about"]) {
    assert(!allowedSchemes.isEmpty, "WebNavigationPolicy: allowedSchemes must contain at least one scheme")
    self.allowedSchemes = allowedSchemes
}
```

### ❌ Don't

```swift
// ❌ assert on external / untrusted input — use guard/throw instead
assert(message.body is String, "Expected String body")  // Wrong: web content is untrusted

// ❌ precondition for programmer convenience errors — assert is sufficient
precondition(!category.isEmpty, "...")  // Only use precondition if an empty category in Release would cause a security or data-corruption bug
```

### Rule of thumb

- **External/untrusted input** (web messages, scheme request URLs, JSON) → `guard`/`throw`
- **Internal programmer contracts** (configuration values, module preconditions, unreachable enum cases) → `assert`/`assertionFailure`
- **Invariants that must hold in Release** (startup configuration, security-critical state) → `precondition`/`preconditionFailure`

---

## Memory Management

### The `WKUserContentController` Strong-Reference Trap

This is the most common source of `WKWebView` memory leaks. It is **not obvious** because it looks like the `navigationDelegate` pattern but behaves differently:

| API | Reference type | Implication |
|---|---|---|
| `webView.navigationDelegate = x` | **weak** | `x` must be stored as a strong ivar elsewhere or it's freed immediately |
| `userContentController.add(x, name:)` | **strong** | `x` is retained by the `WKUserContentController` for the lifetime of the WebView |

Because `add(_:name:)` strongly retains the handler, a cycle forms if the handler holds any strong reference back to the ViewController (directly or via a captured closure):

```
❌ Retain cycle:
ViewController (strong) → webView → userContentController (strong) → handler → ViewController
```

The ViewController can never be deallocated. `deinit` never runs. The handler is never removed.

**Two safe patterns:**

```swift
// ✅ Pattern 1: Self-contained handler (no back-reference)
// Handler is a pure type that logs/stores data but never calls back to the VC.
final class WebBridge: NSObject, WKScriptMessageHandler {
    // No reference to WebContainerViewController — safe.
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        AppLogger.info("[WebBridge] \(message.name)", category: "WebBridge")
    }
}

// ✅ Pattern 2: [weak self] when the handler must call back to the VC
final class WebBridge: NSObject, WKScriptMessageHandler {
    weak var viewController: WebContainerViewController?   // weak — breaks the cycle

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let vc = viewController else { return }  // VC already gone — ignore
        vc.handleBridgeMessage(message)
    }
}
```

> **Current code uses Pattern 1.** `WebBridge` is self-contained. If `WebBridge` ever needs to trigger native VC behaviour, switch to Pattern 2 and declare the back-reference `weak`.

### ✅ Do

- Use `[weak self]` in any closure where a long-lived object (WebView, session, timer) might retain the controller.
- Explicitly remove script message handlers in `deinit` (`WKUserContentController.removeScriptMessageHandler(...)`).
- Keep ownership clear: WKWebView and its delegates must not create retain cycles.
- Any new `WKScriptMessageHandler` implementation must be audited: does it have a strong path back to a parent ViewController?

### ❌ Don't

- Capture `self` strongly in closures stored by long-lived WebKit objects.
- Add a `WKScriptMessageHandler` that holds a strong reference to the owning ViewController.
- Accumulate script handlers or user scripts without a matching `removeScriptMessageHandler` teardown.

---

## Testing Strategy

### ✅ Do

- **Unit test policy objects** (pure Swift, no WebView dependency):
  - Navigation allowlist decisions (`WebNavigationPolicyTests`)
  - Custom scheme handler path parsing + MIME mapping
  - Bridge message validation/deserialization
  - Debug-only override gating
- **One integration harness test** that spins up the WebKit container and verifies:
  - Disallowed navigation is cancelled
  - Allowed navigation proceeds
  - Invalid bridge messages are ignored
- **One UI smoke test** that verifies:
  - App launches
  - Payload loads to expected ready state

### ❌ Don't

- Make UI tests the primary coverage for security policies.
- Share mutable global state across tests (flaky fast).
- Skip testing policy objects because "it's just a wrapper".

---

## Accessibility

### ✅ Do

- Support Dynamic Type and large text sizes.
- Maintain WCAG-style contrast targets.
- Add VoiceOver labels to key native controls.
- Avoid gesture-only core functionality.

### ❌ Don't

- Hard-code font sizes or fixed layouts that clip at large text.
- Auto-dismiss critical UI on timers.

---

## App Review / Release Risks

### ✅ Do

- Ensure app is stable, complete, and not a "beta" submission (use TestFlight for betas).
- Ensure metadata matches actual behavior (no hidden/dormant features).
- Use public APIs only — no private WebKit internals.

### ❌ Don't

- Ship hidden modes or features enabled via remote toggles without disclosure.
- Rely on private API behavior that could break or cause rejection.
- Rapidly drain battery or generate heat from unrelated background work.

---

## Brand Colors

All brand colors are defined once and referenced symbolically. See `branding-visual-identity.instructions.md` for full palette and anti-patterns. Rationale: ADR-027 (`docs/adr/ADR-027-keri-brand-identity-ui-integration.md`).

- **AccentColor** (`Assets.xcassets/AccentColor.colorset`): Set to `#61783e` (KERI Olive Green). Tints system controls app-wide.
- **Programmatic colors**: Define in a single `BrandColors.swift` alongside `AppLogger.swift`:

```swift
import UIKit

extension UIColor {
    static let keriGreen = UIColor(red: 0x61/255.0, green: 0x78/255.0, blue: 0x3E/255.0, alpha: 1)
    static let keriGold  = UIColor(red: 0x98/255.0, green: 0x6C/255.0, blue: 0x32/255.0, alpha: 1)
}
```

### ✅ Do

- Use `UIColor.keriGreen` / `.keriGold` or `Color.accentColor` in SwiftUI.
- Reference `AccentColor` via asset catalog for system tinting.

### ❌ Don't

- Hardcode hex values (`UIColor(red: 0.38, ...)`) at individual call sites.
- Approximate brand colors — use exact hex values from the SVG source.
- Use brand colors for diagram/documentation palette (those are WCAG-governed, separate concern).

---

## Logging

All logging uses `AppLogger` — a static, privacy-aware wrapper over `os_log`. See ADR-026 (`docs/adr/ADR-026-ios-logging-strategy.md`) for rationale.

### API

```swift
AppLogger.verbose("Trace detail", category: "SchemeHandler")
AppLogger.debug("Processing item: \(id)", category: "WebBridge")
AppLogger.info("Payload loaded", category: "WebContainer")
AppLogger.warning("Retry \(n) of 3", category: "WebNav")
AppLogger.error("Load failed", error: err, category: "SchemeHandler")
```

All parameters except the message have defaults (`category: "app"`, `privacy: .auto`). The `category` string maps to a per-component `OSLog` instance (lazily cached) — matching the category strings in `WebContainerViewController.viewDidLoad()`.

### Privacy modes

| Mode | Debug | Release | Use for |
|---|---|---|---|
| `.auto` *(default)* | Visible | `<private>` | Most log messages |
| `.public` | Visible | Visible | Version strings, non-sensitive status |
| `.private` | `<private>` | `<private>` | Usernames, IDs, URLs with tokens |
| `.sensitive` | `<private>` | `<private>` | Auth tokens, passwords, private keys |

### Level filtering

- **Debug builds**: `.verbose` and above — all logs visible.
- **Release builds**: `.info` and above — `.verbose` and `.debug` are never evaluated (zero CPU cost via `@autoclosure`).

### Category convention

| Component | `category:` string |
|---|---|
| `WebContainerViewController` | `"WebContainer"` |
| `WebBridge` | `"WebBridge"` |
| `PayloadSchemeHandler` | `"SchemeHandler"` |
| `WebNavDelegate` | `"WebNav"` |

### ✅ Do

- Pass `category:` explicitly at every call site — never rely on the `"app"` default in component files.
- Use `.sensitive` for anything that could be used to impersonate a user or access protected resources.
- Keep message strings terse; don't log full request/response bodies.

### ❌ Don't

- Use `print()`, `NSLog()`, or `os.Logger` directly — `AppLogger` is the only logging API.
- Inject `Logger` (or `AppLogger`) as an init parameter — `AppLogger` is static; no injection needed.
- Mark non-sensitive data `.private` or `.sensitive` unnecessarily (hides useful debug info).

---

## Pending-Implementation Markers

Use Swift compiler directives — not comments — to mark unfinished work. Comments are invisible to the build system; directives produce visible warnings or errors on every build.

| Directive | When to use | Behavior |
|---|---|---|
| `#warning("TODO: ...")` | Stub is safe to run but incomplete; must be finished before shipping | Yellow warning in Xcode's build navigator on every compile |
| `#error("NOT IMPLEMENTED — must not ship")` | Stub would produce incorrect or insecure behavior at runtime | **Blocks compilation**; CI fails hard |

### ✅ Do

```swift
func fetchFromWitness(aid: String) {
    #warning("TODO: implement KERIA HTTP round-trip; returns stub for now")
    // stub
}
```

```swift
func verifyKEL(kel: [Any]) {
    #error("NOT IMPLEMENTED — KEL verification must pass before this file can compile for release")
}
```

### ❌ Don't

```swift
// TODO: implement this later   ← invisible after first write; silently drifts
func fetchFromWitness(aid: String) { }
```

### Scope

- **ADR-023 Decision 6 (Simulator debug override)** and the app lifecycle + nav timing telemetry stubs documented in `ios-wkwebview-pyodide-bundled-payload.instructions.md` must carry `#warning` when they are first stubbed in Swift source.
- Remove the `#warning` only when the feature is fully implemented and verified.

> **SwiftLint enforcement:** The default `todo` rule flags `// TODO:` and `// FIXME:` comments automatically, reinforcing the `#warning` requirement above. `#warning("TODO: ...")` compiler directives are NOT flagged — they are the approved pattern.

---

## Linting (SwiftLint)

All Swift source is linted with [SwiftLint](https://github.com/realm/SwiftLint). See ADR-028 (`docs/adr/ADR-028-ios-swiftlint-type-inference-strategy.md`) for rationale.

- **Config**: `libs/Fort-ios/.swiftlint.yml`
- **Run**: `make lint` from `libs/Fort-ios/`
- **VS Code**: `vknabel.vscode-swiftlint` extension runs on save
- **CI**: `swiftlint lint --config .swiftlint.yml --strict`

### Key rules

| Rule | Type | What it catches |
|------|------|-----------------|
| `force_unwrapping` | Opt-in | `!` force unwraps in production code |
| `redundant_type_annotation` | Opt-in | Over-specified types (`let x: Int = 5`) |
| `force_cast` | Default | `as!` force casts |
| `force_try` | Default | `try!` force attempts |
| `todo` | Default | `// TODO:` and `// FIXME:` comments (use `#warning` instead) |

### Auto-generated file exclusion

Files generated by codegen tools (e.g., `BridgeContract.swift` from `gen-bridge-contract.mjs`) are excluded in `.swiftlint.yml`. When adding new codegen outputs, add them to the `excluded:` list.

### Inline suppression

Use `// swiftlint:disable:next <rule>` sparingly and only with a justifying comment:

```swift
// Required for Objective-C interop — UIKit returns implicitly unwrapped optional
// swiftlint:disable:next force_unwrapping
let window = UIApplication.shared.windows.first!
```

---

## Pre-Merge Checklist (Fast)

Before merging any Swift PR:

- [ ] Navigation is deny-by-default with explicit allowlist
- [ ] JS bridge validates schema and fails closed
- [ ] No secrets in `UserDefaults` or logs
- [ ] Sensitive values in log calls use `privacy: .sensitive` or `.private`; no raw tokens/keys in `.auto` logs
- [ ] No `print()`, `NSLog()`, or `os.Logger` direct usage — `AppLogger` only
- [ ] ATS exceptions are minimized and documented
- [ ] No main-thread I/O
- [ ] No force unwraps (`!`) in production paths
- [ ] Accessibility: Dynamic Type + VoiceOver labels on key controls
- [ ] Script message handlers have symmetric setup/teardown
- [ ] All closures that capture `self` use `[weak self]`; any `WKScriptMessageHandler` with a back-reference to the owning ViewController declares it `weak`
- [ ] No `// TODO` or `// FIXME` plain-text comments — pending stubs use `#warning("TODO: ...")` so Xcode surfaces them on every build
- [ ] `make lint` passes with zero warnings (`--strict` mode)
