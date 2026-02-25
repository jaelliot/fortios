# ADR-030: iOS & TypeScript Testing Architecture

Date: 2026-02-24

## Context

The `libs/Fort-ios/` codebase has three testable layers and only one test file:

- **Swift** (`xcodeproj/KeriWallet/KeriWalletTests/`) — 1 file, 3 XCTest tests on `WebNavigationPolicy`
- **TypeScript** (`src/`) — 0 tests
- **Integration** (browser-level) — 0 tests

The Gemini Deep Research output (`Fort-ios-Testing-Strategy-Research.md`) evaluated Vitest vs Jest, swift-testing vs XCTest, and Playwright vs XCUITest. This ADR records the decisions made and the implementation completed on 2026-02-24.

Research confirmed:
- `PayloadSchemeHandler` uses `Bundle.main` and `FileManager.default` directly — not injectable without refactoring
- `pyodide_worker.ts` tightly couples WASM bootstrap with message dispatch — message routing untestable without the WASM runtime
- `WebBridgeEnvelope` is `Decodable` — directly unit-testable with `JSONDecoder`
- `WebNavigationPolicyTests.swift` (3 XCTest tests) must remain green throughout all changes

## Decision

### 1. Swift: Hybrid swift-testing + XCTest

- **Existing tests stay as XCTest.** `WebNavigationPolicyTests.swift` and `KeriWalletUITests.swift` are not migrated.
- **All new unit tests use `import Testing`** (swift-testing, available in Xcode 15+).
- Both frameworks coexist in the same `KeriWalletTests` target with no configuration changes.
- `SWIFT_VERSION` on test targets only is bumped to `5.9` for swift-testing language mode compatibility.

New test files added:
- `AppConfigTests.swift` — constant consistency checks (swift-testing)
- `PayloadSchemeHandlerTests.swift` — MIME, path normalisation, size guard, COOP/COEP headers (swift-testing)
- `WebBridgeTests.swift` — envelope decoding, BridgeContract cross-language alignment (swift-testing)

### 2. TypeScript: Vitest

Vitest is chosen over Jest for TypeScript unit tests because:
- **Zero config duplication** — reuses Vite's resolver, transform, and plugin configuration via `vitest/config`.
- **`vi.mock()` API** — first-class mocking with type-safe interface stubs.
- No Babel transform needed (TypeScript handled identically to Vite build).

Test files: `src/__tests__/worker_router.test.ts`, `src/__tests__/constants.test.ts`.

### 3. TypeScript: `worker_router.ts` extraction

`pyodide_worker.ts` is split into two responsibilities:

| File | Responsibility |
|------|---------------|
| `pyodide_worker.ts` | WASM bootstrap (`boot()`), `self.importScripts`, `self.onmessage` lifecycle |
| `worker_router.ts` | Pure command dispatch — `handleBlake3Hash`, `handleSign`, `handleVerify`, `routeMessage` |

The injection boundary is `PyodideInterface` from `types.ts`. Tests pass a `vi.fn()` mock; production code passes the live Pyodide instance.

The `init` command handling is intentionally NOT in `worker_router.ts` — it triggers WASM bootstrap and belongs in the boot lifecycle.

### 4. E2E: Playwright (headless Chromium)

Playwright is chosen over XCUITest for browser-level E2E because:
- Bridge messages (`postMessage`) are directly observable from JavaScript; XCUITest is blind to them.
- `vite preview` + `playwright.config.ts` `webServer` block starts the preview server automatically.
- COOP/COEP headers are injected via `vite.config.ts` `preview.headers` — same values as `AppConfig.HTTP.crossOriginHeaders`.
- Structural tests (DOM structure, `handleNativeCommand` exposure, MIME types) are fast (<5s total).
- Slow Pyodide roundtrip test is tagged `@slow` and excluded from default `make test-e2e`.

### 5. `PayloadSchemeHandler` DI refactor

`PayloadSchemeHandler` now accepts a `payloadDirectory: URL?` parameter (default `nil` → resolves to `Bundle.main`). Tests inject a `FileManager.default.temporaryDirectory`-backed test fixture. No change to call sites (`WebContainerViewController` passes no arguments).

`loadResource(for:)` is changed from `private` to `internal` — `@testable import KeriWallet` in test targets accesses it without requiring `WKURLSchemeTask` mock infrastructure.

### 6. Makefile targets

| Target | Command | Notes |
|--------|---------|-------|
| `make test-swift` | `xcodebuild test ...` | Replaces `make test` |
| `make test-ts` | `npm run test` (vitest run) | New |
| `make test-e2e` | build + playwright `--grep-invert @slow` | New |
| `make test-e2e-slow` | build + playwright (all) | New; 120s timeout |
| `make test-all` | test-swift + test-ts + test-e2e | New |
| `make bridge-check` | bridge:check + git diff | New |
| `make lint-ts` | `npm run typecheck` (tsc --noEmit) | New |

## Alternatives Rejected

| Alternative | Why Rejected |
|---|---|
| **Migrate existing XCTest tests to swift-testing** | Zero benefit, non-zero risk. `WebNavigationPolicyTests.swift` is the CI gate — touching it risks false failures during transition |
| **Jest instead of Vitest** | Requires separate Babel/Jest transform config; duplicates what Vite already does; no advantage over Vitest in a Vite project |
| **XCUITest for bridge E2E** | Cannot observe `webkit.messageHandlers.postMessage` calls; requires running on physical/Simulator device; bridge messages are opaque to XCUITest |
| **Injectable `Bundle` parameter instead of `payloadDirectory: URL?`** | `Bundle` has no testable init that points to an arbitrary directory; `URL?` is simpler and cleanly represents the override intent |
| **Put `init` command in `worker_router.ts`** | `init` triggers `importScripts` (WASM bootstrap); including it in the router would make the router untestable without the full WASM environment |

## Consequences

- 24 TypeScript unit tests pass in ~100ms (`npm run test`)
- 7 Playwright structural E2E tests pass in ~4.6s (`make test-e2e`)
- 3 existing XCTest tests remain green — `make test-swift` is the Swift CI gate
- New Swift unit tests (swift-testing) exercised via Xcode 16 / `xcodebuild test`
- `worker_router.ts` is the stable target for future crypto operation tests
- `PayloadSchemeHandler.payloadDirectory` injection pattern is available for future Swift unit tests that validate actual file serving

## Status

Accepted.

## References

- [ADR-023](ADR-023-ios-wrapper-architecture.md): iOS wrapper architecture
- [ADR-025](ADR-025-ios-build-ci-developer-workflow.md): Build/CI workflow (Makefile patterns)
- [ADR-028](ADR-028-ios-swiftlint-type-inference-strategy.md): SwiftLint rules that apply to test files
- `docs/tasks/active/2026-02-24_ios-ts-testing-suite/IMPLEMENTATION-PLAN.md`: Implementation checklist
- `Fort-ios-Testing-Strategy-Research.md`: Gemini Deep Research input to this decision
