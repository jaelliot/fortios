# Physical iPhone Core SEDI test

This development test generates synthetic Core, Agent, and Unit credential
evidence, creates a signed Core Grant in the iPhone's FortWeb WKWebView, and
checks it with an independent native KERIpy verifier. It transfers test files
through Xcode's device facilities. It does not demonstrate a live KERI service
transport or establish production readiness.

## Prerequisites

- A connected, unlocked physical iPhone and an existing development-signed app.
- An iOS `build-for-testing` output containing the Core SEDI test and the
  intended FortWeb payload. Use the existing signing identity and app identifier.
- The FortWeb checkout containing the Core SEDI reference and verifier fixtures.
- A KERIpy source checkout containing the SEDI tests, and a Python environment
  with its dependencies installed. Run the command with that environment's Python.
- The expected FortWeb commit and SHA-256 of the payload manifest. The command
  verifies the app identifier, installed developer app, manifest, and each
  manifested file before running the device test.

The test updates the specified development app without uninstalling it. It uses
a nonpersistent WebView and creates a uniquely named synthetic test directory in
that app's Documents directory. Existing directories are not deleted. The output
directory must not already exist, and is retained for diagnosis.

## Run

From the Fort-ios repository root, set the variables to the reviewed paths and
identifiers for the local build and device, then run:

```sh
python tools/sedi-core-device-test.py \
  --device "$IPHONE_DEVICE_ID" \
  --bundle "$DEVELOPMENT_APP_BUNDLE_ID" \
  --xctestrun "$SIGNED_XCTESTRUN" \
  --keripy "$KERIPY_SOURCE" \
  --fortweb "$FORTWEB_SOURCE" \
  --output "$NEW_RESULTS_DIRECTORY" \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --fortweb-commit "$FORTWEB_COMMIT"
```

The command preloads native verifiers, transfers the fresh signed Grant, checks
its device and host CESR SHA-256 digests, and runs positive and negative cases
using the KERIpy test's unmodified KRAM configuration. It also checks a stale
replay. A successful run exits zero and writes the report, verifier logs, and
XCTest result bundle to the output directory. A nonzero exit is a failure;
inspect the retained logs and do not treat a partial report as acceptance.

The negative cases omit the Unit or Agent authority, remove a proof, or use a
different Grant binding. Each must first pass KRAM authentication. The test also
checks that invalid preflight requests do not change the holder KEL.

The recovery check closes and reopens the synthetic vault and restarts its
worker within the same WebView. It compares the recovered credential evidence,
presentation-registry binding, and Grant metadata, then rechecks the previously
accepted native exchange. The transferred Grant file is test-owned; this does
not establish durable application inbox or outbox storage, nor persistence over
an app or device restart.

## Example qualification evidence

On 2026-11-04, one synthetic run passed on an iPhone 17 running iOS 27.0.1:

- FortWeb commit: `374583defa75a6e2e0eb933e5a3cbdef192f79e4`.
- Fort-ios base commit: `d9c63984f5a62e8293679a5e68625d0b46c03eda`, with
  development test changes present in the build.
- Native KERIpy source: `84301a9ff4bbb644ce134f9649ad56b49aa130f2`.
- FortWeb runtime package SHA-256:
  `425e06847dbdb617b27a5bf66ebed0bec8336dae0c18902d3f30a37b814cfb36`.
- Bundled manifest SHA-256:
  `4b5197f8d91ecda56260e7cc7337d85586499cc3c668342e9757d7de81182629`.
- The verifier accepted the fresh Grant at approximately 1.30 seconds of age;
  four invalid variants and a stale replay were rejected. The selected XCTest
  passed with zero skips.

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
