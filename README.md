# Fort-ios

**Fort-ios** is the KERI Foundation iOS wallet app. It consists of two tightly coupled layers:

| Layer | What it is | Where it lives |
|-------|-----------|----------------|
| **Web payload** | Vite + TypeScript app that boots Pyodide (Python in WASM) and runs KERI crypto | `src/`, `public/`, `vite.config.ts` |
| **iOS wrapper** | UIKit app with a `WKWebView` that serves the web payload via a custom `app://` scheme handler | `xcodeproj/`, `KeriWallet/` |

The two layers communicate through a typed JS↔Swift bridge (`bridge-contract.json`). The web payload is bundled at build time and served entirely from the app bundle — no network fetches at runtime.

## Current transition note

Current operational reality and target architecture differ.

- Today, the live local scripts still build from the Fort-ios-local payload surface and stage generated output into `WebPayload/`.
- Today, wrapper deployment defaults to the FortWeb shared-payload path, while the Fort-ios-local payload remains available only behind `PAYLOAD_SOURCE=fort-ios` as a blocked seam-validation lane.
- The Fort-ios-local payload is now explicitly treated as a blocked proof-shell producer for wrapper deployment. `sync-payload.sh` and the Android refresh script fail closed if the generated manifest still reports `producer = fort-ios-local` or `payload_profile = proof-shell`, or if proof-shell markers remain in the generated payload.
- The Fort-ios-local Pyodide seam now assumes the upstream Pyodide 0.29 module contract: the worker is spawned as a module worker and loads `pyodide.mjs`. `build-payload.sh` runs a compatibility check before bundling so classic-worker or ESM-asset drift fails early.
- The target architecture remains one canonical shared web payload consumed by thin native wrappers.
- Treat `WebPayload/` as generated output only. Never edit it by hand.
- Treat the Fort-ios-local `src/` and `index.html` product surface as a transition or proof-shell lane until the shared-payload stabilization work is completed.
- The active stabilization direction is to move the wrappers onto one canonical shared payload baseline, likely FortWeb, and keep wrapper bundle directories generated and disposable.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-time setup](#2-first-time-setup)
3. [Daily workflow](#3-daily-workflow)
4. [Make targets reference](#4-make-targets-reference)
5. [npm scripts reference](#5-npm-scripts-reference)
6. [How the sync pipeline works](#6-how-the-sync-pipeline-works)
7. [Testing](#7-testing)
8. [Bridge contract](#8-bridge-contract)
9. [Repository layout](#9-repository-layout)
10. [Documentation index](#10-documentation-index)
11. [App Store compliance](#11-app-store-compliance)

---

## 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **mise** | latest | `curl https://mise.run \| sh` |
| **Node** | 22.12.0 | managed automatically by mise via `.tool-versions` |
| **Xcode** | 16.x | Mac App Store |
| **SwiftLint** | latest | `brew install swiftlint` |

> mise manages the Node version — you do not need to install Node manually.

### Python version constraint (Pyodide)

Pyodide currently ships Python **3.13**. Any Python code loaded in the web payload
(via `runPythonAsync`) must be compatible with 3.13 — do not use Python 3.14-only
features until Pyodide releases a 3.14 build. This applies regardless of what
keripy uses on the server side. See the
[2026-02-24 meeting](../../docs/meetings/raw-transcripts/2026-02/2026-02-24-pt-3.md)
for Sam's directive on this constraint.

---

## 2. First-time setup

Run these commands once after cloning. Order matters.

```sh
# 1. Install and activate the pinned Node version
curl https://mise.run | sh   # skip if mise is already installed
mise install                  # reads .tool-versions → installs Node 22.12.0

# 2. Install Node dependencies (uses lockfile — do NOT use npm install)
npm ci

# 3. Download Pyodide runtime + crypto wheels into public/pyodide/
#    (~200 MB, gitignored, only needed once per machine)
make pyodide
```

After these three steps the project is ready to build.

### Physical device quick start

- Connect the iPhone by USB, unlock it, trust the Mac if prompted, and finish pairing in Xcode.
- Enable Developer Mode when Xcode asks for it. The setting appears only after pairing starts.
- In Xcode, add the Apple account in Settings > Accounts, keep Automatically Manage Signing enabled, and assign the correct team.
- Run the app once over USB before switching to Wi-Fi deployment.
- Keep Low Power Mode off during development. Use Auto-Lock = 5 minutes as the default, and use Never only for charging bench sessions.
- Use a clear inventory name such as `KERI Dev iPhone` so the device is easy to identify in Xcode and logs.
- See [ios-xcode-workflow.instructions.md](docs/instructions/ios-xcode-workflow.instructions.md#physical-device-setup--readiness) for the full device-readiness guidance and the [one-page checklist](docs/instructions/ios-xcode-workflow.instructions.md#one-page-device-checklist).

---

## 3. Daily workflow

```sh
# 1. Edit source (TypeScript in src/, Swift in KeriWallet/)
# 2. If TypeScript changed, rebuild and sync into the iOS bundle
make sync

# 3. Lint everything
make lint       # SwiftLint (Swift sources)
make lint-ts    # tsc --noEmit (TypeScript)

# 4. Run the fast test suites
make test-ts    # Vitest unit tests  (~100 ms)
make test-e2e   # Playwright structural tests  (~5 s)

# 5. Build the iOS app for Simulator
make build

# 6. Run Swift tests
make test-swift

# 7. Open in Xcode and hit ⌘R
make open
```

Run `make help` at any time to list all available targets.

---

## 4. Make targets reference

| Target | What it does |
|--------|-------------|
| `make help` | List all targets with descriptions |
| `make setup` | Install Node dependencies (`npm ci`) |
| `make pyodide` | Download Pyodide v0.29.1 runtime + crypto wheels into `public/pyodide/` |
| `make sync` | Default wrapper packaging path: stage the FortWeb bundle into `WebPayload/` |
| `make sync-fortweb` | Explicitly stage the FortWeb bundle into `WebPayload/` |
| `make sync-fortios` | Run the blocked Fort-ios-local proof-shell lane (expected to fail closed for wrapper deployment) |
| `make build` | `xcodebuild` — build KeriWallet for iOS Simulator (Debug) |
| `make open` | Open `KeriWallet.xcodeproj` in Xcode |
| `make lint` | Run SwiftLint with `--strict` on all Swift sources |
| `make lint-ts` | Run `tsc --noEmit` to type-check TypeScript without emitting |
| `make test-swift` | Run Swift unit + UI tests on iOS Simulator via `xcodebuild test` |
| `make test-ts` | Run Vitest unit tests (`vitest run`) |
| `make test-e2e` | Run Playwright structural tests (excludes `@slow` Pyodide boot tests) |
| `make test-e2e-slow` | Run all Playwright tests including the 120 s Pyodide roundtrip |
| `make test-all` | Run `test-swift` + `test-ts` + `test-e2e` in sequence |
| `make bridge-check` | Verify `bridge-contract.ts` + `BridgeContract.swift` match JSON; `bridge:check` also validates Kotlin on disk |
| `make clean` | Remove `build/DerivedData`, `test-results/`, and `dist/` |

---

## 5. npm scripts reference

These are invoked internally by `make` targets. Use `make` for day-to-day work.

| Script | Command | Notes |
|--------|---------|-------|
| `npm run dev` | `vite` | Local dev server. iOS wrapper always loads bundled assets — not used in app. |
| `npm run build` | `vite build` (+ pre-build contract generation) | Development build. Skips manifest. |
| `npm run build:ci` | contract gen → `vite build` → manifest gen | **Canonical production build.** Writes `dist/build-manifest.json`. |
| `npm run bridge:check` | `gen-bridge-contract.mjs --check` | Fails if generated contract differs from committed `bridge-contract.json`. |
| `npm run typecheck` | `tsc --noEmit` | TypeScript type checking only, no output files. |
| `npm run test` | `vitest run` | Single-pass unit test run. |
| `npm run test:watch` | `vitest` | Watch mode for local development. |
| `npm run test:e2e` | `playwright test` | Playwright browser tests. |

---

## 6. How the sync pipeline works

The web payload cannot be hot-reloaded in the iOS Simulator — assets must live inside the app bundle. The sync pipeline automates this:

```
src/ + public/pyodide/  →  npm run build:ci  →  dist/  →  sync-payload.sh  →  WebPayload/
                                                                                    ↓
                                                                          Xcode bundles WebPayload/
                                                                          into the .app at build time
```

The pipeline is split into two scripts:

**Current-state note:** `make sync` now targets the FortWeb convergence path by default. The Fort-ios-local proof harness still exists for seam validation, but wrapper deployment should treat it as a blocked legacy producer.

**`build-payload.sh`** (shared, platform-agnostic core):

1. Runs `npm ci && npm run build:ci` to produce a deterministic `dist/`.
2. Verifies `dist/build-manifest.json` exists and has the required fields.

**`sync-payload.sh`** (iOS-specific, invoked by `make sync`) supports two modes:

- `PAYLOAD_SOURCE=fortweb`: default mainline convergence path; copies the FortWeb app, vendor, wheels, and runtime config into `WebPayload/fortweb/`, writes a root redirect page, and generates a bundle manifest with producer/runtime provenance.
- `PAYLOAD_SOURCE=fort-ios`: legacy proof-harness path; sources `build-payload.sh`, sanitises `python_stdlib.zip`, validates the blocked proof-shell contract, and then stages the local Vite output only if the guardrails permit it.

Useful targets:

- `make sync`: FortWeb default
- `make sync-fortweb`: explicit FortWeb packaging path
- `make sync-fortios`: explicit legacy proof-shell path, expected to fail closed for wrapper deployment

> **Rule:** Always run the appropriate sync target after changing payload source files. Never manually edit `WebPayload/`.

### Determinism contract

- `dist/` is build output → **must not be committed**.
- Toolchain is pinned via `.tool-versions` (mise) + `package-lock.json`.
- The canonical build command is `npm ci && npm run build:ci`.
- `dist/build-manifest.json` records: git SHA, lockfile hash, `dist/` content hash, Node/npm versions.

---

## 7. Testing

Fort-ios uses a three-layer test pyramid. See [ADR-030](docs/adr/ADR-030-ios-ts-testing-architecture.md) for the full rationale.

### Layer 1 — Swift unit tests (swift-testing)

Tests for Swift policy objects: `PayloadSchemeHandlerTests`, `AppConfigTests`, `WebBridgeTests`.

```sh
make test-swift
# or:
xcodebuild test \
  -project xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

The test targets use Swift 5.9 (`@Suite`, `@Test`, `#expect`, `#require`). The app target stays at Swift 5.0. New `.swift` files dropped into `KeriWalletTests/` are auto-included by Xcode 16's `PBXFileSystemSynchronizedRootGroup` — no `project.pbxproj` edits needed.

### Layer 2 — TypeScript unit tests (Vitest)

Tests for `worker_router.ts` dispatch logic and constant contracts. These run in a Node environment with no browser or WASM required.

```sh
make test-ts           # single pass (~100 ms)
npm run test:watch     # watch mode
```

Files: `src/__tests__/worker_router.test.ts`, `src/__tests__/constants.test.ts`, `src/__tests__/bridge_adapter.test.ts`, `tools/__tests__/payload-tooling.test.mjs`.

### Layer 3 — Playwright E2E tests

Structural browser tests that load the built app in Chromium headless and assert DOM invariants, JS error absence, and bridge contract alignment. The Pyodide roundtrip test is tagged `@slow` (120 s) and excluded from the default CI run.

```sh
make test-e2e          # structural tests only (~5 s)
make test-e2e-slow     # includes Pyodide boot roundtrip (~120 s)
```

Files: `playwright/app.spec.ts`.

### Run everything

```sh
make test-all   # test-swift + test-ts + test-e2e
```

---

## 8. Bridge contract

The JS↔native bridge is governed by a typed contract so all sides stay in sync.

- **Source of truth:** `bridge-contract.json` (committed)
- **Generated:** `src/bridge-contract.ts` (TypeScript), `KeriWallet/BridgeContract.swift` (Swift), and `generated/BridgeContract.kt` (Kotlin for Fort-android — **not committed**; run `npm run prebuild` or `npm ci` before Android `sync-payload.sh` copies it)
- **Verify sync:** `make bridge-check` runs `npm run bridge:check` (all three languages) then `git diff` on the **tracked** TS + Swift outputs only

The `prebuild` npm hook regenerates all contract files automatically before every build. In CI, `make bridge-check` must pass before tests run.

Message envelope shape (JS → Swift):

```json
{ "type": "lifecycle | js_error | log | crypto_result | unhandled_rejection", "timestamp": "<ISO 8601>", ... }
```

---

## 9. Repository layout

```
Fort-ios/
├── src/                        # TypeScript source
│   ├── main.ts                 # Entry point — mounts UI, boots worker
│   ├── bridge_adapter.ts       # Platform-agnostic bridge transport (iOS/Android/no-op)
│   ├── pyodide_worker.ts       # Web Worker — WASM bootstrap lifecycle
│   ├── worker_router.ts        # Pure message dispatch (testable without WASM)
│   ├── bridge-contract.ts      # Generated — do not edit by hand
│   └── __tests__/              # Vitest unit tests
├── generated/
│   └── BridgeContract.kt       # Generated Kotlin (gitignored — produced beside TS/Swift)
├── public/
│   └── pyodide/                # Gitignored — populated by `make pyodide`
├── playwright/
│   └── app.spec.ts             # Playwright E2E tests
├── tools/
│   ├── gen-bridge-contract.mjs # Generates bridge-contract.ts + BridgeContract.swift + BridgeContract.kt
│   └── gen-build-manifest.mjs  # Generates dist/build-manifest.json
├── scripts/
│   └── download-pyodide.sh     # Downloads Pyodide runtime + wheels
├── KeriWallet/                 # Swift source (symlinks into xcodeproj/)
│   ├── AppDelegate.swift
│   ├── AppLogger.swift         # OSLog-backed structured logging
│   ├── AppConfig.swift         # App-wide constants (schemes, limits, headers)
│   ├── BridgeContract.swift    # Generated — do not edit by hand
│   ├── PayloadSchemeHandler.swift  # WKURLSchemeHandler serving WebPayload/
│   ├── WebBridge.swift         # WKScriptMessageHandler — decodes bridge envelopes
│   ├── WebContainerViewController.swift
│   ├── WebNavigationPolicy.swift   # Deny-by-default navigation allowlist
│   └── PrivacyInfo.xcprivacy
├── KeriWalletTests/            # Swift unit tests (swift-testing)
├── KeriWalletUITests/          # Swift UI smoke test
├── xcodeproj/                  # Xcode project + mirrored Swift source
│   └── KeriWallet/
│       ├── KeriWallet/         # Mirror of KeriWallet/ above (symlinked)
│       └── KeriWallet.xcodeproj
├── WebPayload/                 # Generated wrapper bundle directory — Xcode bundles this
├── Config/
│   ├── Debug.xcconfig
│   └── Release.xcconfig
├── docs/
│   ├── adr/                    # Architecture Decision Records (ADR-022 → ADR-031)
│   └── instructions/           # Coding standards and how-to guides
├── bridge-contract.json        # Source of truth for the JS↔native bridge
├── build-payload.sh            # Platform-agnostic build core (sourced by sync scripts)
├── sync-payload.sh             # iOS-specific payload sync (invoked by `make sync`)
├── Makefile                    # All developer commands — start here
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json
└── .tool-versions              # Pins Node 22.12.0 via mise
```

> **Swift source symlinks:** `KeriWallet/*.swift` are symlinks into `xcodeproj/KeriWallet/KeriWallet/`. Edit either location — they are the same file. When adding a new Swift file, create it inside `xcodeproj/…/KeriWallet/`, then add a symlink: `ln -s ../xcodeproj/KeriWallet/KeriWallet/NewFile.swift KeriWallet/NewFile.swift`.

---

## 10. Documentation index

### Architecture Decision Records

| ADR | Title | Summary |
|-----|-------|---------|
| [ADR-022](docs/adr/ADR-022-ios-wkwebview-pyodide-bundled-payload.md) | Bundled payload decision | Why all assets are bundled at build time (no runtime download) |
| [ADR-023](docs/adr/ADR-023-ios-wrapper-architecture.md) | iOS wrapper architecture | UIKit + WKWebView + custom scheme handler design |
| [ADR-024](docs/adr/ADR-024-web-payload-build-bundling.md) | Web payload build & bundling | Vite config, deterministic build, `sync-payload.sh` |
| [ADR-025](docs/adr/ADR-025-ios-build-ci-developer-workflow.md) | iOS build/CI & developer workflow | VS Code + xcodebuild golden path, CI recipe |
| [ADR-026](docs/adr/ADR-026-ios-logging-strategy.md) | iOS logging strategy | `AppLogger` — privacy-aware, OSLog-backed |
| [ADR-027](docs/adr/ADR-027-keri-brand-identity-ui-integration.md) | KERI brand identity & UI integration | Colors, logo variants, iOS/web usage rules |
| [ADR-028](docs/adr/ADR-028-ios-swiftlint-type-inference-strategy.md) | SwiftLint & type-inference strategy | Lint rules, explicit type annotation policy |
| [ADR-029](docs/adr/ADR-029-fort-ios-subtree-extraction.md) | Fort-ios subtree extraction | How this repo was extracted from keri-notes as a git subtree |
| [ADR-030](docs/adr/ADR-030-ios-ts-testing-architecture.md) | iOS + TypeScript testing architecture | Three-layer test pyramid, Vitest/Playwright/swift-testing choices |
| [ADR-031](docs/adr/ADR-031-cross-platform-shared-web-payload.md) | Cross-platform shared web payload | Bridge adapter abstraction, Kotlin codegen, factored build pipeline |

### Coding standards

| File | Covers |
|------|--------|
| [ios-swift-coding.instructions.md](docs/instructions/ios-swift-coding.instructions.md) | Swift style, naming, DI patterns, testing with swift-testing |
| [ios-xcode-workflow.instructions.md](docs/instructions/ios-xcode-workflow.instructions.md) | Xcode build/CI workflow, physical device setup, one-page device checklist, anti-patterns catalog, `xcodebuild` reference |
| [ios-wkwebview-pyodide-bundled-payload.instructions.md](docs/instructions/ios-wkwebview-pyodide-bundled-payload.instructions.md) | WKWebView rules, scheme handler, worker architecture, telemetry bridge |
| [branding-visual-identity.instructions.md](docs/instructions/branding-visual-identity.instructions.md) | KERI brand colors, logo variants, Swift color constants, CSS custom properties |
| [pyodide-config.instructions.md](docs/instructions/pyodide-config.instructions.md) | Pyodide version, wheel sources, `unpackArchive` install pattern |
| [pyodide-event-loop.instructions.md](docs/instructions/pyodide-event-loop.instructions.md) | Asyncio event loop inside Pyodide WASM |
| [pyodide-js-bridge.instructions.md](docs/instructions/pyodide-js-bridge.instructions.md) | Python↔JavaScript data passing via Pyodide proxy objects |
| [pyodide-wasm-wheel-packaging.instructions.md](docs/instructions/pyodide-wasm-wheel-packaging.instructions.md) | Building WASM-compatible wheels (blake3, pychloride) |

---

## 11. App Store compliance

Two issues arise from the bundled Pyodide payload. Both are handled automatically.

### `itms-services` string in `python_stdlib.zip`

`urllib/parse.py` inside the Fort-ios-local `python_stdlib.zip` contains the string `itms-services`, which triggers Apple's automated binary scanner and causes App Store rejection. `sync-payload.sh` only applies this patch in the blocked `PAYLOAD_SOURCE=fort-ios` seam-validation lane.

To verify the patch was applied:

```sh
python3 -c "
import zipfile
z = zipfile.ZipFile('WebPayload/pyodide/python_stdlib.zip')
content = z.read('lib/python3.13/urllib/parse.py').decode()
print('patched:', 'itms-services' not in content)
"
# Should print: patched: True
```

### Privacy manifest

`KeriWallet/PrivacyInfo.xcprivacy` declares the Required Reason APIs used by the wrapper. Keep this up to date when adding new APIs. The first TestFlight upload will surface any missing declarations.

### Reviewer notes (include with every submission)

> The app runs a bundled, immutable WebAssembly payload. No executable code is downloaded at runtime. Navigation is locked to the `app://` custom scheme — this is not a browser.
