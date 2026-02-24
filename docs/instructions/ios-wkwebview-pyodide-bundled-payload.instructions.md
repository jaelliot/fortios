---
applyTo: "libs/Fort-ios/**"
---

# iOS WKWebView + Pyodide (Bundled-Only) — Project Rules

> Authoritative entrypoint for all iOS development in this workspace.
> For Swift coding patterns, see `ios-swift-coding.instructions.md`.
> For Xcode build/CI workflow, see `ios-xcode-workflow.instructions.md`.

## Architecture references

- **ADR-022**: Bundled payload decision (deterministic build, no runtime fetch)
- **ADR-023**: iOS wrapper architecture (UIKit + WKWebView + scheme handler)
- **ADR-024**: Web payload build & bundling strategy (`sync-payload.sh`)
- **ADR-025**: iOS build/CI & developer workflow (VS Code + xcodebuild)
- **ADR-026**: iOS logging strategy (`AppLogger` — privacy-aware, OSLog-backed)
- **ADR-027**: KERI brand identity & UI integration (colors, logo variants, usage rules)

---

## Brand assets

The app uses official KERI Foundation branding. See `branding-visual-identity.instructions.md` for colors, logo selection, and anti-patterns.

- **Brand colors**: KERI Olive Green `#61783e`, KERI Gold `#986c32`
- **App icon**: `SymbolLogo` (triquetra, square)
- **Web payload header**: `FullLogo.svg` (triquetra + "KERI" text)
- **Loading state**: `SymbolLogo.svg` (centered, subtle animation)
- **SVG assets**: Copied into `public/` at build time, served via `app://` scheme handler
- **CSS**: Use `--keri-green` / `--keri-gold` custom properties, never hardcode hex

Rationale: ADR-027 (`docs/adr/ADR-027-keri-brand-identity-ui-integration.md`).

---

## Repo layout

```
projects/
├── ios-pyodide-payload/     # Web payload (Vite + TypeScript)
│   ├── src/                 # TypeScript source
│   ├── public/              # Static assets (logos, Pyodide runtime)
│   ├── dist/                # Build output (NOT committed)
│   ├── scripts/             # Build scripts (download-pyodide.sh)
│   ├── tools/               # Build tooling (gen-build-manifest.mjs)
│   ├── package.json
│   ├── package-lock.json
│   ├── .tool-versions       # Node version pin (mise)
│   └── vite.config.ts
│
├── ios-wrapper/             # Native iOS shell (UIKit + Swift)
│   ├── KeriWallet/          # Canonical Swift source (edit here)
│   │   ├── AppDelegate.swift
│   │   ├── AppLogger.swift
│   │   ├── SceneDelegate.swift
│   │   ├── WebContainerViewController.swift
│   │   ├── PayloadSchemeHandler.swift
│   │   ├── WebNavigationPolicy.swift
│   │   ├── WebBridge.swift
│   │   └── PrivacyInfo.xcprivacy
│   ├── KeriWalletTests/     # Unit tests (policy objects) — canonical
│   ├── KeriWalletUITests/   # UI smoke test (launch + payload load) — canonical
│   ├── xcodeproj/           # Xcode project (Xcode compiles from here)
│   │   └── KeriWallet/
│   │       ├── KeriWallet/  # Mirror of KeriWallet/ above (keep in sync)
│   │       └── KeriWallet.xcodeproj
│   ├── WebPayload/          # Synced payload dist/ (via sync-payload.sh)
│   ├── WebPayloadOverride/  # Debug-only local override (⚠️ NOT YET IMPLEMENTED — see WebPayloadOverride/README.md)
│   ├── Config/
│   │   ├── Debug.xcconfig
│   │   └── Release.xcconfig
│   ├── Makefile             # CLI entry point (make help)
│   └── sync-payload.sh      # Canonical payload sync script
```

> **Single source of truth**: `KeriWallet/*.swift` are **symlinks** into `xcodeproj/KeriWallet/KeriWallet/`.
> Edit either location — they are the same file. No copy step is needed.
> When adding a new Swift file, create it inside `xcodeproj/KeriWallet/KeriWallet/`,
> then add a matching symlink: `ln -s ../xcodeproj/KeriWallet/KeriWallet/NewFile.swift KeriWallet/NewFile.swift`

**Naming**:
- Xcode project: `KeriWallet`
- Bundle ID: `com.kerifoundation.wallet`
- Custom URL scheme: `app` (e.g., `app://local/index.html`)

---

## Non-negotiables (Safe Mode)

These are **hard gates**. Violations are blocking.

1. **No runtime code download**: The shipped app must not fetch Python wheels, JS bundles, or WASM modules from the network. Everything executable is bundled at build time.
2. **No localhost dev mode**: The iOS wrapper must never switch to `http://localhost` for development. Not even in Debug builds.
3. **No private APIs**: Do not use private WebKit APIs to mark custom schemes as secure or bypass platform restrictions.
4. **No Service Workers**: Skip Service Workers entirely. Bundled assets satisfy offline requirements.
5. **No general-purpose browsing**: The app must not navigate to arbitrary URLs. Navigation allowlist is deny-by-default.

