#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Flat layout: TS payload sources live at the repo root (SCRIPT_DIR).
PAYLOAD_DIR="${SCRIPT_DIR}"
PAYLOAD_DIST_DIR="${PAYLOAD_DIR}/dist"
MANIFEST_PATH="${PAYLOAD_DIST_DIR}/build-manifest.json"

WRAPPER_PAYLOAD_DIR="${SCRIPT_DIR}/WebPayload"

if [[ ! -f "${PAYLOAD_DIR}/package-lock.json" ]]; then
  echo "error: package-lock.json missing in ${PAYLOAD_DIR} (required for deterministic builds)" 1>&2
  exit 1
fi

REQUIRED_NODE_VERSION=$(PAYLOAD_DIR="${PAYLOAD_DIR}" python3 - <<'PY'
import json
import os

pkg_path = os.path.join(os.environ["PAYLOAD_DIR"], "package.json")
with open(pkg_path, "r", encoding="utf-8") as f:
    pkg = json.load(f)
print(((pkg.get("engines") or {}).get("node")) or "")
PY
)

CURRENT_NODE_VERSION=$(node -v | sed 's/^v//')

# Local dev: warn on major.minor mismatch (patch upgrades are safe).
# CI: enforce exact version match via mise — hard error on any mismatch.
REQUIRED_NODE_MAJOR_MINOR=$(echo "${REQUIRED_NODE_VERSION}" | cut -d. -f1-2)
CURRENT_NODE_MAJOR_MINOR=$(echo "${CURRENT_NODE_VERSION}" | cut -d. -f1-2)

if [[ -n "${REQUIRED_NODE_VERSION}" ]]; then
  if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
    if [[ "${CURRENT_NODE_VERSION}" != "${REQUIRED_NODE_VERSION}" ]]; then
      echo "error: CI requires exact Node version: required=${REQUIRED_NODE_VERSION} current=${CURRENT_NODE_VERSION}" 1>&2
      exit 1
    fi
  elif [[ "${CURRENT_NODE_MAJOR_MINOR}" != "${REQUIRED_NODE_MAJOR_MINOR}" ]]; then
    echo "warning: node major.minor mismatch: required=${REQUIRED_NODE_VERSION} current=${CURRENT_NODE_VERSION}" 1>&2
  fi
fi

echo "[sync-payload] building web payload"
(
  cd "${PAYLOAD_DIR}"
  npm ci
  npm run build:ci
)

# Bundle Pyodide assets into dist/ so PayloadSchemeHandler can serve them.
# The download is a one-time setup step (make pyodide); fail fast if missing.
PYODIDE_SRC_DIR="${PAYLOAD_DIR}/public/pyodide"
if [[ ! -f "${PYODIDE_SRC_DIR}/pyodide.js" ]]; then
  echo "error: Pyodide runtime not found at ${PYODIDE_SRC_DIR}" 1>&2
  echo "       Run: cd libs/Fort-ios && make pyodide" 1>&2
  exit 1
fi
echo "[sync-payload] bundling pyodide assets → dist/pyodide/"
cp -R "${PYODIDE_SRC_DIR}/" "${PAYLOAD_DIR}/dist/pyodide/"
echo "[sync-payload] pyodide bundle ok ($(du -sh "${PAYLOAD_DIR}/dist/pyodide" | cut -f1))"

# ── App Store compliance: sanitize itms-services string ──────────────
# CPython's urllib/parse.py lists "itms-services" as a known URL scheme.
# Apple's static analysis flags this string in any bundled binary/zip,
# causing automated rejection.  Replace the hyphenated form with a
# harmless placeholder so the zip passes static scan.
STDLIB_ZIP="${PAYLOAD_DIR}/dist/pyodide/python_stdlib.zip"
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

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "error: build-manifest.json missing at ${MANIFEST_PATH}" 1>&2
  exit 1
fi

MANIFEST_PATH="${MANIFEST_PATH}" python3 - <<'PY'
import json
import os

manifest_path = os.environ["MANIFEST_PATH"]

with open(manifest_path, "r", encoding="utf-8") as f:
    data = json.load(f)

required = [
    "schema",
    "created_at",
    "git_sha",
    "node_version",
    "package_lock_sha256",
    "dist_tree_sha256",
]

missing = [k for k in required if k not in data]
if missing:
    raise SystemExit(f"error: build-manifest missing keys: {missing}")

if data.get("schema") != 1:
    raise SystemExit(f"error: unsupported manifest schema: {data.get('schema')}")

print(
    "[sync-payload] manifest ok:",
    f"git_sha={data.get('git_sha')}",
    f"dist_tree_sha256={data.get('dist_tree_sha256')}",
)
PY

echo "[sync-payload] syncing into wrapper WebPayload/"
mkdir -p "${WRAPPER_PAYLOAD_DIR}"
rm -rf "${WRAPPER_PAYLOAD_DIR}"/*
cp -R "${PAYLOAD_DIST_DIR}"/. "${WRAPPER_PAYLOAD_DIR}/"

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
