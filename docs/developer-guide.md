# Fort-ios developer guide

This guide contains the detailed setup and tooling reference for contributors.
For the short project overview and common entry points, see the repository README.

## Requirements

- macOS and Xcode 26.5 with the iOS 26.5 SDK and Simulator runtime. The app
  deployment target is iOS 16.4.
- mise and Node 22.12.0, as pinned in `.tool-versions`.
- Python 3.12 for the FortWeb runtime-source acquisition and build tools.
- SwiftLint for `make lint`.

The app runtime is separate from the host Python used by these tools. The
bundled FortWeb package contains Pyodide 314.0.5 and Python 3.14.2.

## Prepare the FortWeb runtime

`make payload-contract` packages and imports the FortWeb runtime. A clean
FortWeb checkout does not already contain the acquired runtime source or its
built `dist/runtime` directory. The following procedure reproduces the inputs
used by iOS Security Checks.

### Source pins and ownership

The values below are verified in the Fort-ios Makefile and
`.github/workflows/ios-security.yml`:

| Input | Value | Owner |
|-------|-------|-------|
| FortWeb producer checkout | `bdb81afa7593603141e8db306f0636a583d2db02` | CI workflow |
| Runtime source release | `runtime-source-pyodide-314-20260909` | CI workflow |
| Runtime source archive URL | `https://github.com/keri-foundation/fortweb/releases/download/runtime-source-pyodide-314-20260909/runtime-source.tar.gz` | CI workflow |
| Runtime source archive SHA-256 | `e04833249eec88596e0f2f88d32baa6d5fae6b2e964996587061ddac4bd78c72` | CI workflow |
| Runtime source manifest path | `build/runtime-source/manifest.json` | Makefile and CI workflow |
| Runtime source manifest SHA-256 | `87bcc689d7778840a76284471ff599cef21be41df2b429724f7f4fdc5f022135` | Makefile and CI workflow |

The Makefile defaults `FORTWEB_RUNTIME_SOURCE_MANIFEST_SHA256` for local
packaging. It does not pin the FortWeb checkout commit or source archive hash.
CI separately pins the producer commit, archive URL and hash, and manifest
hash. Keep these roles distinct when updating producer inputs.

### Obtain and prepare the producer

Run these commands from the Fort-ios repository root. If `../fortweb` already
exists, verify its remote and checkout before using it.

```sh
git clone https://github.com/keri-foundation/fortweb.git ../fortweb
git -C ../fortweb checkout bdb81afa7593603141e8db306f0636a583d2db02
npm ci
npm ci --prefix ../fortweb
python3.12 -m venv ../fortweb/.venv
source ../fortweb/.venv/bin/activate
```

Keep the virtual environment active for the remaining commands. The producer
scripts use `python3`; with the environment active, package installation stays
inside the FortWeb checkout's ignored `.venv` instead of changing the global
Python installation or adding an environment to Fort-ios.

Set the inputs used by the producer build:

```sh
export FORTWEB_DIR=../fortweb
export FORTWEB_RUNTIME_SOURCE_URL=https://github.com/keri-foundation/fortweb/releases/download/runtime-source-pyodide-314-20260909/runtime-source.tar.gz
export FORTWEB_RUNTIME_SOURCE_ARCHIVE_SHA256=e04833249eec88596e0f2f88d32baa6d5fae6b2e964996587061ddac4bd78c72
export FORTWEB_RUNTIME_SOURCE_MANIFEST=build/runtime-source/manifest.json
export FORTWEB_RUNTIME_SOURCE_MANIFEST_SHA256=87bcc689d7778840a76284471ff599cef21be41df2b429724f7f4fdc5f022135
```

Acquire and verify the source archive and manifest, install the producer build
tools from the verified local wheelhouse, and build the runtime:

```sh
(cd "$FORTWEB_DIR" && python3 scripts/acquire_runtime_source.py \
  --url "$FORTWEB_RUNTIME_SOURCE_URL" \
  --sha256 "$FORTWEB_RUNTIME_SOURCE_ARCHIVE_SHA256" \
  --manifest-sha256 "$FORTWEB_RUNTIME_SOURCE_MANIFEST_SHA256" \
  --output build/runtime-source)

python3 -m pip install --disable-pip-version-check --no-index --no-deps \
  "$FORTWEB_DIR/build/runtime-source/wheelhouse/packaging-26.1-py3-none-any.whl" \
  "$FORTWEB_DIR/build/runtime-source/wheelhouse/setuptools-83.0.0-py3-none-any.whl" \
  "$FORTWEB_DIR/build/runtime-source/wheelhouse/wheel-0.47.0-py3-none-any.whl"

(cd "$FORTWEB_DIR" && npm run build:runtime)
```

