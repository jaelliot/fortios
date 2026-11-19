# Physical iPhone Core SEDI test

This development test generates synthetic Core, Agent, and Unit credential
evidence, creates a signed Core Grant in the iPhone's FortWeb WKWebView, and
checks it with an independent native KERIpy verifier. It transfers test files
through Xcode's device facilities. It does not demonstrate a live KERI service
transport or establish production readiness.

## Prerequisites

- A Mac with Xcode and its command-line tools, plus a paired, connected,
  unlocked physical iPhone and an existing development-signed app.
- An iOS `build-for-testing` output containing the Core SEDI test and the
  intended FortWeb payload. Use the existing signing identity and app identifier.
- The FortWeb checkout containing the Core SEDI reference and verifier fixtures.
- A KERIpy source checkout containing the SEDI tests, and a Python environment
  with its dependencies installed. Run the command with that environment's Python.
- The expected FortWeb commit and SHA-256 of the payload manifest. The command
  checks the local test host and installed developer-app identifier before
  launch; the selected device test checks the installed manifest and each
  manifested file before exercising the runtime.
- To reuse the installed app, that exact app must already contain the matching
  `KeriWalletTests.xctest` bundle and Core SEDI test. The device test verifies
  the installed payload before exercising it.

By default Xcode may update the specified development app without uninstalling
it. Use `--reuse-installed-app` to run the already-installed test bundle without
reinstalling the app. The test uses a nonpersistent WebView and creates a new
synthetic vault and uniquely named directory in the app's Documents directory
on each run. Existing directories are not deleted. The output directory must not
already exist, and is retained for diagnosis.

## Run

From the Fort-ios repository root, set the variables to the reviewed paths and
identifiers for the local build and device, then run:

```sh
"$KERIPY_PYTHON" tools/sedi-core-device-test.py \
  --device "$IPHONE_DEVICE_ID" \
  --bundle "$DEVELOPMENT_APP_BUNDLE_ID" \
  --xctestrun "$SIGNED_XCTESTRUN" \
  --keripy "$KERIPY_SOURCE" \
  --fortweb "$FORTWEB_SOURCE" \
  --output "$NEW_RESULTS_DIRECTORY" \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --fortweb-commit "$FORTWEB_COMMIT" \
  --reuse-installed-app
```

For the two-process recovery scenario, add `--app-restart`. It requires
`--reuse-installed-app`: the existing app must already contain this version of
the test bundle. The write phase uses a fresh run-specific persistent WebKit
store, closes the synthetic vault, and records public identifiers and digests.
After XCTest completes, the controller checks that the original process is gone,
then starts the read phase and requires a different process and matching stored
state. Each phase must report exactly one passing test and no failures or skips.
The native verifier checks the fresh Grant before the restart and rechecks its
previously accepted exchange afterward. The read phase does not call the
presentation-creation API.

Installing a revised test bundle may replace the development app. Before any
installation, compare the app identifier, signing team, test host, and installed
app and obtain the required approval. Do not uninstall or clear storage. Preserve
the result directory and app state if either phase fails.

The command preloads native verifiers, transfers the fresh signed Grant, checks
its device and host CESR SHA-256 digests, and runs positive and negative cases
using the KERIpy test's unmodified KRAM configuration. It also checks a stale
replay. A successful run exits zero and writes the report, verifier logs, and
XCTest result bundle to the output directory. A nonzero exit is a failure;
inspect the retained logs and do not treat a partial report as acceptance.
If the installed app lacks the matching test bundle, stop and prepare a reviewed
development build before trying again. Do not switch to a production app or
remove the installed app to work around the failure.

The negative cases omit the Unit or Agent authority, remove a proof, or use a
different Grant binding. Each must first pass KRAM authentication. The test also
checks that invalid preflight requests do not change the holder KEL.

The default recovery check closes and reopens the synthetic vault and restarts
its worker within the same WebView. With `--app-restart`, it additionally compares
the original KEL and presentation TEL digests, binding, credential evidence,
nested substreams and selected signed-state digests after a process stop. The
native verifier retains its own accepted exchange and authority-registry inputs.
The transferred Grant file is test-owned; this does not establish complete
application inbox or outbox storage or persistence across a device reboot.

In three physical iPhone 17 runs on iOS 27.0.1, the `--app-restart` flow
passed both XCTest phases with zero skips. Each run recovered the original
holder, credential, presentation binding, TEL event hashes, Grant metadata,
and three nested substream hashes in a different app process. The nested
substreams matched the native parser's serialization of the original Grant.
The native verifier accepted the fresh Grant and rechecked its previously
accepted exchange after recovery. The final-candidate single-credential test
also passed write and read phases in different app processes.

Missing, incorrect, and already-consumed checkpoints produced the expected
XCTest failures. Missing credential and mismatched binding checks failed
closed; pending markers are checked before and after recovery. The invalid
preflight checks compare the holder KEL, but do not independently compare TEL
bytes before and after those rejected requests. Physical failure-injection of
pending markers and offline cold-launch recovery remain untested.

## Demonstration walkthrough

This is a developer-assisted synthetic demonstration. The test runs in an
off-screen WebView on the physical iPhone; it is not a credential presentation
through the app's user interface. The Mac supplies synthetic issuer and
authority fixtures and receives the Grant through Xcode's device file transfer.
The native KERIpy verifier runs on the Mac, not on an independent service.

1. Before the session, rehearse the command above with the reviewed signed build,
   runtime package, native verifier, and connected iPhone. Use synthetic data
   only and confirm the phone is unlocked. Choose a new results directory for
   each run.
2. Run the command above. Add `--app-restart` to demonstrate recovery across
   an application-process stop; without it, the recovery check restarts the
   worker. The test creates the signed Core Grant in the iPhone's WebView, and
   the native verifier checks the transferred Grant and its authority evidence.
