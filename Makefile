.DEFAULT_GOAL := help

XCODE_PROJECT := xcodeproj/KeriWallet/KeriWallet.xcodeproj
SCHEME        := KeriWallet
APP_BUNDLE_ID := com.kerifoundation.wallet
PAYLOAD_SOURCE ?= fort-ios
FORTWEB_DIR   ?= ../fortweb
SIMULATOR_NAME ?= iPhone 17 Pro
SIMULATOR     := platform=iOS Simulator,name=$(SIMULATOR_NAME)
SIM_DERIVED_DATA := build/DerivedData-sim
DEVICE_DERIVED_DATA := build/DerivedData-device
TEST_RESULTS  := build/TestResults.xcresult
ARCHIVE_PATH  := build/KeriWallet.xcarchive
EXPORT_DIR    := build/export
EXPORT_OPTS   := ExportOptions.plist
SIM_APP_PATH  := $(SIM_DERIVED_DATA)/Build/Products/Debug-iphonesimulator/KeriWallet.app
DEVICE_APP_PATH := $(DEVICE_DERIVED_DATA)/Build/Products/Debug-iphoneos/KeriWallet.app
DEVICE_REF    ?=

.PHONY: help setup pyodide sync sync-fortweb ios-doctor ios-list-sims ios-list-devices dev-sim run-sim dev-device run-device parity-smoke logs-sim logs-device build test-swift test-ts test-e2e test-e2e-slow test-all bridge-check lint lint-ts open clean archive export upload

help: ## Show available make targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

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

bridge-check: ## Verify bridge-contract.ts, BridgeContract.swift, and BridgeContract.kt are up to date
	npm run bridge:check
	git diff --exit-code src/bridge-contract.ts xcodeproj/KeriWallet/KeriWallet/BridgeContract.swift generated/BridgeContract.kt

lint-ts: ## Run TypeScript type check (tsc --noEmit)
	npm run typecheck

# ── iOS-only targets ──────────────────────────────────────────────────────────

sync: ## Build web payload and sync dist/ → WebPayload/
	PAYLOAD_SOURCE=$(PAYLOAD_SOURCE) FORTWEB_DIR=$(FORTWEB_DIR) ./sync-payload.sh

sync-fortweb: ## Sync the FortWeb payload into WebPayload/ for iOS hosting tests
	PAYLOAD_SOURCE=fortweb FORTWEB_DIR=$(FORTWEB_DIR) ./sync-payload.sh

ios-list-sims: ## List available iOS Simulator destinations
	xcrun simctl list devices available

ios-list-devices: ## List CoreDevice-visible physical devices
	xcrun devicectl list devices

ios-doctor: ## Verify Xcode, simulator, and payload-source readiness
	@command -v xcodebuild >/dev/null || (echo "ERROR: xcodebuild not found" && exit 1)
	@command -v xcrun >/dev/null || (echo "ERROR: xcrun not found" && exit 1)
	@echo "payload-source=$(PAYLOAD_SOURCE)"
	@if [ "$(PAYLOAD_SOURCE)" = "fortweb" ]; then \
		[ -d "$(FORTWEB_DIR)" ] || (echo "ERROR: FortWeb repo not found at $(FORTWEB_DIR)" && exit 1); \
		[ -f "$(FORTWEB_DIR)/app/index.html" ] || (echo "ERROR: FortWeb app/index.html missing" && exit 1); \
		[ -f "$(FORTWEB_DIR)/pyscript-ci.toml" ] || (echo "ERROR: FortWeb pyscript-ci.toml missing" && exit 1); \
	fi
	@xcrun simctl list devices available | grep -q "$(SIMULATOR_NAME)" || (echo "ERROR: Simulator '$(SIMULATOR_NAME)' not available" && exit 1)
	@echo "simulator=$(SIMULATOR_NAME)"
	@xcrun devicectl list devices >/dev/null 2>&1 || echo "warning: no physical device available via CoreDevice"

dev-sim: sync lint-ts test-ts build ## Sync payload, run TS checks, and build for Simulator

