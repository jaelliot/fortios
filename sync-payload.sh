#!/usr/bin/env bash
# ── sync-payload.sh ───────────────────────────────────────────────────────────
#
# Stage the shipped FortWeb product-shell payload into WebPayload/.
# This is the only supported wrapper sync path for upstream Fort-ios.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_SOURCE="${PAYLOAD_SOURCE:-fortweb}"
FORTWEB_DIR="${FORTWEB_DIR:-${SCRIPT_DIR}/../fortweb}"
FORTWEB_REMOTE="${FORTWEB_REMOTE:-https://github.com/keri-foundation/fortweb.git}"
FORTWEB_REF="${FORTWEB_REF:-214643f4fa907061334c09c8297c4d1e59f18f45}"
WRAPPER_PAYLOAD_DIR="${SCRIPT_DIR}/WebPayload"
FORTWEB_MANIFEST_TOOL="${SCRIPT_DIR}/tools/gen-fortweb-bundle-manifest.mjs"
PAYLOAD_VALIDATOR="${SCRIPT_DIR}/tools/validate-mobile-payload.mjs"

FETCH_MODE=0
TEMP_ROOT=""
FORTWEB_SOURCE_DIR=""

case "${FORTWEB_FETCH:-0}" in
  1|true|TRUE|yes|YES)
    FETCH_MODE=1
    ;;
  0|false|FALSE|no|NO|"")
    ;;
  *)
    echo "error: unsupported FORTWEB_FETCH=${FORTWEB_FETCH}" 1>&2
    exit 1
    ;;
esac

usage() {
  cat <<'EOF'
Usage: ./sync-payload.sh [--fetch] [--ref <commit-or-tag-or-branch>] [--remote <git-url>] [--fortweb-dir <path>]

Defaults to a sibling FortWeb checkout at ../fortweb.

Options:
  --fetch                 Download a temporary FortWeb checkout instead of using ../fortweb.
  --ref <ref>             Commit, tag, or branch to fetch when --fetch is used.
                          Default: 214643f4fa907061334c09c8297c4d1e59f18f45.
  --remote <git-url>      Git remote used with --fetch.
  --fortweb-dir <path>    Explicit local FortWeb checkout path.
  --help                  Show this message.
EOF
}

cleanup() {
  if [[ -n "${TEMP_ROOT}" && -d "${TEMP_ROOT}" ]]; then
    rm -rf "${TEMP_ROOT}"
  fi
}

trap cleanup EXIT

require_option_value() {
  local option_name="$1"

  if [[ $# -lt 2 || -z "${2-}" ]]; then
    echo "error: ${option_name} requires a value" 1>&2
    usage 1>&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fetch)
      FETCH_MODE=1
      ;;
    --ref)
      require_option_value "$1" "${2-}"
      FORTWEB_REF="$2"
      shift
      ;;
    --remote)
      require_option_value "$1" "${2-}"
      FORTWEB_REMOTE="$2"
      shift
      ;;
    --fortweb-dir)
      require_option_value "$1" "${2-}"
      FORTWEB_DIR="$2"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" 1>&2
      usage 1>&2
      exit 1
      ;;
  esac
  shift
done

require_file() {
  local file_path="$1"
  local label="$2"

  if [[ ! -f "${file_path}" ]]; then
    echo "error: ${label} missing at ${file_path}" 1>&2
    exit 1
  fi
}

require_dir() {
  local dir_path="$1"
  local label="$2"

  if [[ ! -d "${dir_path}" ]]; then
    echo "error: ${label} missing at ${dir_path}" 1>&2
    exit 1
  fi
}

verify_fortweb_runtime_js() {
  if [[ "${FETCH_MODE}" -eq 1 ]]; then
    echo "[sync-payload] skipping runtime JS freshness check for fetched FortWeb ref=${FORTWEB_REF}"
    return
  fi

  require_file "${FORTWEB_SOURCE_DIR}/package.json" "FortWeb package.json"
  require_file "${FORTWEB_SOURCE_DIR}/tools/check-runtime-js.mjs" "FortWeb runtime JS checker"

  if ! command -v npm >/dev/null 2>&1; then
    echo "error: npm is required to verify FortWeb runtime JavaScript freshness before staging a local checkout" 1>&2
    echo "       Install npm or stage from a fetched immutable ref with FORTWEB_FETCH=1." 1>&2
    exit 1
  fi

  echo "[sync-payload] verifying FortWeb runtime JavaScript freshness"
  (
    cd "${FORTWEB_SOURCE_DIR}"
    npm run check:runtime-js
  )
}