Build and import the canonical package from the Fort-ios repository root:

```sh
make payload-contract FORTWEB_DIR="$FORTWEB_DIR"
```

This packages the FortWeb `dist/runtime` output, imports the ZIP into
`WebPayload/`, and checks the payload contract. Run it again after changing the
FortWeb runtime input. `WebPayload/` is generated output. Do not edit or stage
its contents directly.

## Payload import flow

FortWeb produces the runtime ZIP; Fort-ios imports and validates it; Xcode
bundles the resulting files into the app:

```text
FortWeb package:runtime
    -> fortweb-runtime-0.0.0.zip
    -> tools/import-fortweb-runtime-package.mjs
    -> WebPayload/ (manifest.json and runtime files)
    -> KeriWallet.app
```

The importer checks the manifest, file hashes, entry point, and path
containment before replacing `WebPayload/`. `make payload-contract` runs the
payload containment, integrity, Pyodide runtime, and mobile payload checks.

## Common Make targets

Run `make help` for the current complete target list.

| Target | Purpose |
|--------|---------|
| `make setup` | Install Fort-ios Node dependencies with `npm ci` |
| `make payload-package` | Build the FortWeb runtime ZIP |
| `make payload-import` | Import the runtime ZIP into `WebPayload/` |
| `make payload-contract` | Import and validate the staged payload |
| `make xcode-ready` | Resolve a simulator, prepare a missing payload, and check contracts |
| `make ios-doctor` | Check Xcode, simulator, and payload-source readiness |
| `make ios-resolve-sim` | Show the selected simulator |
| `make build` | Build KeriWallet for iOS Simulator |
| `make run-sim` | Boot, install, and launch on the resolved simulator |
| `make dev-device` | Build for a generic iOS device destination |
| `make run-device DEVICE_REF=<udid-or-name>` | Install and launch on a device |
| `make parity-smoke DEVICE_REF=<udid-or-name>` | Build, install, and launch smoke on simulator and device |
| `make lint` | Run strict SwiftLint checks |
| `make test-tools` | Run Node tooling tests |
| `make test-swift` | Run Swift unit and UI tests on Simulator |
| `make test-all` | Run Swift and Node tests |
| `make bridge-check` | Check generated bridge contract files |
| `make logs-sim` / `make logs-device` | Show recent app logs |
| `make clean` | Remove derived build, test result, and package output |

`parity-smoke` is build, install, and launch smoke support. It does not establish
wallet acceptance, vault setup or unlocking, persistence, or end-to-end KERI
acceptance.

## npm scripts

Use Make targets for routine work. These npm scripts are called by Make or are
available for focused diagnostics:

| Script | Purpose |
|--------|---------|
| `npm run bridge:check` | Check generated Swift and Kotlin bridge files |
| `npm test` | Run the Vitest tooling suite |
| `npm run runtime:import` | Import a canonical FortWeb runtime ZIP |
| `npm run check:payload` | Check staged payload containment and integrity |
| `npm run validate:runtime-platform-config` | Validate the iOS runtime platform configuration |
| `npm run test:runtime-platform-config` | Test the runtime platform configuration validator |
| `npm run validate:runtime-requirements-compatibility` | Validate FortWeb runtime requirements compatibility |
| `npm run test:runtime-requirements-compatibility` | Test the compatibility validator |
| `npm run verify:release-archive` | Check an archive contains the validated payload |

## Tests and diagnostics

### Swift tests

`make test-swift` runs Swift unit and UI tests using `xcodebuild test`. The test
targets use Swift Testing APIs such as `@Suite`, `@Test`, `#expect`, and
`#require`. The app target remains in Swift 5 language mode.

To choose a simulator explicitly, pass the destination to Xcode:

```sh
xcodebuild test \
  -project KeriWallet.xcodeproj \
  -scheme KeriWallet \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

#### Synthetic native IPEX smoke test

`RuntimeDeviceSmokeTests/testSyntheticNativePresentation` exercises the FortWeb
`37ce9f3` candidate in a separate, nonpersistent WKWebView data store. The test
checks the installed manifest and all 160 declared file hashes, issues and
retrieves a registry-backed synthetic credential, and verifies a presentation in
a separate verifier vault. It also checks wrong-party and wrong-Grant rejection,
tamper recovery, writer contention, and retrieval after worker restart.

The test uses the producer's synthetic schema fixture and enables the runtime's
synthetic-recipient flag only in the test webview. It does not modify the bundled
configuration. Its in-memory vaults are discarded after the test: they do not
prove credential persistence across an app restart, network delivery, or external
SEDI interoperability. The test skips when the installed manifest is not the
candidate it is pinned to; a skipped test is not a successful candidate check.

From a clean checkout, obtain the verified FortWeb runtime ZIP and import it with
the canonical importer. The candidate ZIP SHA-256 is
`6b71231a492906fbbb05e9736a73d7ab393b920a1a5312b4bfe46f579e3a79c5`.

```sh
shasum -a 256 "$FORTWEB_RUNTIME_ZIP"
node tools/import-fortweb-runtime-package.mjs "$FORTWEB_RUNTIME_ZIP"
node tools/assert-payload-integrity.mjs --payload-dir WebPayload
```

For a physical device, use an existing separately signed development installation
and review its data before updating it. The following example targets the `.dev`
app and leaves the project test bundle IDs distinct. Replace the destination ID
with the paired device and use an unused result path.

```sh
xcodebuild test \
  -project KeriWallet.xcodeproj -scheme KeriWallet -configuration Debug \
  -destination 'platform=iOS,id=DEVICE_UDID' \
  -derivedDataPath build/DerivedData-runtime-smoke \
  -resultBundlePath build/RuntimeSmokeDevice.xcresult \
  -parallel-testing-enabled NO \
  -only-testing:KeriWalletTests/RuntimeDeviceSmokeTests/testSyntheticNativePresentation \
  'PRODUCT_BUNDLE_IDENTIFIER=com.kerifoundation.wallet$(FORT_TEST_ID_$(TARGET_NAME))' \
  FORT_TEST_ID_KeriWallet=.dev FORT_TEST_ID_KeriWalletTests=.tests \
  FORT_TEST_ID_KeriWalletUITests=.uitests
```

Inspect the Xcode result bundle and confirm one test passed and none were skipped.
The existing app's normal persistent vault remains separate from the test store;
confirm its vault and identifier after updating the development app. The test
does not delete its host app or require changing certificates or account settings.

#### Synthetic credential recovery across an app restart

`testSyntheticNativePersistenceAcrossAppRestart` uses the same candidate and
protocol operations in a persistent, identifier-specific WKWebView data store.
It is isolated from the app's default WebKit store and requires iOS 17 or later.
The test uses synthetic vaults and a synthetic Grant; it stores the Grant stream
and comparison metadata in a test-only app-preferences checkpoint. The actual
credential and registry evidence are reopened from the protected test vaults.
No real credential or passcode should be used with this test.

Use the same preflight and development bundle settings above, replacing the test
selection and adding Xcode's process-relaunch options:

```sh
-only-testing:KeriWalletTests/RuntimeDeviceSmokeTests/testSyntheticNativePersistenceAcrossAppRestart
-test-iterations 2 -test-repetition-relaunch-enabled YES
```

Use a new result path and keep the app installed throughout both iterations.
The result is valid only when both iterations pass without skips and the test
output shows `Runtime persistence phase: write` followed by `read` with different
process IDs. Two write phases or an incomplete run do not prove recovery. If an
interrupted run leaves a pending checkpoint, the next iteration reads that state;
start another two-iteration run and confirm the write/read order. Synthetic test
vaults and checkpoints are not automatically removed.

On recovery the test compares the original identifiers, issuer and presentation
registry heads, credential and Grant IDs, retrieves the previously stored Grant,
and re-verifies it using recovered issuer and holder evidence. It also rejects a
changed Grant binding. The Grant stream used for re-verification comes from the
test checkpoint, because the current exchange lookup returns a verified view, not
an exportable original stream. It does not demonstrate network delivery, current
revocation status, or the user-facing Credentials workflow.

For an offline cold-launch recovery without reinstalling, start with a trusted,
already installed `.dev` build containing `KeriWalletTests.xctest` and the
generated device `.xctestrun` file for that same build. Set `XCTESTRUN` to the
generated file and `NO_INSTALL_XCTESTRUN` to a new local file. The following
retains the generated testing environment but tells Xcode to use the installed
test bundle. It refuses a test host other than the development app.

```sh
python3 - "$XCTESTRUN" "$NO_INSTALL_XCTESTRUN" <<'PY'
import plistlib
import sys

