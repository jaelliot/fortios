.DEFAULT_GOAL := help

XCODE_PROJECT := xcodeproj/KeriWallet/KeriWallet.xcodeproj
SCHEME        := KeriWallet
SIMULATOR_NAME ?= iPhone 16e
SIMULATOR_OS   ?= 18.6
SIMULATOR_UDID ?=
DEVICE_REF    ?=
DERIVED_DATA_ROOT := build/DerivedData
DERIVED_DATA_SIM := $(DERIVED_DATA_ROOT)/Simulator
DERIVED_DATA_DEVICE := $(DERIVED_DATA_ROOT)/Device
TEST_RESULTS  := build/TestResults-sim.xcresult
ARCHIVE_PATH  := build/KeriWallet.xcarchive
EXPORT_DIR    := build/export
EXPORT_OPTS   := ExportOptions.plist
APP_BUNDLE_ID := com.kerifoundation.wallet
SIM_APP       := $(DERIVED_DATA_SIM)/Build/Products/Debug-iphonesimulator/KeriWallet.app
DEVICE_APP    := $(DERIVED_DATA_DEVICE)/Build/Products/Debug-iphoneos/KeriWallet.app
PAYLOAD_MANIFEST := WebPayload/build-manifest.json
PAYLOAD_SOURCE ?= fortweb
FORTWEB_DIR ?= ../fortweb

ifneq ($(strip $(SIMULATOR_UDID)),)
SIMULATOR_DEST := platform=iOS Simulator,id=$(SIMULATOR_UDID),arch=arm64
SIMULATOR_DEVICE := $(SIMULATOR_UDID)
else
SIMULATOR_DEVICE := $(shell bash scripts/resolve-simulator-udid.sh "$(SIMULATOR_NAME)" "$(SIMULATOR_OS)" 2>/dev/null)
ifneq ($(strip $(SIMULATOR_DEVICE)),)
SIMULATOR_DEST := platform=iOS Simulator,id=$(SIMULATOR_DEVICE),arch=arm64
else
SIMULATOR_DEST := platform=iOS Simulator,name=$(SIMULATOR_NAME),OS=$(SIMULATOR_OS)
endif
endif

.PHONY: help setup pyodide sync ios-doctor ios-list-sims ios-list-devices require-simulator require-device-ref isolate-sim focus-sim build build-sim install-sim launch-sim run-sim build-device install-device launch-device run run-device dev-sim dev-device logs-sim logs-device open-console parity-manifest parity-smoke test-swift test-ts test-e2e test-e2e-slow test-all bridge-check lint lint-ts open clean archive export upload

help: ## Show available make targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── Shared targets (platform-agnostic — reusable by Fort-android) ─────────────

setup: ## Install Node dependencies for the web payload (run once after clone)
	npm ci

pyodide: ## Download Pyodide v0.29.1 runtime + crypto wheels (run once per machine)
	bash scripts/download-pyodide.sh

test-ts: ## Run TypeScript unit tests (Vitest)
	npm run test

test-e2e: ## Run Playwright E2E tests (excludes @slow Pyodide tests)
	npm run build
	npx playwright test --grep-invert "@slow"

test-e2e-slow: ## Run all E2E tests including slow Pyodide roundtrip (120s timeout)
	npm run build
	npx playwright test

bridge-check: ## Verify bridge-contract.ts, BridgeContract.swift, and BridgeContract.kt match JSON (Kotlin is gitignored; npm check still validates it on disk)
	npm run bridge:check
	git diff --exit-code src/bridge-contract.ts xcodeproj/KeriWallet/KeriWallet/BridgeContract.swift

lint-ts: ## Run TypeScript type check (tsc --noEmit)
	npm run typecheck

# ── iOS-only targets ──────────────────────────────────────────────────────────

sync: ## Build and sync the selected payload source (default: FortWeb convergence path)
	PAYLOAD_SOURCE=$(PAYLOAD_SOURCE) FORTWEB_DIR=$(FORTWEB_DIR) ./sync-payload.sh

sync-fortweb: ## Sync the FortWeb payload into WebPayload/ for the mainline convergence path
	PAYLOAD_SOURCE=fortweb FORTWEB_DIR=$(FORTWEB_DIR) ./sync-payload.sh

sync-fortios: ## Sync the blocked local Fort-ios proof shell into WebPayload/ (expected to fail closed)
	PAYLOAD_SOURCE=fort-ios FORTWEB_DIR=$(FORTWEB_DIR) ./sync-payload.sh