3. After the command exits successfully, display the report:

   ```sh
   python3 -m json.tool "$NEW_RESULTS_DIRECTORY/report.json"
   ```

   Check that `native` contains `valid`, `wrong`, `missing`, `missingAgent`,
   `missingProof`, and `rechecked`, all `true`. The `recovery` results
   `credentialRecovered`, `bindingRecovered`, and `grantMetadataRecovered`
   must also be `true`. Check `stale_rejected_by_kram` is `true` and
   `xctest_exit_code` is `0`. Use the verifier logs and XCTest result bundle in
   the results directory for details; inspect the XCTest result for failures or
   skips. A report alone is not a substitute for a successful command and test.
4. Explain that the valid synthetic presentation was accepted and invalid
   variants were rejected. A successful default run demonstrates worker recovery;
   a successful `--app-restart` run demonstrates recovery in a new app process
   and includes `read_xctest` and `process_recovery` in the report. Neither mode
   proves a complete application-owned Grant outbox or a live service exchange.
   This is not a finished wallet interface or production readiness.

To display the positive and wrong-binding verifier outcomes without displaying
the fixture data, use:

```sh
grep -F 'Native verifier' "$NEW_RESULTS_DIRECTORY/verifier-valid.log" \
  "$NEW_RESULTS_DIRECTORY/verifier-wrong.log"
```

## Troubleshooting and stop conditions

- If Xcode cannot find the device, check the cable, pairing, Developer Mode and
  lock state. Preserve the app and its data; do not uninstall it.
- If the manifest, commit, development-app identity or test bundle does not
  match, stop and restore the reviewed inputs. Do not substitute a different
  payload or signing identity.
- If the fresh Grant fails KRAM authentication, retain the logs, check device
  and host clocks and handoff timing, then rerun with a new output directory.
  Do not change the signed timestamp or relax KRAM freshness settings.
- If an operation is incomplete, preserve the output and signed state. Do not
  clear a pending marker or retry writes in that vault. Each test invocation
  already uses fresh synthetic state; it does not repair an existing vault.
- A failed, skipped, or incomplete test is not a live demonstration success.
  Use a clearly labelled prior result as a fallback and investigate before
  claiming a new pass. Test outputs contain synthetic evidence and local device
  metadata; review them before sharing.

If the live run cannot complete, use the retained qualification evidence below
as a record of a previous run and identify it as such. Keep the runtime v2 and
signing-root limitations visible; do not use real credentials for this test.

## Example qualification evidence

On 2026-11-04, one synthetic run passed on an iPhone 17 running iOS 27.0.1:

- FortWeb commit: `374583defa75a6e2e0eb933e5a3cbdef192f79e4`.
- Fort-ios base commit: `d9c63984f5a62e8293679a5e68625d0b46c03eda`, with
  development test changes present in the build.
- Native KERIpy source: `84301a9ff4bbb644ce134f9649ad56b49aa130f2`.
- The development app was `com.kerifoundation.wallet.cspcheck`, using the
  `KeriWalletTests/CoreSediDeviceTests/testSyntheticCorePresentation` test.
- FortWeb runtime package SHA-256:
  `425e06847dbdb617b27a5bf66ebed0bec8336dae0c18902d3f30a37b814cfb36`.
- Bundled manifest SHA-256:
  `4b5197f8d91ecda56260e7cc7337d85586499cc3c668342e9757d7de81182629`.
- The verifier accepted the fresh Grant at approximately 1.30 seconds of age;
  four invalid variants and a stale replay were rejected. The selected XCTest
  passed with zero skips.

The ZIP hash covers the runtime package archive. The manifest hash covers the
bundled `manifest.json` bytes. Each run's `cesr_sha256` covers the signed Grant
bytes and changes when a fresh synthetic Grant is generated; these hashes are
for different artifacts and are not interchangeable.

These results use a developer file-transfer channel and synthetic credentials.
Signing-root confidentiality, runtime-requirements v2, pending-operation
recovery, durable message handling, and real service transport need separate
qualification. Desktop Locksmith remains an available demonstration fallback.

## Reproduce the qualified package

The example package above was reproduced byte for byte using the FortWeb
candidate commit and the matching qualified runtime tree and source manifest.
The source manifest SHA-256 was
`f76cf23f5cdaa5fe3f7a0e264c862290f9c8b6be2aafca6622926e1869731431`.
The Node 22.12.0 executable used for that build had SHA-256
`53dc65febda99ecaafe692de5ec60efdc2f7bd4fb14d1ba8cd30dc2af103953f`.
Using a different Node binary changes package provenance and therefore the ZIP
and manifest hashes, even when the application files match.

From the FortWeb checkout at the recorded commit, with the reviewed qualified
runtime tree and source manifest available, run:

```sh
PATH="$(dirname "$NODE22"):$PATH" "$NODE22" tools/package-runtime.mjs \
  --runtime-dir "$QUALIFIED_RUNTIME_DIR" \
  --source-manifest "$QUALIFIED_SOURCE_MANIFEST" \
  --source-manifest-sha256 f76cf23f5cdaa5fe3f7a0e264c862290f9c8b6be2aafca6622926e1869731431 \
  --python "$KERIPY_PYTHON" \
  --output-dir "$NEW_PACKAGE_DIRECTORY" \
  --ref refs/heads/test/sedi-csp-candidate
```

Check the resulting ZIP against the package SHA-256 above before importing it.
This reproduces the package from already-prepared runtime inputs; it does not
establish a fresh build of those inputs or a published, attested release. Keep
the reviewed inputs and local candidate commits available until the release
workflow has made them accessible to the intended operators.