---

## Web payload build determinism

- Web payload lives in `libs/Fort-ios/`.
- `dist/` is build output and must **not** be committed.
- Toolchain pin: `.tool-versions` (`mise`), plus `package-lock.json`.
- Canonical build command: `npm ci && npm run build:ci`.
- `npm install` is **not** allowed in CI.
- Build must write `dist/build-manifest.json` that includes:
  - git SHA
  - lockfile hash
  - `dist/` content hash
  - tool versions

---

## Pyodide asset pipeline

### One-time download (`make pyodide`)

`scripts/download-pyodide.sh` downloads Pyodide v0.29.1 runtime assets and crypto wheels into `public/pyodide/`. Run once per machine (or after a clean):

```sh
# From libs/Fort-ios/
make pyodide       # preferred
# Or directly:
cd ../ios-pyodide-payload && ./scripts/download-pyodide.sh
```

Downloads:
- Pyodide core runtime (`pyodide.js`, `pyodide.asm.wasm`, `pyodide.asm.js`, `pyodide-lock.json`, `python_stdlib.zip`)
- blake3 WASM wheel (copied from `libs/keriwasm/static/`)
- pychloride pure-Python wheel (downloaded from PyPI)

Output is gitignored. Re-run with `--force` to re-download.

### Wheel installation at runtime (`unpackArchive`)

The Pyodide Web Worker installs bundled wheels using `pyodide.unpackArchive()` — **not** micropip. This is the only mechanism that works with the `app://` custom URL scheme.

```typescript
// In pyodide_worker.ts
async function installWheel(url: string): Promise<void> {
  const resp = await fetch(url);          // JS fetch() → app:// scheme handler
  const buffer = await resp.arrayBuffer();
  pyodide.unpackArchive(buffer, 'wheel'); // Extracts directly into site-packages
}
```

**Why not micropip?** micropip's internal `pyfetch()` cannot reach `app://` scheme URLs (different fetch pathway than JS `fetch()`), and `emfs:` local path prefixes fail micropip's URL parser. See ADR-022 amendment for details.

---

## Payload sync workflow (`sync-payload.sh`)

The canonical mechanism for getting the web payload into the iOS wrapper:

```sh
# From libs/Fort-ios/
make sync          # preferred — runs sync-payload.sh via Makefile
./sync-payload.sh  # equivalent, direct
```

The script must:

1. Build the web payload from `libs/Fort-ios/` using the pinned toolchain (`npm ci && npm run build:ci`).
2. Bundle Pyodide assets: copy `public/pyodide/` (runtime, stdlib, crypto wheels) into `dist/pyodide/`.
3. Verify `dist/build-manifest.json` exists and contains expected fields.
4. Sanitize `itms-services` in `python_stdlib.zip` (prevents automated App Store rejection).
5. Clean stale files from `libs/Fort-ios/WebPayload/`.
6. Copy `dist/` contents into `libs/Fort-ios/WebPayload/`.
7. Verify expected files exist (`index.html`, `build-manifest.json`).
8. Print a summary (manifest SHA, file count).

Xcode may include a Run Script phase that invokes `sync-payload.sh`, but the **single source of truth** is the repo script — CI and local builds must use the same script.

---

## WKWebView asset serving

- Serve all payload assets through a custom scheme (`app://`) handled by `WKURLSchemeHandler`.
- The scheme handler serves files from the `WebPayload/` directory in the app bundle.
- MIME types must be explicitly mapped. Minimum required:

| Extension | Content-Type |
|-----------|-------------|
| `.html` | `text/html` |
| `.js` | `text/javascript` |
| `.css` | `text/css` |
| `.json` | `application/json` |
| `.wasm` | `application/wasm` |
| `.woff2` | `font/woff2` |
| `.png` | `image/png` |
| `.svg` | `image/svg+xml` |

- The scheme handler must reject directory traversal attempts (`..`, `%2e%2e`).
- Response sizes must be bounded (no unbounded memory growth).
- Return explicit errors for missing resources (do not guess).

---

## Navigation lockdown

- `WKNavigationDelegate` must implement deny-by-default policy.
- Allow `app://` (custom scheme) and `about:blank` (used internally by WKWebView; all other `about:*` are blocked).
- Block `http://`, `https://`, and all unknown schemes.
- Evaluate every navigation action including redirects.
- Log blocked navigation attempts (without PII/URLs containing tokens).

---

## Debug-only Simulator fast loop

- **Release/TestFlight**: Load payload assets from the app bundle only.
- **Debug builds**: May support a Simulator-only override directory **only when explicitly opt-in** (e.g., environment variable or build setting).
- The override directory must never be used in Release builds.
- The core dev loop is: edit web payload → `sync-payload.sh` → rebuild/reload in Simulator.

