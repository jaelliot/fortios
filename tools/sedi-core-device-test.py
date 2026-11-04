import argparse
import base64
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser(description="Run the synthetic Core SEDI test on a physical iPhone")
for option in ("device", "bundle", "xctestrun", "keripy", "fortweb", "output", "manifest-sha256", "fortweb-commit"):
    parser.add_argument(f"--{option}", required=True)
args = parser.parse_args()
KERIPY = Path(args.keripy).resolve(strict=True)
FORTWEB = Path(args.fortweb).resolve(strict=True)
TEST_RUN = Path(args.xctestrun).resolve(strict=True)
sys.path[:0] = [str(KERIPY / "src"), str(KERIPY)]
from keri.core import SerderKERI
from tests.sedi.test_ipex_sedi import _KRAM_CONFIG

DEVICE = args.device
BUNDLE = args.bundle
RUN_ID = str(uuid.uuid4())
REMOTE = f"Documents/sedi-core-qualification-{RUN_ID}"
ROOT = Path(args.output).resolve()
FIXTURE = FORTWEB / "playwright/fixtures/sedi-core-reference.py"
VERIFIER = FORTWEB / "playwright/fixtures/sedi-core-verifier.py"
MODES = ("valid", "wrong", "missing", "missing-agent", "missing-proof")
ROOT.mkdir(exist_ok=False)
children = {}
logs = {}
test_process = None

# The copied xctestrun keeps paths anchored to the original signed build.
with TEST_RUN.open("rb") as source:
    configuration = plistlib.load(source)


def anchor(value):
    if isinstance(value, str):
        return value.replace("__TESTROOT__", str(TEST_RUN.parent))
    if isinstance(value, list):
        return [anchor(item) for item in value]
    if isinstance(value, dict):
        return {key: anchor(item) for key, item in value.items()}
    return value


configuration = anchor(configuration)
targets = [target for config in configuration["TestConfigurations"]
           for target in config["TestTargets"] if target["BlueprintName"] == "KeriWalletTests"]
if len(targets) != 1 or targets[0]["TestHostBundleIdentifier"] != BUNDLE:
    raise ValueError("xctestrun does not target the requested development app")
target = targets[0]
app = Path(target["TestHostPath"])
with (app / "Info.plist").open("rb") as source:
    if plistlib.load(source)["CFBundleIdentifier"] != BUNDLE:
        raise ValueError("signed test host bundle identifier differs")
manifest_data = (app / "WebPayload/manifest.json").read_bytes()
if hashlib.sha256(manifest_data).hexdigest() != args.manifest_sha256:
    raise ValueError("signed test host manifest digest differs")
manifest = json.loads(manifest_data)
if manifest.get("fortweb_commit_sha") != args.fortweb_commit:
    raise ValueError("signed test host FortWeb commit differs")
payload = (app / "WebPayload").resolve(strict=True)
files = manifest.get("files")
if not isinstance(files, list) or not files:
    raise ValueError("payload manifest has no files")
for item in files:
    path = (payload / item["path"]).resolve(strict=True)
    if payload not in path.parents or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        raise ValueError("signed test host payload file failed verification")