ios-doctor: ## Show local Xcode, simulator, and physical-device readiness
	@echo "Selected simulator destination: $(SIMULATOR_DEST)"
	@echo "Resolved simulator device: $(if $(SIMULATOR_DEVICE),$(SIMULATOR_DEVICE),<unresolved>)"
	@echo "Selected physical device ref: $(if $(DEVICE_REF),$(DEVICE_REF),<unset>)"
	@printf '\nXcode:\n'
	@xcode-select --version
	@xcode-select --print-path
	@xcodebuild -version
	@printf '\nSDKs:\n'
	@xcrun --sdk iphoneos --show-sdk-version
	@xcrun --sdk iphonesimulator --show-sdk-version
	@printf '\nArchitecture:\n'
	@uname -m
	@printf '\nBooted simulators:\n'
	@xcrun simctl list devices booted
	@printf '\nPhysical devices:\n'
	@xcrun devicectl list devices
	@if [ -n "$(DEVICE_REF)" ]; then \
	  printf '\nDevice details (%s):\n' "$(DEVICE_REF)"; \
	  xcrun devicectl device info details --device "$(DEVICE_REF)"; \
	fi

ios-list-sims: ## List available iPhone simulator destinations
	@xcrun simctl list devices available | grep -E 'iPhone '

ios-list-devices: ## List physical devices visible to Xcode CoreDevice
	@xcrun devicectl list devices

require-simulator: ## Ensure the configured simulator resolves to a device identifier
	@if [ -z "$(SIMULATOR_DEVICE)" ]; then \
	  echo "ERROR: unable to resolve simulator $(SIMULATOR_NAME) on iOS $(SIMULATOR_OS)."; \
	  echo "Run 'make ios-list-sims' or set SIMULATOR_UDID=<udid>."; \
	  exit 1; \
	fi

require-device-ref: ## Ensure a physical device reference is provided
	@if [ -z "$(DEVICE_REF)" ]; then \
	  echo "ERROR: DEVICE_REF is required for physical-device install, launch, and parity flows."; \
	  echo "Run 'make ios-list-devices' and retry with DEVICE_REF=<udid-or-name>."; \
	  exit 1; \
	fi

isolate-sim: require-simulator ## Shut down other booted iOS simulators so parity runs target a single visible simulator
	@python3 -c 'import json, subprocess, sys; target = sys.argv[1]; data = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "booted", "--json"], text=True)); shutdown = []; [shutdown.extend(device["udid"] for device in devices if device.get("state") == "Booted" and device.get("udid") != target and device.get("isAvailable", True) and device.get("name", "").startswith("iPhone")) for runtime, devices in data.get("devices", {}).items() if runtime.startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; print("No non-target booted iPhone simulators." if not shutdown else "Shutting down non-target iPhone simulators: " + ", ".join(shutdown)); [subprocess.run(["xcrun", "simctl", "shutdown", udid], check=True) for udid in shutdown]' "$(SIMULATOR_DEVICE)"

focus-sim: require-simulator ## Boot, select, and foreground the configured simulator
	@xcrun simctl boot "$(SIMULATOR_DEVICE)" >/dev/null 2>&1 || true
	@xcrun simctl bootstatus "$(SIMULATOR_DEVICE)" -b
	@open -a Simulator --args -CurrentDeviceUDID "$(SIMULATOR_DEVICE)"
	@osascript -e 'tell application "Simulator" to activate' >/dev/null

build-sim: require-simulator ## Build KeriWallet for iOS Simulator (Debug)
	xcodebuild build \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR_DEST)' \
	  -derivedDataPath $(DERIVED_DATA_SIM)

build: build-sim ## Alias for simulator build

install-sim: focus-sim build-sim ## Install the app onto the configured simulator
	xcrun simctl install "$(SIMULATOR_DEVICE)" "$(SIM_APP)"

launch-sim: focus-sim install-sim ## Launch the app on the configured simulator
	xcrun simctl launch --terminate-running-process "$(SIMULATOR_DEVICE)" "$(APP_BUNDLE_ID)"

run-sim: launch-sim ## Build, install, and launch on the configured simulator

build-device: sync ## Build KeriWallet for generic iOS device output (Debug, auto-signing)
	xcodebuild build \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination 'generic/platform=iOS' \
	  -derivedDataPath $(DERIVED_DATA_DEVICE) \
	  -allowProvisioningUpdates

install-device: require-device-ref build-device ## Install the app onto the selected physical device
	xcrun devicectl device install app --device "$(DEVICE_REF)" "$(DEVICE_APP)"

launch-device: require-device-ref install-device ## Launch the app on the selected physical device
	xcrun devicectl device process launch --device "$(DEVICE_REF)" --terminate-existing "$(APP_BUNDLE_ID)"

run-device: launch-device ## Build, install, and launch on the selected physical device

run: run-device ## Alias for physical-device run

dev-sim: sync lint-ts test-ts build-sim ## Fast local loop: sync payload, validate TS, build for Simulator