---

## Telemetry boundary

- Web payload must not depend on direct network egress for telemetry.
- Errors/logs/spans from the WKWebView side must be bridged to native using `WKScriptMessageHandler`.
- The bridge uses a single handler name (`bridge`).
- Message envelope (JSON):

```json
{
  "type": "js_error | unhandled_rejection | log | lifecycle | crypto_result",
  "timestamp": "<ISO 8601>",
  "message": "<string>",
  "stack": "<string, optional>",
  "source": "<string, optional>",
  "line": "<number, optional>",
  "col": "<number, optional>"
}
```

- Native side must validate the message schema and fail closed (ignore malformed messages).
- Never log full message bodies or URLs containing tokens.

### `crypto_result` — Swift↔JS command channel

The bridge supports a bidirectional command/response cycle for native-initiated crypto operations:

1. **Swift → JS**: `evaluateJavaScript("window.handleNativeCommand(...)")` sends `{ command, id, payload }` to the web payload.
2. **JS → Worker**: Main thread forwards the command to the Pyodide Web Worker.
3. **Worker → JS → Swift**: Worker processes the operation, main thread posts `{ type: 'crypto_result', ... }` back to the bridge.
4. **Swift callback**: `WebBridge` decodes `CryptoResultPayload { id, result?, error? }` and invokes `onCryptoResult` callback.

`crypto_result` envelope (additional fields):

```json
{
  "type": "crypto_result",
  "timestamp": "<ISO 8601>",
  "id": "<request UUID>",
  "result": "<string, optional>",
  "error": "<string, optional>"
}
```

> **Critical constraint**: `window.handleNativeCommand` must NOT be declared `async`. WKWebView's `evaluateJavaScript` cannot serialize a Promise return value (triggers `WKErrorDomain Code=5`). Wrap any async body in a `void` IIFE instead:
> ```typescript
> window.handleNativeCommand = (json: string) => {
>   void (async () => { /* async work */ })();
> };
> ```

### Worker → Main → Bridge log forwarding

The Pyodide Web Worker sends fire-and-forget log messages to the main thread, which forwards them to the native bridge:

1. Worker calls `workerLog(msg)` → posts `{ type: 'log', message }` to main thread.
2. Main thread receives the message and forwards to bridge as `{ type: 'log', timestamp, message }`.
3. Native `WebBridge` logs via `AppLogger` under `category: "WebBridge"`.

This provides visibility into Pyodide boot progress and crypto operations in the Xcode console.

### Native telemetry hooks (minimum)

> ⚠️ **NOT YET IMPLEMENTED** — the items below are the required minimum; none are wired up yet.

- App lifecycle (foreground/background/terminate)
- Web navigation timings (`didStartProvisionalNavigation`, `didFinish`, `didFail`)
- WebKit content process termination (`webViewWebContentProcessDidTerminate`) — **implemented** (log + reload)

---

## Debugging checklist

1. **Web Inspector**: Connect Safari Web Inspector to the Simulator's WKWebView (Develop menu → Simulator → page).
2. **Xcode console**: Filter by `[WebBridge]` or `[SchemeHandler]` tags for structured log output.
3. **Telemetry tap**: Force a JS error in the payload (`throw new Error("test")`) and confirm it arrives in native logs via the bridge.
4. **Navigation block**: Attempt `window.location = "https://example.com"` from JS and confirm it is cancelled by the navigation delegate.
5. **WASM MIME**: When `.wasm` files are added, confirm they load without "Unexpected response MIME type" errors.
6. **Process crash recovery**: Simulate WebContent process termination and confirm the app reloads gracefully.

---

## App Store compliance gates

### `itms-services` static analysis

Bundled `python_stdlib.zip` contains `itms-services` in `urllib/parse.py`, which triggers automated App Store rejection. **This is handled automatically** by `sync-payload.sh` — the script unpacks the zip, replaces `itms-services` → `itms_services` via `perl`, and re-zips.

To verify after sync:

```sh
python3 -c "import zipfile; z=zipfile.ZipFile('libs/Fort-ios/WebPayload/pyodide/python_stdlib.zip'); [print(n) for n in z.namelist() if 'parse' in n and 'urllib' in n]; import io; print('itms-services' in z.read('lib/python3.13/urllib/parse.py').decode())"
# Should print: False
```

### Privacy manifest

Include `PrivacyInfo.xcprivacy` in the iOS app. Declare any Required Reason APIs the wrapper uses. The first TestFlight upload will reveal missing/incorrect declarations.

### Reviewer notes

When submitting to TestFlight/App Store, include a note:

- The app runs a bundled, immutable WebAssembly payload.
- The app does not download executable code at runtime.
- Navigation is restricted (not a browser).
