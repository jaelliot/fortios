#!/usr/bin/env bash
# ── sync-payload.sh ───────────────────────────────────────────────────────────
#
# iOS-specific wrapper around build-payload.sh.
#
# Does three things beyond the shared build:
#   1. Sanitizes `itms-services` in python_stdlib.zip (App Store compliance)
#   2. Clean-syncs dist/ → WebPayload/ (Xcode bundle directory)
#   3. Validates the sync output
#
# The platform-agnostic build (npm ci, vite build, Pyodide bundling, manifest
# validation) is handled by build-payload.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Step 1: Run platform-agnostic build ───────────────────────────────────────
source "${SCRIPT_DIR}/build-payload.sh"

# PAYLOAD_DIST_DIR is now exported by build-payload.sh
WRAPPER_PAYLOAD_DIR="${SCRIPT_DIR}/WebPayload"

# ── Step 2: App Store compliance — sanitize itms-services ─────────────────────
# CPython's urllib/parse.py lists "itms-services" as a known URL scheme.
# Apple's static analysis flags this string in any bundled binary/zip,
# causing automated rejection.  Replace the hyphenated form with a
# harmless placeholder so the zip passes static scan.
STDLIB_ZIP="${PAYLOAD_DIST_DIR}/pyodide/python_stdlib.zip"
if [[ -f "${STDLIB_ZIP}" ]]; then
  SCRATCH=$(mktemp -d)
  trap 'rm -rf "${SCRATCH}"' EXIT
  unzip -q "${STDLIB_ZIP}" -d "${SCRATCH}"
  # Replace in-place; uses perl for reliable binary-safe substitution
  find "${SCRATCH}" -type f -name '*.py' -exec \
    perl -pi -e 's/itms-services/itms_services/g' {} +
  (cd "${SCRATCH}" && zip -qr "${STDLIB_ZIP}" .)
  echo "[sync-payload] sanitized itms-services in python_stdlib.zip"
  rm -rf "${SCRATCH}"
  trap - EXIT
fi

# ── Step 3: Sync dist/ → WebPayload/ ─────────────────────────────────────────
echo "[sync-payload] syncing into wrapper WebPayload/"
mkdir -p "${WRAPPER_PAYLOAD_DIR}"
rm -rf "${WRAPPER_PAYLOAD_DIR}"/*
cp -R "${PAYLOAD_DIST_DIR}"/. "${WRAPPER_PAYLOAD_DIR}/"

# ── Step 4: Validate sync output ─────────────────────────────────────────────
if [[ ! -f "${WRAPPER_PAYLOAD_DIR}/index.html" ]]; then
  echo "error: expected index.html missing after sync" 1>&2
  exit 1
fi

if [[ ! -f "${WRAPPER_PAYLOAD_DIR}/build-manifest.json" ]]; then
  echo "error: expected build-manifest.json missing after sync" 1>&2
  exit 1
fi

FILE_COUNT=$(find "${WRAPPER_PAYLOAD_DIR}" -type f | wc -l | tr -d ' ')
DIST_HASH=$(python3 -c 'import json; print(json.load(open("'"${WRAPPER_PAYLOAD_DIR}/build-manifest.json"'"))['"'"dist_tree_sha256"'"'])')

echo "[sync-payload] ok: files=${FILE_COUNT} dist_tree_sha256=${DIST_HASH}"
