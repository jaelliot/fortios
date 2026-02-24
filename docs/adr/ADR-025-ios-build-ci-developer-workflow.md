# ADR-025: iOS Build/CI & Developer Workflow

Date: 2026-02-19

## Context

The iOS wrapper project at `libs/Fort-ios/` needs a development workflow that:

- Works from VS Code terminals (not just the Xcode GUI).
- Is deterministic and CI-friendly (GitHub Actions).
- Supports the bundled payload sync model (ADR-024).
- Handles code signing for local dev, TestFlight, and (future) App Store distribution.
- Produces measurable, reproducible builds.

Research evaluated three workflow models:

1. **Xcode-GUI-only**: Edit, build, test, and sign entirely within Xcode.
2. **CLI-first (xcodebuild)**: Edit in VS Code, build/test/archive via `xcodebuild` in the terminal.
3. **Hybrid**: VS Code for editing, Xcode for debugging and Simulator management.

The team's primary editor is VS Code. CI must use `xcodebuild` regardless. Xcode GUI introduces workflow drift when it is the only build path.

## Decision

1. **VS Code is the primary editor** for both Swift and web payload (TypeScript). Swift LSP support via SourceKit-LSP.

2. **`xcodebuild` CLI is the golden path** for builds, tests, and archives. All commands are documented in `ios-xcode-workflow.instructions.md` with explicit flags:
   - `-destination 'platform=iOS Simulator,name=iPhone 15'`
   - `-derivedDataPath build/DerivedData`
   - `-resultBundlePath build/TestResults.xcresult`
   - `-showBuildTimingSummary` (for performance measurement)

3. **Xcode GUI is used only when CLI cannot substitute**:
   - Simulator management (boot, screenshots, device selection)
   - Code signing troubleshooting (Automatically Manage Signing UI)
   - Instruments profiling (memory, CPU, energy)
   - LLDB debugging with breakpoints
   - `LaunchScreen.storyboard` editing

4. **`.xcconfig` files for build settings** (`Config/Debug.xcconfig`, `Config/Release.xcconfig`). Build settings are not managed exclusively through the Xcode UI / `.pbxproj`. Always use `$(inherited)` when augmenting flags.

5. **Scheme is shared and uses Dependency Order** (never Manual Order). Sanitizers (Address, Thread) enabled in Debug/Test actions, disabled in Release.

6. **Test pyramid**:
   - **Many unit tests**: Pure Swift policy objects (allowlist, scheme handler, bridge validation, Debug-override gating).
   - **Few integration tests**: WebKit container harness (navigation blocked, bridge works).
   - **One UI smoke test**: App launches, payload loads to ready state.

7. **Signing strategy**:
   - **Local dev**: Personal paid developer account (Jay's) with automatic code signing.
   - **TestFlight/App Store**: Organizational account (Sam's, future) with `xcodebuild archive` + `exportArchive`.
   - **CI**: Certificates/profiles stored as GitHub Secrets, imported via `security` CLI.

8. **CI (GitHub Actions)**:
   - Pin Xcode via `DEVELOPER_DIR`.
   - Resolve SwiftPM, build, test with explicit flags.
   - Upload `.xcresult` and `build-manifest.json` as artifacts.
   - `set -euo pipefail` in all scripts.

9. **`DEVELOPER_DIR` pinning** in CI to prevent toolchain drift:
   ```sh
   export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
   ```

## Alternatives Rejected

| Alternative | Why Rejected |
|---|---|
| **Xcode-GUI-only workflow** | Not CI-friendly; not reproducible across machines; introduces workflow drift between local dev and CI |
| **SwiftUI Previews as primary iteration** | Not applicable — the app is a single WKWebView, not a multi-screen UI; previews add no value for WebView content |
| **Xcode Cloud instead of GitHub Actions** | Vendor lock-in; the rest of the project CI is GitHub Actions; adds another service to manage |
| **Fastlane for build automation** | Over-engineering for a single-target app; `xcodebuild` is sufficient and has zero dependencies |
| **CocoaPods for dependency management** | SwiftPM is Apple's recommended tool; CocoaPods adds a Ruby dependency and `Podfile.lock` drift risk |

## Consequences

- Same `xcodebuild` commands work identically on developer machines and in GitHub Actions CI.
- Minimal Xcode GUI dependency — developers who prefer VS Code are not blocked.
- `.xcconfig` files are diffable and reviewable in PRs (unlike `.pbxproj` mutations).
- Build timing is measurable and reproducible via `-showBuildTimingSummary`.
- Trade-off: Swift LSP (SourceKit-LSP) in VS Code is less polished than Xcode's native editor (autocomplete, refactoring). Developers may occasionally need Xcode for complex refactors.
- Trade-off: Xcode must still be installed (provides the SDK, simulators, and `xcodebuild`). It is a required tool, just not the primary editing environment.

## Status

Accepted.

## Amendments

### 2026-02-20 — Dual source tree eliminated via symlinks

`KeriWallet/*.swift` are now **relative symlinks** into `xcodeproj/KeriWallet/KeriWallet/`. The `cp KeriWallet/*.swift xcodeproj/...` step documented in the original workflow is eliminated. Edit either location — they are the same file.

Adding a new file: create it in `xcodeproj/KeriWallet/KeriWallet/`, then add a matching symlink in `KeriWallet/`.

### 2026-02-20 — `Makefile` added as canonical CLI entry point

`libs/Fort-ios/Makefile` exposes all common developer commands (`make help`, `make setup`, `make sync`, `make build`, `make test`, `make open`, `make clean`). All `xcodebuild` commands remain unchanged — the Makefile wraps them for discoverability. `make help` is the recommended first step for new teammates.

## References

- [ADR-023](ADR-023-ios-wrapper-architecture.md): iOS wrapper architecture (what is being built)
- [ADR-024](ADR-024-web-payload-build-bundling.md): Web payload build & bundling (the payload this workflow consumes)
- `.github/instructions/ios-xcode-workflow.instructions.md`: Detailed command reference and anti-patterns
- `.github/instructions/ios-swift-coding.instructions.md`: Swift coding standards applied during development
