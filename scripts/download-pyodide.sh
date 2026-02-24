#!/usr/bin/env bash
# download-pyodide.sh
# Downloads Pyodide v0.29.1 runtime assets + crypto wheels into public/pyodide/.
# Run once per machine (or after a clean). Output is gitignored.
#
# Usage: ./scripts/download-pyodide.sh [--force]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
KERIWASM_DIR="$(cd "${PAYLOAD_DIR}/../../libs/keriwasm" && pwd)"

OUT_DIR="${PAYLOAD_DIR}/public/pyodide"
WHEELS_DIR="${OUT_DIR}/wheels"

PYODIDE_VERSION="0.29.1"
CDN_BASE="https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full"

# Core runtime files required by loadPyodide()
CORE_FILES=(
  "pyodide.js"
  "pyodide.asm.wasm"
  "pyodide.asm.js"
  "pyodide-lock.json"
  "python_stdlib.zip"
)

# ── colors ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" >&2; }

# ── flags ────────────────────────────────────────────────────────────────────
FORCE=false
for arg in "$@"; do
  case $arg in
    --force|-f) FORCE=true ;;
    --help|-h)
      echo "Usage: $0 [--force]"
      echo "  --force  Re-download even if files already exist"
      exit 0
      ;;
  esac
done

# ── deps ─────────────────────────────────────────────────────────────────────
if ! command -v curl &>/dev/null; then
  error "curl is required"; exit 1
fi
if ! command -v python3 &>/dev/null; then
  error "python3 is required (used to download pychloride wheel)"; exit 1
fi

mkdir -p "${OUT_DIR}" "${WHEELS_DIR}"

# ── 1. Pyodide core runtime ───────────────────────────────────────────────────
echo ""
echo "=== Pyodide v${PYODIDE_VERSION} core runtime ==="
for FILE in "${CORE_FILES[@]}"; do
  DEST="${OUT_DIR}/${FILE}"
  if [[ -f "${DEST}" ]] && [[ "${FORCE}" == "false" ]]; then
    info "already present: ${FILE}"
    continue
  fi
  URL="${CDN_BASE}/${FILE}"
  echo "  downloading ${FILE}..."
  curl -fsSL --progress-bar "${URL}" -o "${DEST}"
  SIZE=$(du -sh "${DEST}" | cut -f1)
  info "downloaded ${FILE} (${SIZE})"
done

# ── 2. blake3 wheel — copy from keriwasm/static/ ─────────────────────────────
echo ""
echo "=== Crypto wheels ==="
BLAKE3_WHEEL="blake3-1.0.8-cp313-cp313-pyodide_2025_0_wasm32.whl"
BLAKE3_SRC="${KERIWASM_DIR}/static/${BLAKE3_WHEEL}"
BLAKE3_DEST="${WHEELS_DIR}/${BLAKE3_WHEEL}"

if [[ -f "${BLAKE3_DEST}" ]] && [[ "${FORCE}" == "false" ]]; then
  info "already present: ${BLAKE3_WHEEL}"
else
  if [[ ! -f "${BLAKE3_SRC}" ]]; then
    error "blake3 wheel not found at ${BLAKE3_SRC}"
    error "Ensure libs/keriwasm is cloned (run Devtools/python-env/setup-envrc)"
    exit 1
  fi
  cp "${BLAKE3_SRC}" "${BLAKE3_DEST}"
  SIZE=$(du -sh "${BLAKE3_DEST}" | cut -f1)
  info "copied ${BLAKE3_WHEEL} (${SIZE})"
fi

# ── 3. pychloride wheel — download from PyPI ──────────────────────────────────
# pychloride is a pure-Python (py3-none-any) WASM libsodium wrapper for Pyodide.
# Stored with a stable filename so pyodide_worker.ts can reference it without
# knowing the version that was current at download time.
PYCHLORIDE_STABLE="${WHEELS_DIR}/pychloride.whl"

if [[ -f "${PYCHLORIDE_STABLE}" ]] && [[ "${FORCE}" == "false" ]]; then
  info "already present: pychloride.whl"
else
  # Remove stale copy on --force
  if [[ "${FORCE}" == "true" ]]; then
    rm -f "${PYCHLORIDE_STABLE}" 2>/dev/null || true
  fi

  echo "  resolving pychloride wheel URL from PyPI..."
  WHEEL_URL=$(curl -fsSL "https://pypi.org/pypi/pychloride/json" | python3 -c "
import json, sys, re
data = json.load(sys.stdin)
files = data.get('urls', [])
for f in files:
    if f['filename'].endswith('.whl') and 'none-any' in f['filename']:
        print(f['url']); sys.exit(0)
# Fallback: scan all releases newest-first
releases = data.get('releases', {})
versions = sorted(releases.keys(), key=lambda v: [int(x) for x in re.findall(r'\d+', v)], reverse=True)
for ver in versions:
    for f in releases[ver]:
        if f['filename'].endswith('.whl') and 'none-any' in f['filename']:
            print(f['url']); sys.exit(0)
sys.exit(1)
")
  if [[ -z "${WHEEL_URL}" ]]; then
    error "Could not resolve pychloride wheel URL from PyPI"
    exit 1
  fi

  WHEEL_NAME=$(basename "${WHEEL_URL%%\?*}")
  echo "  downloading ${WHEEL_NAME}..."
  curl -fsSL --progress-bar "${WHEEL_URL}" -o "${PYCHLORIDE_STABLE}"
  SIZE=$(du -sh "${PYCHLORIDE_STABLE}" | cut -f1)
  info "downloaded pychloride.whl (from ${WHEEL_NAME}, ${SIZE})"
fi

# ── 4. Summary ────────────────────────────────────────────────────────────────────
echo ""
info "Pyodide assets ready at: ${OUT_DIR}"
echo ""
echo "Total size:"
du -sh "${OUT_DIR}"
echo ""
echo "To re-run from ios-wrapper/: make pyodide"
