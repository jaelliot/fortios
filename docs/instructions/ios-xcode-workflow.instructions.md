---
applyTo: "libs/Fort-ios/**,*.xcodeproj/**,*.xcworkspace/**"
---

# iOS Xcode Workflow & CI Standards

> Scope: Xcode 16.x, iOS 16.4+, SwiftPM-only, GitHub Actions + `xcodebuild`.
> VS Code is the primary editor. Xcode GUI is used only for Simulator management, signing, and Instruments.
>
> See also: `ios-wkwebview-pyodide-bundled-payload.instructions.md` (entrypoint), `ios-swift-coding.instructions.md` (Swift patterns).

---

## Zero-Tolerance Anti-Patterns (Blockers)

| ❌ Anti-pattern | Why | ✅ Required pattern |
|---|---|---|
| Scheme Build Order = Manual Order | Deprecated; serializes builds; underutilizes CPU | Use Dependency Order |
| Run Script phases without Inputs/Outputs | Runs every build; serializes tasks; breaks incremental correctness | Declare inputs/outputs or `.xcfilelist` |
| "Optimize" without timing data | You optimize the wrong thing | Use Build With Timing Summary / `-showBuildTimingSummary` |
| Commit-pin SwiftPM dependencies by default | Apple says "isn't recommended" except exceptional cases | Use version requirements |
| Not committing `Package.resolved` | Teammates/CI resolve different dependency graphs | Commit `Package.resolved` |
| Suppressing warnings globally | Hides defects and security issues | Keep warnings on; fix root causes |
| Hardcoded developer-machine paths | Breaks on other machines and CI | Use relative paths and `DEVELOPER_DIR` |
| CI without explicit `-destination` | CI picks inconsistent simulators/runtimes | Explicit simulator destination always |
| `.pbxproj`-only configuration | Hard to review; high drift risk | Use `.xcconfig` files |
| Not pinning Xcode in CI | Toolchain drift | Set `DEVELOPER_DIR` explicitly |

---

## Project Creation Recipe

When creating the Xcode project for `libs/Fort-ios/`:

- **Template**: Xcode → App
- **Interface**: UIKit (not SwiftUI)
- **Language**: Swift
- **Storage/Extras**: None
- **Product Name**: `KeriWallet`
- **Bundle Identifier**: `com.kerifoundation.wallet`
- **Minimum Deployment**: iOS 16.4
- **Team**: Personal developer account (Jay's paid account)

Remove storyboard-based launch if using programmatic UI. Keep `LaunchScreen.storyboard` for App Store compliance (Apple requires it).

---

## VS Code + Xcode Workflow (Golden Path)

The daily development loop:

```
0. make pyodide       (one-time: download Pyodide runtime + wheels)
1. Edit Swift/TypeScript in VS Code
2. make sync          (if web payload changed)
3. make lint          (SwiftLint — catch style/safety issues early)
4. make build         (build for Simulator)
5. make test          (run tests)
6. make open → ⌘R    (run on Simulator via Xcode)
```

> Run `make help` from `libs/Fort-ios/` to see all available targets.
> The Makefile's simulator destination (e.g., `iPhone 17 Pro`) may differ from
> the `iPhone 15` placeholder used in `xcodebuild` examples below.

### When to use Xcode GUI

- Simulator management (boot, install, launch, screenshots)
- Code signing troubleshooting (Automatically Manage Signing)
- Instruments profiling (memory, CPU, energy)
- Interface Builder for `LaunchScreen.storyboard` only
- Debugging with LLDB (breakpoints in Swift)

### When NOT to use Xcode GUI

- Editing Swift source (use VS Code)
- Running builds (use `xcodebuild` in terminal)
- Managing build settings (use `.xcconfig` files)
- CI workflows (use `xcodebuild` + GitHub Actions)

---

## Build Configuration (`.xcconfig`)

Use `.xcconfig` files under `libs/Fort-ios/Config/`:

### `Debug.xcconfig`

```xcconfig
// Debug-specific settings
OTHER_SWIFT_FLAGS = $(inherited) -DDEBUG
SWIFT_ACTIVE_COMPILATION_CONDITIONS = $(inherited) DEBUG
```

### `Release.xcconfig`

```xcconfig
// Release-specific settings
SWIFT_OPTIMIZATION_LEVEL = -O
```

### Rules

- **Always** use `$(inherited)` when augmenting flags.
- **Never** encode all build settings inside the `.pbxproj` only.
- CI-specific overrides go in a separate `CI.xcconfig` if needed.

---

## Scheme Configuration

- **Build Order**: Dependency Order (never Manual Order — it's deprecated).
- **Debug/Test actions**: Enable sanitizers (Address Sanitizer, Thread Sanitizer).
- **Release action**: Disable sanitizers and heavy diagnostics.
- Share the scheme (check "Shared" in Manage Schemes) so CI can find it.

---

## Run Script Build Phases

### Rules

- **Always** declare Input Files and Output Files (or use `.xcfilelist`).
- Prefer fewer scripts — consolidate where possible.
- Emit Xcode-parsable warnings/errors:

```sh
echo "error: sync-payload.sh failed. Run it manually."
exit 1
```

### Payload sync script phase (optional)

If adding `sync-payload.sh` as a Run Script phase:

- Input Files: `$(SRCROOT)/../ios-pyodide-payload/dist/build-manifest.json`
- Output Files: `$(SRCROOT)/WebPayload/build-manifest.json`
- Script: `"${SRCROOT}/sync-payload.sh"`
- Gate to Debug configuration only (Release uses pre-synced payload).

---

## SwiftPM Dependencies

- Prefer **version requirements** (semver ranges).
- **Commit** `Package.resolved` to the repo.
- Do **not** use Commit pinning routinely (Apple says "isn't recommended").
- If you need an exact pin for an exceptional case, document why in a code comment.

---

## `xcodebuild` Command Reference

> **Simulator not found?** If `xcodebuild` fails with "no matching destination", the named simulator
> runtime is not installed. Discover what is available:
> ```sh
> xcrun simctl list devices available
> ```
> Then install the runtime via Xcode → Settings → Platforms → iOS.

### Discover schemes

```sh
xcodebuild -list -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj
```

### Build (Simulator)

```sh
xcodebuild build \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -derivedDataPath build/DerivedData
```

### Test (Simulator)

```sh
xcodebuild test \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -resultBundlePath build/TestResults.xcresult \
  -derivedDataPath build/DerivedData
```

### Build timing summary

```sh
xcodebuild build \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -showBuildTimingSummary
```

### Inspect build settings

```sh
xcodebuild -showBuildSettings \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -configuration Debug
```

### Resolve SwiftPM dependencies

```sh
xcodebuild -resolvePackageDependencies \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet
```

### Archive + Export (release)

```sh
xcodebuild archive \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/KeriWallet.xcarchive

xcodebuild -exportArchive \
  -archivePath build/KeriWallet.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist
```

> `ExportOptions.plist` is **not committed** — it contains your Apple Team ID.
> Copy `ExportOptions.plist.example` → `ExportOptions.plist` and fill in your values.
> See `libs/Fort-ios/ExportOptions.plist.example`.

---

## Simulator Management (`simctl`)

```sh
# List available simulators
xcrun simctl list

# Boot a simulator
xcrun simctl boot "<UDID>"

# Install app
xcrun simctl install booted path/to/KeriWallet.app

# Launch app
xcrun simctl launch booted com.kerifoundation.wallet

# Open custom URL
xcrun simctl openurl booted "app://local/index.html"

# Erase simulator (clean slate)
xcrun simctl erase booted
```

---

## CI (GitHub Actions)

### Minimal workflow requirements

1. Pin Xcode version via `DEVELOPER_DIR`.
2. Resolve SwiftPM dependencies.
3. Build with explicit `-destination`.
4. Test with explicit `-destination` and `-resultBundlePath`.
5. Upload `.xcresult` as artifact.

### Example CI commands

```sh
set -euo pipefail

export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
xcodebuild -version

xcodebuild -resolvePackageDependencies \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet

xcodebuild test \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -derivedDataPath build/DerivedData \
  -resultBundlePath build/TestResults.xcresult

# SwiftLint (must pass before merge)
cd libs/Fort-ios && swiftlint lint --config .swiftlint.yml --strict
```

### CI anti-patterns

- ❌ Depending on "Shared" schemes that aren't actually checked in.
- ❌ Piping without `set -o pipefail` (swallows real exit codes).
- ❌ Using `xcpretty` without preserving the raw log (loses diagnostics).
- ❌ Caching DerivedData aggressively (fragile invalidation).

### Artifacts to upload

- `build/TestResults.xcresult`
- Build logs (if captured)
- `dist/build-manifest.json` from the payload build

---

## Signing Strategy

### Local development

- **Automatic code signing** via personal paid developer account.
- Team: select in Xcode → Signing & Capabilities.
- No manual provisioning profiles needed for Simulator.

### TestFlight / App Store

- Requires organizational Apple Developer account (Sam's, future).
- Use `xcodebuild archive` + `exportArchive` with `ExportOptions.plist`.
- Include reviewer notes about bundled WASM payload.

### CI signing

- Store certificates/profiles as GitHub Secrets.
- Use `security` CLI to import into CI keychain.
- Or use Apple's `altool` / `notarytool` for notarization.

---

## Incremental Build Performance

### ✅ Do

- Measure first: `xcodebuild -showBuildTimingSummary`.
- Confirm scheme Build Order is Dependency Order.
- Keep targets small; extract reusable code into local Swift packages if it improves isolation.

### ❌ Don't

- Add targets/modules "for performance" without measuring. Target sprawl can be worse.
- Grow a single "Utilities" target into a monolith.
- Run scripts without Inputs/Outputs (they serialize and run every time).

---

## Testing Strategy

### Test pyramid

- **Many unit tests**: Policy objects (allowlist, scheme handler parsing, bridge validation)
- **Few integration tests**: WebKit container harness (navigation blocked, bridge works)
- **One UI smoke test**: App launches, payload loads to ready state

### Test commands

```sh
# Run all tests
xcodebuild test \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -destination 'platform=iOS Simulator,name=iPhone 15'

# Run specific test class
xcodebuild test \
  -project libs/Fort-ios/xcodeproj/KeriWallet/KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -only-testing:KeriWalletTests/WebNavigationPolicyTests
```

### Rules

- Preserve `.xcresult` bundles in CI.
- Never make UI tests the primary correctness gate.
- Don't use global shared state across tests.

---

## Release / Archive Discipline

### ✅ Do

- Validate Release behavior (no debugger) on real devices when possible.
- Use `archive` + export workflows to catch signing, entitlements, and packaging issues early.
- Include `PrivacyInfo.xcprivacy`.

### ❌ Don't

- Treat Debug Simulator runs as equivalent to Release builds.
- Ship without testing the archived `.ipa`.

---

## Xcode Anti-Patterns Catalog (Fast PR Scan)

1. **Manual build order in schemes** → Dependency Order instead.
2. **"Optimizing" without timing data** → Measure first with Build Timing Summary.
3. **Run scripts with no inputs/outputs** → Declare `.xcfilelist` or explicit files.
4. **Dozens of Run Script phases** → Consolidate or move to pre-commit tooling.
5. **`.pbxproj`-only configuration** → Use `.xcconfig` files.
6. **Suppressing warnings globally** → Fix warnings; enforce warnings-as-errors in CI.
7. **Commit-pinning SwiftPM by default** → Version requirements.
8. **Not committing `Package.resolved`** → Always commit it.
9. **Not pinning Xcode in CI** → `DEVELOPER_DIR`.
10. **Unspecified `-destination` in CI** → Always explicit.
11. **Losing exit codes in log pipes** → `set -o pipefail`.
12. **UI tests as primary coverage** → Unit test policy objects instead.
13. **Debug runs treated as Release validation** → Archive and test the `.ipa`.
14. **No SwiftLint in CI** → Run `swiftlint lint --strict` before merge; catches force unwraps, TODO comments, and style violations automatically.
