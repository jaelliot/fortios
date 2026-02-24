# ADR-026: iOS Logging Strategy — AppLogger (Privacy-Aware, OSLog-backed)

Date: 2026-02-20

## Context

The iOS wrapper initially used `os.Logger` (Apple's structured logger, available since iOS 14) injected as a constructor dependency into every component (`WebBridge`, `PayloadSchemeHandler`, `WebNavDelegate`). `WebContainerViewController` acted as a logger factory, instantiating four separate `Logger` objects (one per component category) and passing them into each component.

Three problems with this pattern:

1. **No log-level filtering.** `os.Logger` does not expose a concept of log levels in its Swift API that can be gated at compile or runtime. Verbose debug logs cannot be muted in Release builds without manual `#if DEBUG` wrappers at every call site.

2. **No privacy controls.** `os.Logger`'s string interpolation privacy specifier syntax (`\(value, privacy: .private)`) requires Swift 5.7+ string interpolation decorators and is verbose. There is no project-wide default; each call site must remember to annotate sensitive values. Unannotated interpolations default to `.auto` in newer OSLog but `.private` (redacted) in older runtime — inconsistent and error-prone depending on iOS version.

3. **Injection complexity.** Every component that logs must accept a `Logger` init parameter. This propagates boilerplate throughout the codebase and makes components harder to instantiate in tests. The four-logger factory in `WebContainerViewController` is machinery that exists solely to inject OSLog category labels.

Research evaluated a community-authored wrapper ("The Overkill Logger", Dimas Wisodewo, 2025) that addresses all three issues using only Apple's `os_log` C API (no third-party dependencies).

## Decision

1. **Replace all `os.Logger` injection** with a static `AppLogger` class backed by `os_log`. No component receives a logger as an init parameter. All logging is done via static calls: `AppLogger.info("...", category: "SchemeHandler")`.

2. **`AppLogger` wraps `LogLevel` and `LogPrivacy` enums:**
   - `LogLevel`: `.verbose`, `.debug`, `.info`, `.warning`, `.error` — comparable by raw value for filtering.
   - `LogPrivacy`: `.public`, `.private`, `.sensitive`, `.auto` (default — public in Debug, private in Release).

3. **Build-time log-level gate:**
   ```swift
   #if DEBUG
   private static let minimumLogLevel: LogLevel = .verbose
   #else
   private static let minimumLogLevel: LogLevel = .info
   #endif
   ```
   Verbose and debug logs are compiled out in Release builds via `@autoclosure` — the message string is not evaluated if the level is below the minimum (zero CPU cost).

4. **Per-component OSLog categories** are preserved via a lazy `[String: OSLog]` cache keyed by the `category` parameter. Each unique category string maps to exactly one `OSLog` instance. Call sites pass `category: "SchemeHandler"` etc. Console.app category filtering is unchanged.

5. **Subsystem** is the static string `"com.kerifoundation.wallet"` — not `Bundle.main.bundleIdentifier` which can vary across test hosts and extensions.

6. **Debug metadata injection:** In Debug builds, each formatted message is prefixed with an ISO 8601 timestamp, file name, line number, and function name. In Release builds, only the message is logged (performance).

7. **File lives at** `KeriWallet/AppLogger.swift` (canonical) and `xcodeproj/KeriWallet/KeriWallet/AppLogger.swift` (Xcode-compiled mirror).

8. **`import os` is removed** from all four component files. Only `AppLogger.swift` imports `OSLog`.

## Alternatives Rejected

| Alternative | Why Rejected |
|---|---|
| **Keep `os.Logger` injection** | Verbose boilerplate, no level filtering, no project-wide privacy defaults, no `@autoclosure` perf optimization |
| **CocoaLumberjack** | ~200KB third-party dependency for a wrapper that OSLog already provides; adds CocoaPods/SwiftPM dependency management overhead |
| **SwiftyBeaver** | Third-party SDK, requires account for cloud logging features; overkill for a minimal wrapper app |
| **OSLog structured logging API** (`Logger.info("\(value, privacy: .private)")`) | Available iOS 14+ but requires per-callsite privacy decoration; no level filtering; no `@autoclosure` |
| **Pure `#if DEBUG` / `print()`** | No OSLog integration, no Console.app visibility, no privacy, disappears entirely in Release |

## Consequences

- All component `init` signatures simplified: `WebBridge()`, `PayloadSchemeHandler()`, `WebNavDelegate(policy:)` — no logger parameter.
- `WebContainerViewController.viewDidLoad()` no longer contains logger factory code.
- Call sites gain explicit privacy control with a simple default (`.auto`).
- Release builds automatically mute `.verbose` and `.debug` logs.
- Per-component Console.app filtering preserved via `category:` parameter and lazily cached `OSLog` instances.
- Sensitive values (tokens, keys, PII) can be marked `.sensitive` and are always redacted.

## Status

Accepted.

## References

- [ADR-023](ADR-023-ios-wrapper-architecture.md): iOS wrapper architecture
- "The Overkill Logger" by Dimas Wisodewo — https://github.com/dimaswisodewo/The-Overkill-Logger
- Medium article: https://medium.com/@dimaswisodewo98/the-overkill-logger-building-a-privacy-aware-high-performance-logging-system-for-ios-3a58000bf62d
- `.github/instructions/ios-swift-coding.instructions.md`: Swift coding standards including logging conventions
