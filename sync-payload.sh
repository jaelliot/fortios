#!/usr/bin/env bash
# ── sync-payload.sh ───────────────────────────────────────────────────────────
#
# iOS-specific payload sync entrypoint.
#
# Supports two payload sources:
#   1. fort-ios  — local Vite/TypeScript payload built via build-payload.sh
#   2. fortweb   — static FortWeb payload copied into WebPayload/fortweb/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_SOURCE="${PAYLOAD_SOURCE:-fort-ios}"
FORTWEB_DIR="${FORTWEB_DIR:-${SCRIPT_DIR}/../fortweb}"
WRAPPER_PAYLOAD_DIR="${SCRIPT_DIR}/WebPayload"

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
	FORTWEB_DIR="${FORTWEB_DIR}" WRAPPER_PAYLOAD_DIR="${WRAPPER_PAYLOAD_DIR}" python3 - <<'PY'
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone

root = os.environ["WRAPPER_PAYLOAD_DIR"]
fortweb_dir = os.environ["FORTWEB_DIR"]


def iter_files():
    for current_root, _, files in os.walk(root):
        for filename in files:
            rel = os.path.relpath(os.path.join(current_root, filename), root)
            if rel == "build-manifest.json":
                continue
            yield rel


digest = hashlib.sha256()
for rel in sorted(iter_files()):
    digest.update(rel.encode("utf-8"))
    digest.update(b"\0")
    with open(os.path.join(root, rel), "rb") as fp:
        digest.update(fp.read())
    digest.update(b"\0")

try:
    git_sha = subprocess.check_output(
        ["git", "-C", fortweb_dir, "rev-parse", "HEAD"],
        text=True,
        stderr=subprocess.DEVNULL,
    ).strip()
except Exception:
    git_sha = None

manifest = {
    "schema": 1,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "git_sha": git_sha,
    "node_version": None,
    "package_lock_sha256": None,
    "dist_tree_sha256": digest.hexdigest(),
    "payload_source": "fortweb",
}

with open(os.path.join(root, "build-manifest.json"), "w", encoding="utf-8") as fp:
    json.dump(manifest, fp, indent=2)
    fp.write("\n")
PY
}

sync_fortios_payload() {
	# ── Step 1: Run platform-agnostic build ─────────────────────────────────────
	source "${SCRIPT_DIR}/build-payload.sh"

	# ── Step 2: App Store compliance — sanitize itms-services ───────────────────
	STDLIB_ZIP="${PAYLOAD_DIST_DIR}/pyodide/python_stdlib.zip"
	if [[ -f "${STDLIB_ZIP}" ]]; then
		SCRATCH=$(mktemp -d)
		trap 'rm -rf "${SCRATCH}"' EXIT
		unzip -q "${STDLIB_ZIP}" -d "${SCRATCH}"
		find "${SCRATCH}" -type d -name "__pycache__" -exec rm -r {} + 2>/dev/null || true
		find "${SCRATCH}" -type f -name '*.pyc' -delete
		find "${SCRATCH}" -type f -name '*.py' -exec \
			perl -pi -e 's/itms-services/itms_services/g' {} +
		(cd "${SCRATCH}" && zip -qr "${STDLIB_ZIP}" .)
		echo "[sync-payload] sanitized itms-services in python_stdlib.zip (*.pyc purged)"
		rm -rf "${SCRATCH}"
		trap - EXIT
	fi

	# ── Step 3: Sync dist/ → WebPayload/ ────────────────────────────────────────
	echo "[sync-payload] syncing into wrapper WebPayload/"
	mkdir -p "${WRAPPER_PAYLOAD_DIR}"
	rm -rf "${WRAPPER_PAYLOAD_DIR}"/*
	cp -R "${PAYLOAD_DIST_DIR}"/. "${WRAPPER_PAYLOAD_DIR}/"
}

sync_fortweb_payload() {
	if [[ ! -d "${FORTWEB_DIR}" ]]; then
		echo "error: FortWeb repo not found at ${FORTWEB_DIR}" 1>&2
		exit 1
	fi

	if [[ ! -f "${FORTWEB_DIR}/app/index.html" ]]; then
		echo "error: FortWeb app/index.html missing at ${FORTWEB_DIR}/app/index.html" 1>&2
		exit 1
	fi

	if [[ ! -f "${FORTWEB_DIR}/pyscript-ci.toml" ]]; then
		echo "error: FortWeb pyscript-ci.toml missing at ${FORTWEB_DIR}/pyscript-ci.toml" 1>&2
		exit 1
	fi

	echo "[sync-payload] syncing FortWeb payload into wrapper WebPayload/"
	mkdir -p "${WRAPPER_PAYLOAD_DIR}"
	rm -rf "${WRAPPER_PAYLOAD_DIR}"/*
	mkdir -p "${WRAPPER_PAYLOAD_DIR}/fortweb"
	cp -R "${FORTWEB_DIR}/app" "${WRAPPER_PAYLOAD_DIR}/fortweb/app"
	cp -R "${FORTWEB_DIR}/vendor" "${WRAPPER_PAYLOAD_DIR}/fortweb/vendor"
	cp -R "${FORTWEB_DIR}/wheels" "${WRAPPER_PAYLOAD_DIR}/fortweb/wheels"
	cp "${FORTWEB_DIR}/pyscript-ci.toml" "${WRAPPER_PAYLOAD_DIR}/fortweb/pyscript-ci.toml"
	write_fortweb_redirect
	write_fortweb_manifest
}

case "${PAYLOAD_SOURCE}" in
	fort-ios)
		sync_fortios_payload
		;;
	fortweb)
		sync_fortweb_payload
		;;
	*)
		echo "error: unsupported PAYLOAD_SOURCE=${PAYLOAD_SOURCE}" 1>&2
		exit 1
		;;
esac

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
DIST_HASH=$(python3 - <<'PY' "${WRAPPER_PAYLOAD_DIR}/build-manifest.json"
import json
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as fp:
    print(json.load(fp)['dist_tree_sha256'])
PY
)

echo "[sync-payload] ok: source=${PAYLOAD_SOURCE} files=${FILE_COUNT} dist_tree_sha256=${DIST_HASH}"