installed_info = ROOT / "installed-app.json"
subprocess.run(["xcrun", "devicectl", "device", "info", "apps", "--device", DEVICE,
                "--bundle-id", BUNDLE, "--json-output", str(installed_info), "--timeout", "20"],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
apps = json.loads(installed_info.read_text())["result"]["apps"]
if len(apps) != 1 or apps[0].get("bundleIdentifier") != BUNDLE or not apps[0].get("builtByDeveloper"):
    raise ValueError("requested development app is not installed")
test_env = {"SEDI_TEST_RUN_ID": RUN_ID, "SEDI_MANIFEST_SHA256": args.manifest_sha256,
            "SEDI_FORTWEB_COMMIT": args.fortweb_commit, "SEDI_APP_BUNDLE_ID": BUNDLE}
target.setdefault("EnvironmentVariables", {}).update(test_env)
target.setdefault("TestingEnvironmentVariables", {}).update(test_env)
configured_run = ROOT / "configured.xctestrun"
with configured_run.open("wb") as destination:
    plistlib.dump(configuration, destination)
os.environ["PYTHONPATH"] = os.pathsep.join((str(KERIPY / "src"), str(KERIPY)))


def device_copy(direction, source, destination):
    return subprocess.run(
        ["xcrun", "devicectl", "device", "copy", direction, "--device", DEVICE,
         "--domain-type", "appDataContainer", "--domain-identifier", BUNDLE,
         "--source", str(source), "--destination", str(destination), "--timeout", "10"],
        capture_output=True, text=True, timeout=15,
    )


def receive(name, timeout=180):
    destination = ROOT / name
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if test_process is not None and test_process.poll() is not None:
            raise RuntimeError(f"XCTest ended before producing {name}")
        result = device_copy("from", f"{REMOTE}/{name}", destination)
        if result.returncode == 0 and destination.is_file():
            return destination
        time.sleep(0.1)
    raise TimeoutError(f"device did not provide {name}")


def send(name):
    result = device_copy("to", ROOT / name, f"{REMOTE}/{name}")
    if result.returncode:
        raise RuntimeError(f"device transfer failed for {name}: {result.stderr[-500:]}")


def wait_output(mode, marker, timeout=120):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        output = (ROOT / f"verifier-{mode}.log").read_text()
        if marker in output:
            return output
        if children[mode].poll() is not None:
            raise RuntimeError(f"{mode} verifier exited before {marker}")
        time.sleep(0.1)
    raise TimeoutError(f"{mode} verifier did not reach {marker}")


try:
    xcode_log = (ROOT / "xcodebuild.log").open("w")
    test_process = subprocess.Popen(
        ["xcodebuild", "test-without-building", "-xctestrun", str(configured_run),
         "-destination", f"platform=iOS,id={DEVICE}", "-resultBundlePath", str(ROOT / "result.xcresult"),
         "-parallel-testing-enabled", "NO", "-only-testing:KeriWalletTests/CoreSediDeviceTests/testSyntheticCorePresentation"],
        stdout=xcode_log, stderr=subprocess.STDOUT,
    )
    holder = json.loads(receive("holder.json").read_text())
    fixture = subprocess.run([sys.executable, FIXTURE, holder["holderAid"], holder["registryId"]],
                             check=True, capture_output=True).stdout
    json.loads(fixture)
    (ROOT / "fixture.json").write_bytes(fixture)
    (ROOT / "core-public-fixture.json").write_bytes(fixture)
    send("fixture.json")

    for mode in MODES:
        env = dict(os.environ, PYTHONUNBUFFERED="1", FORTWEB_NATIVE_WAIT="1",
                   FORTWEB_NATIVE_RECHECK="1" if mode == "valid" else "0")
        logs[mode] = (ROOT / f"verifier-{mode}.log").open("w")
        children[mode] = subprocess.Popen([sys.executable, VERIFIER, str(ROOT), mode], env=env,
                                          stdin=subprocess.PIPE, stdout=logs[mode],
                                          stderr=subprocess.STDOUT, text=True)
    for mode in MODES:
        wait_output(mode, "READY")
    ready = json.loads(receive("ready.json").read_text())
    if not ready.get("invalidRejected") or not ready.get("holderKelUnchanged"):
        raise AssertionError("invalid preflight changed the holder state or was accepted")
    (ROOT / "go.json").write_text("{}")
    send("go.json")

    transfer_start = time.monotonic()
    presentation_path = receive("fortweb-presentation.json")
    received_wall = datetime.now(timezone.utc)
    received_mono = time.monotonic()
    for child in children.values():
        child.stdin.write("go\n")
        child.stdin.flush()

    presentation = json.loads(presentation_path.read_text())
    cesr = base64.b64decode(presentation["exchange"]["cesr"], validate=True)
    digest = hashlib.sha256(cesr).hexdigest()
    timestamp = datetime.fromisoformat(SerderKERI(raw=cesr).ked["dt"])
    device_digest = receive("grant-cesr.sha256").read_text().strip()
    timing = json.loads(receive("grant-timing.json").read_text())
    if digest != device_digest:
        raise AssertionError("CESR SHA-256 mismatch across device transfer")

    outcomes = {}
    expected = {"wrong": "rejected wrong evidence", "missing": "rejected missing evidence",
                "missing-agent": "rejected missing-agent evidence", "missing-proof": "rejected missing-proof evidence"}
    for mode in MODES[1:]:
        code = children[mode].wait(timeout=120)
        output = (ROOT / f"verifier-{mode}.log").read_text()
        outcomes[mode] = code == 0 and expected[mode] in output and "kram intake accepted= True" in output
    valid_output = wait_output("valid", "ACCEPTED")
    outcomes["valid"] = "accepted Core Grant and all three authority nodes" in valid_output
    recovery = json.loads(receive("recovered.json").read_text())
    children["valid"].stdin.write("recheck\n")
    children["valid"].stdin.flush()
    code = children["valid"].wait(timeout=120)
    output = (ROOT / "verifier-valid.log").read_text()
    outcomes["rechecked"] = code == 0 and "rechecked the original accepted Core Grant" in output

    result = {"valid": outcomes["valid"], "wrong": outcomes["wrong"], "missing": outcomes["missing"],
              "missingAgent": outcomes["missing-agent"], "missingProof": outcomes["missing-proof"],
              "rechecked": outcomes["rechecked"]}
    (ROOT / "native-result.json").write_text(json.dumps(result))
    send("native-result.json")
    report = {"native": result, "recovery": recovery, "cesr_sha256": digest,
              "manifest_sha256": args.manifest_sha256, "fortweb_commit": args.fortweb_commit,
              "payload_file_count": len(files), "kram_config": _KRAM_CONFIG["kram"]["caches"]["~"],
              "grant_timestamp": timestamp.isoformat(), "device_export_unix": timing["wallSeconds"],
              "host_received": received_wall.isoformat(),
              "host_transfer_wait_seconds": received_mono - transfer_start,
              "grant_age_at_host_seconds": (received_wall - timestamp).total_seconds(),
              "device_export_after_grant_seconds": timing["wallSeconds"] - timestamp.timestamp()}
    exit_code = test_process.wait(timeout=120)
    report["xctest_exit_code"] = exit_code
    drift, short_lag, *_ = _KRAM_CONFIG["kram"]["caches"]["~"]
    while (datetime.now(timezone.utc) - timestamp).total_seconds() <= (drift + short_lag) / 1000 + 1:
        time.sleep(0.1)
    stale_env = dict(os.environ, FORTWEB_NATIVE_WAIT="0", FORTWEB_NATIVE_RECHECK="0")
    stale = subprocess.run([sys.executable, str(VERIFIER), str(ROOT), "valid"],
                           capture_output=True, text=True, timeout=120, env=stale_env)
    (ROOT / "verifier-stale.log").write_text(stale.stdout + stale.stderr)
    stale_rejected = stale.returncode != 0 and "kram intake accepted= False" in stale.stdout
    report["stale_rejected_by_kram"] = stale_rejected
    report["invalid_preflight_rejected_without_kel_change"] = True
    (ROOT / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)
    if exit_code or not all(result.values()) or not all(recovery.values()) or not stale_rejected:
        sys.exit(1)
finally:
    for child in children.values():
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=10)
    for log in logs.values():
        log.close()
    if test_process is not None and test_process.poll() is None:
        test_process.terminate()
        test_process.wait(timeout=30)
    if test_process is not None:
        xcode_log.close()
