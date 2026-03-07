#!/usr/bin/env bash
# ── build-payload.sh ──────────────────────────────────────────────────────────
#
# Platform-agnostic web payload build + Pyodide bundling + manifest validation.
#
# This script is the reusable core shared by both Fort-ios (sync-payload.sh)
# and Fort-android (future). It:
#   1. Validates package-lock.json + Node version
#   2. Runs npm ci && npm run build:ci
#   3. Bundles public/pyodide/ → dist/pyodide/
#   4. Bundles keriwasm Python shims → dist/python/
#   5. Validates dist/build-manifest.json
#
# Platform-specific post-processing (e.g. itms-services sanitization for iOS,
# copying to WebPayload/ or app/src/main/assets/) is handled by the caller.
#
# Usage: source build-payload.sh   (sets PAYLOAD_DIST_DIR for the caller)
#    or: bash build-payload.sh     (standalone validation)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="${SCRIPT_DIR}"
PAYLOAD_DIST_DIR="${PAYLOAD_DIR}/dist"
MANIFEST_PATH="${PAYLOAD_DIST_DIR}/build-manifest.json"

# Export for callers that source this script
export PAYLOAD_DIR PAYLOAD_DIST_DIR MANIFEST_PATH

# ── Step 1: Validate lockfile ─────────────────────────────────────────────────
if [[ ! -f "${PAYLOAD_DIR}/package-lock.json" ]]; then
  echo "error: package-lock.json missing in ${PAYLOAD_DIR} (required for deterministic builds)" 1>&2
  exit 1
fi

# ── Step 2: Validate Node version ────────────────────────────────────────────
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

# ── Step 3: Build ─────────────────────────────────────────────────────────────
echo "[build-payload] building web payload"
(
  cd "${PAYLOAD_DIR}"
  npm ci
  npm run build:ci
)

# ── Step 4: Bundle Pyodide assets ─────────────────────────────────────────────
PYODIDE_SRC_DIR="${PAYLOAD_DIR}/public/pyodide"
if [[ ! -f "${PYODIDE_SRC_DIR}/pyodide.js" ]]; then
  echo "error: Pyodide runtime not found at ${PYODIDE_SRC_DIR}" 1>&2
  echo "       Run: make pyodide" 1>&2
  exit 1
fi
echo "[build-payload] bundling pyodide assets → dist/pyodide/"
cp -R "${PYODIDE_SRC_DIR}/" "${PAYLOAD_DIR}/dist/pyodide/"
echo "[build-payload] pyodide bundle ok ($(du -sh "${PAYLOAD_DIR}/dist/pyodide" | cut -f1))"

# ── Step 5: Bundle keriwasm Python shims ──────────────────────────────────────
# Compatibility shims (pysodium, lmdb), the IndexedDB backend, and the hio
# subset live in keriwasm/python/ — the single source of truth for all Pyodide
# Python files.  We cherry-pick only the files needed at runtime.
KERIWASM_PYTHON_DIR="${SCRIPT_DIR}/../keriwasm/python"
PYTHON_FILES=(indexeddb_python.py pysodium.py lmdb.py)

if [[ ! -d "${KERIWASM_PYTHON_DIR}" ]]; then
  echo "error: keriwasm/python/ not found at ${KERIWASM_PYTHON_DIR}" 1>&2
  echo "       Ensure libs/keriwasm is checked out alongside Fort-ios" 1>&2
  exit 1
fi

mkdir -p "${PAYLOAD_DIST_DIR}/python"
for pyfile in "${PYTHON_FILES[@]}"; do
  src="${KERIWASM_PYTHON_DIR}/${pyfile}"
  if [[ ! -f "${src}" ]]; then
    echo "error: required Python shim not found: ${src}" 1>&2
    exit 1
  fi
  cp "${src}" "${PAYLOAD_DIST_DIR}/python/${pyfile}"
done

# Bundle hio subset (required for keripy imports: doing, decking, ogling, etc.)
HIO_SRC_DIR="${KERIWASM_PYTHON_DIR}/hio"
if [[ -d "${HIO_SRC_DIR}" ]]; then
  cp -R "${HIO_SRC_DIR}" "${PAYLOAD_DIST_DIR}/python/hio"
  HIO_COUNT=$(find "${PAYLOAD_DIST_DIR}/python/hio" -name '*.py' | wc -l | tr -d ' ')
  echo "[build-payload] hio subset → dist/python/hio/ (${HIO_COUNT} files)"

  # Generate hio-manifest.json — single source of truth for the worker's boot install.
  # Lists every .py file as a path relative to the hio/ directory.
  HIO_MANIFEST="${PAYLOAD_DIST_DIR}/python/hio-manifest.json"
  python3 - "${PAYLOAD_DIST_DIR}/python/hio" "${HIO_MANIFEST}" <<'PY'
import json, os, sys

hio_dir, out_path = sys.argv[1], sys.argv[2]
files = sorted(
    os.path.relpath(os.path.join(root, f), hio_dir)
    for root, _, filenames in os.walk(hio_dir)
    for f in filenames
    if f.endswith(".py")
)
dirs = sorted({os.path.dirname(f) for f in files if os.path.dirname(f)})
with open(out_path, "w", encoding="utf-8") as fp:
    json.dump({"dirs": dirs, "files": files}, fp, indent=2)
PY
  echo "[build-payload] hio-manifest.json written (${HIO_COUNT} files)"
else
  echo "warning: hio subset not found at ${HIO_SRC_DIR} — skipping" 1>&2
fi

TOTAL_PY=$(find "${PAYLOAD_DIST_DIR}/python" -name '*.py' | wc -l | tr -d ' ')
echo "[build-payload] keriwasm python shims → dist/python/ (${TOTAL_PY} files total)"

# ── Step 6: Validate manifest ─────────────────────────────────────────────────
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
    "[build-payload] manifest ok:",
    f"git_sha={data.get('git_sha')}",
    f"dist_tree_sha256={data.get('dist_tree_sha256')}",
)
PY

echo "[build-payload] build complete"