dev-device: sync lint-ts test-ts build-device ## Fast local loop: sync payload, validate TS, build for physical device

logs-sim: ## Tail KeriWallet logs from the booted Simulator
	xcrun simctl spawn booted log stream --style compact --predicate 'process == "KeriWallet"'

logs-device: require-device-ref ## Print the device log workflow for the selected physical device
	@echo "Device log capture is GUI-backed in the first pass." 
	@echo "Open Console.app, select '$(DEVICE_REF)', then filter for process 'KeriWallet' or subsystem '$(APP_BUNDLE_ID)'."
	@open -a Console

open-console: ## Open macOS Console for physical device logs
	open -a Console

parity-manifest: build-sim build-device ## Compare bundled payload manifests across simulator and device builds
	@if [ ! -f "$(PAYLOAD_MANIFEST)" ]; then \
	  echo "ERROR: missing payload manifest at $(PAYLOAD_MANIFEST). Run 'make sync' first."; \
	  exit 1; \
	fi
	@if [ ! -f "$(SIM_APP)/WebPayload/build-manifest.json" ]; then \
	  echo "ERROR: simulator manifest missing from $(SIM_APP)."; \
	  exit 1; \
	fi
	@if [ ! -f "$(DEVICE_APP)/WebPayload/build-manifest.json" ]; then \
	  echo "ERROR: device manifest missing from $(DEVICE_APP)."; \
	  exit 1; \
	fi
	@python3 -c 'import json, sys; labels = ["payload", "simulator", "device"]; hashes = {label: json.load(open(path, "r", encoding="utf-8"))["dist_tree_sha256"] for label, path in zip(labels, sys.argv[1:])}; print("payload  ", hashes["payload"]); print("simulator", hashes["simulator"]); print("device   ", hashes["device"]); raise SystemExit(0 if len(set(hashes.values())) == 1 else "ERROR: payload manifest hash mismatch across destinations")' "$(PAYLOAD_MANIFEST)" "$(SIM_APP)/WebPayload/build-manifest.json" "$(DEVICE_APP)/WebPayload/build-manifest.json"
	@echo "parity-manifest ok: all destinations reference the same payload hash"

parity-smoke: require-device-ref sync isolate-sim run-sim run-device parity-manifest ## Build, install, launch, and verify manifest parity for sim + device
	@echo "parity-smoke ok: both destinations launched from the same payload hash."
	@echo "Next manual step: on both destinations tap 'Seed Test Data' then 'List Identifiers' and compare the visible result plus logs."

test-swift: ## Run Swift unit + UI tests on iOS Simulator
	xcodebuild test \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR_DEST)' \
	  -resultBundlePath $(TEST_RESULTS) \
	  -derivedDataPath $(DERIVED_DATA_SIM) \
	  -parallel-testing-enabled NO

test-all: test-swift test-ts test-e2e ## Run Swift + TS + E2E tests

open: ## Open KeriWallet.xcodeproj in Xcode
	open $(XCODE_PROJECT)

lint: ## Run SwiftLint on all Swift sources (--strict)
	cd $(CURDIR) && swiftlint lint --config .swiftlint.yml --strict

clean: ## Remove build artifacts (DerivedData, test results, dist)
	rm -rf $(DERIVED_DATA_ROOT) $(TEST_RESULTS) $(ARCHIVE_PATH) $(EXPORT_DIR) dist

# ── TestFlight targets ────────────────────────────────────────────────────────

archive: sync ## Archive KeriWallet for App Store (Release)
	xcodebuild archive \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Release \
	  -archivePath $(ARCHIVE_PATH) \
	  -destination 'generic/platform=iOS' \
	  -allowProvisioningUpdates

export: archive ## Export .ipa from archive using ExportOptions.plist
	@if [ ! -f $(EXPORT_OPTS) ]; then \
	  echo "ERROR: $(EXPORT_OPTS) not found — copy ExportOptions.plist.example and fill in your Team ID"; \
	  exit 1; \
	fi
	xcodebuild -exportArchive \
	  -archivePath $(ARCHIVE_PATH) \
	  -exportOptionsPlist $(EXPORT_OPTS) \
	  -exportPath $(EXPORT_DIR) \
	  -allowProvisioningUpdates

upload: export ## Upload .ipa to App Store Connect / TestFlight
	@IPA=$$(find $(EXPORT_DIR) -name '*.ipa' -print -quit); \
	if [ -z "$$IPA" ]; then echo "ERROR: no .ipa found in $(EXPORT_DIR)"; exit 1; fi; \
	echo "Uploading $$IPA to App Store Connect..."; \
	xcrun altool --upload-app -f "$$IPA" -t ios --apiKey "$$APP_STORE_API_KEY" --apiIssuer "$$APP_STORE_API_ISSUER"