run-sim: ## Boot, install, and launch on the configured Simulator
	open -a Simulator || true
	xcrun simctl boot "$(SIMULATOR_NAME)" || true
	xcrun simctl bootstatus "$(SIMULATOR_NAME)" -b
	xcrun simctl install booted "$(SIM_APP_PATH)"
	xcrun simctl launch booted $(APP_BUNDLE_ID)

dev-device: sync ## Sync payload and build for a generic iOS device output
	xcodebuild build \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination 'generic/platform=iOS' \
	  -derivedDataPath $(DEVICE_DERIVED_DATA)

run-device: ## Install and launch on a physical device (use DEVICE_REF=<udid-or-name>)
	@if [ -z "$(DEVICE_REF)" ]; then \
		echo "ERROR: DEVICE_REF is required"; \
		echo "Run: make ios-list-devices"; \
		exit 1; \
	fi
	xcrun devicectl device install app --device "$(DEVICE_REF)" "$(DEVICE_APP_PATH)"
	xcrun devicectl device process launch --device "$(DEVICE_REF)" --terminate-existing $(APP_BUNDLE_ID)

parity-smoke: ## Run the shared payload through simulator then device (requires DEVICE_REF)
	@if [ -z "$(DEVICE_REF)" ]; then \
		echo "ERROR: DEVICE_REF is required"; \
		echo "Run: make ios-list-devices"; \
		exit 1; \
	fi
	xcrun simctl shutdown all || true
	$(MAKE) dev-sim PAYLOAD_SOURCE=$(PAYLOAD_SOURCE) FORTWEB_DIR=$(FORTWEB_DIR)
	$(MAKE) run-sim PAYLOAD_SOURCE=$(PAYLOAD_SOURCE) FORTWEB_DIR=$(FORTWEB_DIR)
	$(MAKE) dev-device PAYLOAD_SOURCE=$(PAYLOAD_SOURCE) FORTWEB_DIR=$(FORTWEB_DIR)
	$(MAKE) run-device PAYLOAD_SOURCE=$(PAYLOAD_SOURCE) FORTWEB_DIR=$(FORTWEB_DIR) DEVICE_REF="$(DEVICE_REF)"

logs-sim: ## Show recent simulator logs for KeriWallet
	xcrun simctl spawn booted log show --style compact --last 10m --predicate 'process == "KeriWallet" OR eventMessage CONTAINS[c] "WebBridge" OR eventMessage CONTAINS[c] "WebContainer" OR eventMessage CONTAINS[c] "SchemeHandler"' | tail -n 200

logs-device: ## Relaunch on device with console attached (use DEVICE_REF=<udid-or-name>)
	@if [ -z "$(DEVICE_REF)" ]; then \
		echo "ERROR: DEVICE_REF is required"; \
		echo "Run: make ios-list-devices"; \
		exit 1; \
	fi
	xcrun devicectl device process launch --device "$(DEVICE_REF)" --terminate-existing --console $(APP_BUNDLE_ID)

build: ## Build KeriWallet for iOS Simulator (Debug)
	xcodebuild build \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR)' \
	  -derivedDataPath $(SIM_DERIVED_DATA)

test-swift: ## Run Swift unit + UI tests on iOS Simulator
	xcodebuild test \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR)' \
	  -resultBundlePath $(TEST_RESULTS) \
	  -derivedDataPath $(SIM_DERIVED_DATA) \
	  -parallel-testing-enabled NO

test-all: test-swift test-ts test-e2e ## Run Swift + TS + E2E tests

open: ## Open KeriWallet.xcodeproj in Xcode
	open $(XCODE_PROJECT)

lint: ## Run SwiftLint on all Swift sources (--strict)
	cd $(CURDIR) && swiftlint lint --config .swiftlint.yml --strict

clean: ## Remove build artifacts (DerivedData, test results, dist)
	rm -rf $(SIM_DERIVED_DATA) $(DEVICE_DERIVED_DATA) $(TEST_RESULTS) $(ARCHIVE_PATH) $(EXPORT_DIR) dist

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