with open(sys.argv[1], 'rb') as source:
    run = plistlib.load(source)
found = False
for configuration in run['TestConfigurations']:
    targets = [t for t in configuration['TestTargets'] if t['BlueprintName'] == 'KeriWalletTests']
    for target in targets:
        if target['TestHostBundleIdentifier'] != 'com.kerifoundation.wallet.dev':
            raise SystemExit('Expected the existing development app')
        for key in ('TestBundlePath', 'TestHostPath', 'UITargetAppPath', 'DependentProductPaths'):
            target.pop(key, None)
        target['UseDestinationArtifacts'] = True
        target['TestBundleDestinationRelativePath'] = '__TESTHOST__/PlugIns/KeriWalletTests.xctest'
        found = True
    configuration['TestTargets'] = targets
if not found:
    raise SystemExit('KeriWalletTests target not found')
with open(sys.argv[2], 'wb') as destination:
    plistlib.dump(run, destination)
PY
```

While online, run the following command with a paired device ID and an unused
result path. Confirm the output says `Runtime persistence phase: write`. If it
says `read`, repeat online until a new write completes. Then close the app, verify
its process has stopped, disable both Wi-Fi and cellular, and run the same command
with a different result path. Confirm the offline run says `read`, passes without
skips, and uses a different process ID. Restore connectivity afterward.

```sh
xcodebuild test-without-building -xctestrun "$NO_INSTALL_XCTESTRUN" \
  -destination 'platform=iOS,id=DEVICE_UDID' -resultBundlePath RESULT_PATH \
  -parallel-testing-enabled NO \
  -only-testing:KeriWalletTests/RuntimeDeviceSmokeTests/testSyntheticNativePersistenceAcrossAppRestart
```

The candidate's `fort.runtime-requirements.v2` descriptor is rejected by the
compatibility validator because this host configuration does not establish
HTTPS wallet-service support and does not declare v2 compatibility. Passing
this device test does not resolve that separate compatibility failure.

`testStrictRuntimePolicyMatchesSelectedCandidate` checks a policy that permits
WebAssembly but blocks JavaScript string evaluation. It expects the older
pre-CSP candidate to report the PyScript evaluation incompatibility and the
strict-policy candidates to complete the synthetic presentation. A passing test
does not establish runtime requirements v2 compatibility or production readiness.

### Node tooling tests

`make test-tools` runs the payload import, validation, and bridge tooling tests
with Vitest. Runtime platform and compatibility validators also have standalone
`node --test` suites. The tools run without a browser or WebAssembly runtime.

```sh
make test-tools
make test-all
```

For host-side diagnostics, use `make logs-sim`, `make logs-device`, or
Console.app to inspect payload loading, bridge messages, blocked navigation,
and scheme-handler errors.

## Bridge contract

`bridge-contract.json` is the committed source of truth. The generated Swift
and Kotlin declarations are `KeriWallet/BridgeContract.swift` and
`generated/BridgeContract.kt`. Run `make bridge-check` to verify that generated
files match the JSON contract. The generator is
`tools/gen-bridge-contract.mjs`.

The JavaScript-to-Swift message envelope includes a type and ISO 8601 timestamp:

```json
{
  "type": "lifecycle | js_error | log | crypto_result | unhandled_rejection",
  "timestamp": "<ISO 8601>",
  "message": "<optional string>"
}
```

## Repository layout

```text
Fort-ios/
├── KeriWallet/                 # Swift app sources and resources
├── KeriWalletTests/            # Swift unit tests
├── KeriWalletUITests/          # Swift UI tests
├── KeriWallet.xcodeproj/       # Xcode project
├── tools/                      # Payload, archive, and bridge tooling
├── scripts/                    # Simulator and build helpers
├── WebPayload/                 # Generated runtime bundled by Xcode
├── generated/                  # Generated cross-platform declarations
├── Config/                     # Xcode build configuration
├── docs/                       # Public developer and release documentation
├── bridge-contract.json        # Bridge contract source of truth
├── Makefile                    # Developer commands
├── package.json                # Node tooling scripts
└── .tool-versions              # mise-managed Node version
```

Do not hand-edit generated bridge declarations or `WebPayload/`. Use the
corresponding generator, importer, and contract checks.

## Release documentation

See the [App Store submission checklist](app-store-submission-checklist.md) for
release requirements and the distinction between a passing archive check and
release certification.