resolve_fortweb_source() {
  if [[ "${FETCH_MODE}" -eq 1 ]]; then
    if ! command -v git >/dev/null 2>&1; then
      echo "error: git is required for --fetch mode" 1>&2
      exit 1
    fi

    TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fortweb-fetch.XXXXXX")"
    FORTWEB_SOURCE_DIR="${TEMP_ROOT}/fortweb"

    echo "[sync-payload] fetching FortWeb ref=${FORTWEB_REF} from ${FORTWEB_REMOTE}"
    mkdir -p "${FORTWEB_SOURCE_DIR}"
    git -C "${FORTWEB_SOURCE_DIR}" init >/dev/null 2>&1
    git -C "${FORTWEB_SOURCE_DIR}" remote add origin "${FORTWEB_REMOTE}" >/dev/null 2>&1 || true
    if ! git -C "${FORTWEB_SOURCE_DIR}" fetch --depth 1 origin "${FORTWEB_REF}" >/dev/null 2>&1; then
      echo "error: failed to fetch FortWeb remote ${FORTWEB_REMOTE} at ref ${FORTWEB_REF}" 1>&2
      echo "       Use a valid commit, tag, or branch with --ref, or point to a local checkout with --fortweb-dir." 1>&2
      exit 1
    fi
    git -C "${FORTWEB_SOURCE_DIR}" checkout --detach FETCH_HEAD >/dev/null 2>&1
    return
  fi

  if [[ -d "${FORTWEB_DIR}" ]]; then
    FORTWEB_SOURCE_DIR="${FORTWEB_DIR}"
    return
  fi

  echo "error: FortWeb repo not found at ${FORTWEB_DIR}" 1>&2
  echo "       Run './sync-payload.sh --fetch --ref ${FORTWEB_REF}' to fetch a temporary payload source." 1>&2
  exit 1
}

write_fortweb_redirect() {
  cat > "${WRAPPER_PAYLOAD_DIR}/index.html" <<'EOF'
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>KERI Wallet</title>
  <script>
    window.location.replace('./fortweb/app/index.html');
  </script>
</head>
<body></body>
</html>
EOF
}

write_fortweb_manifest() {
  local build_command='PAYLOAD_SOURCE=fortweb ./sync-payload.sh'

  if [[ "${FETCH_MODE}" -eq 1 ]]; then
    build_command="PAYLOAD_SOURCE=fortweb FORTWEB_FETCH=1 FORTWEB_REF=${FORTWEB_REF} FORTWEB_REMOTE=${FORTWEB_REMOTE} ./sync-payload.sh"
  fi

  node "${FORTWEB_MANIFEST_TOOL}" \
    --payload-root "${WRAPPER_PAYLOAD_DIR}" \
    --fortweb-dir "${FORTWEB_SOURCE_DIR}" \
    --build-command "${build_command}"
}

sync_fortweb_payload() {
  resolve_fortweb_source
  verify_fortweb_runtime_js

  require_file "${FORTWEB_SOURCE_DIR}/app/index.html" "FortWeb app/index.html"
  require_file "${FORTWEB_SOURCE_DIR}/pyscript-ci.toml" "FortWeb pyscript-ci.toml"
  require_dir "${FORTWEB_SOURCE_DIR}/vendor" "FortWeb vendor directory"
  require_dir "${FORTWEB_SOURCE_DIR}/wheels" "FortWeb wheels directory"

  echo "[sync-payload] syncing FortWeb payload into wrapper WebPayload/"
  mkdir -p "${WRAPPER_PAYLOAD_DIR}"
  rm -rf "${WRAPPER_PAYLOAD_DIR}"/*
  mkdir -p "${WRAPPER_PAYLOAD_DIR}/fortweb"
  cp -R "${FORTWEB_SOURCE_DIR}/app" "${WRAPPER_PAYLOAD_DIR}/fortweb/app"
  cp -R "${FORTWEB_SOURCE_DIR}/vendor" "${WRAPPER_PAYLOAD_DIR}/fortweb/vendor"
  cp -R "${FORTWEB_SOURCE_DIR}/wheels" "${WRAPPER_PAYLOAD_DIR}/fortweb/wheels"
  cp "${FORTWEB_SOURCE_DIR}/pyscript-ci.toml" "${WRAPPER_PAYLOAD_DIR}/fortweb/pyscript-ci.toml"
  write_fortweb_redirect
  write_fortweb_manifest
}

case "${PAYLOAD_SOURCE}" in
  fortweb)
    sync_fortweb_payload
    ;;
  *)
    echo "error: unsupported PAYLOAD_SOURCE=${PAYLOAD_SOURCE}" 1>&2
    echo "       Only PAYLOAD_SOURCE=fortweb is supported for live wrapper sync." 1>&2
    exit 1
    ;;
esac

node "${PAYLOAD_VALIDATOR}" \
  --payload-dir "${WRAPPER_PAYLOAD_DIR}" \
  --target ios-webpayload

if [[ ! -f "${WRAPPER_PAYLOAD_DIR}/index.html" ]]; then
  echo "error: expected index.html missing after sync" 1>&2
  exit 1
fi

if [[ ! -f "${WRAPPER_PAYLOAD_DIR}/build-manifest.json" ]]; then
  echo "error: expected build-manifest.json missing after sync" 1>&2
  exit 1
fi

FILE_COUNT=$(find "${WRAPPER_PAYLOAD_DIR}" -type f | wc -l | tr -d ' ')
DIST_HASH=$(python3 - <<'PY' "${WRAPPER_PAYLOAD_DIR}/build-manifest.json"
import json
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as fp:
    print(json.load(fp)['dist_tree_sha256'])
PY
)

if [[ "${FETCH_MODE}" -eq 1 ]]; then
  SOURCE_LABEL="fetch:${FORTWEB_REMOTE}@${FORTWEB_REF}"
else
  SOURCE_LABEL="local:${FORTWEB_SOURCE_DIR}"
fi

echo "[sync-payload] ok: source=${SOURCE_LABEL} files=${FILE_COUNT} dist_tree_sha256=${DIST_HASH}"
