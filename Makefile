.DEFAULT_GOAL := help

XCODE_PROJECT := xcodeproj/KeriWallet/KeriWallet.xcodeproj
SCHEME        := KeriWallet
SIMULATOR     := platform=iOS Simulator,name=iPhone 17 Pro
DERIVED_DATA  := build/DerivedData
TEST_RESULTS  := build/TestResults.xcresult

.PHONY: help setup pyodide sync build test-swift test-ts test-e2e test-e2e-slow test-all bridge-check lint lint-ts open clean

help: ## Show available make targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install Node dependencies for the web payload (run once after clone)
	npm ci

pyodide: ## Download Pyodide v0.29.1 runtime + crypto wheels (run once per machine)
	bash scripts/download-pyodide.sh

sync: ## Build web payload and sync dist/ → WebPayload/
	./sync-payload.sh

build: ## Build KeriWallet for iOS Simulator (Debug)
	xcodebuild build \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR)' \
	  -derivedDataPath $(DERIVED_DATA)

test-swift: ## Run Swift unit + UI tests on iOS Simulator
	xcodebuild test \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR)' \
	  -resultBundlePath $(TEST_RESULTS) \
	  -derivedDataPath $(DERIVED_DATA) \
	  -parallel-testing-enabled NO

test-ts: ## Run TypeScript unit tests (Vitest)
	npm run test

test-e2e: ## Run Playwright E2E tests (excludes @slow Pyodide tests)
	npm run build
	npx playwright test --grep-invert "@slow"

test-e2e-slow: ## Run all E2E tests including slow Pyodide roundtrip (120s timeout)
	npm run build
	npx playwright test

test-all: test-swift test-ts test-e2e ## Run Swift + TS + E2E tests

bridge-check: ## Verify bridge-contract.ts and BridgeContract.swift are up to date
	npm run bridge:check
	git diff --exit-code src/bridge-contract.ts xcodeproj/KeriWallet/KeriWallet/BridgeContract.swift

open: ## Open KeriWallet.xcodeproj in Xcode
	open $(XCODE_PROJECT)

lint: ## Run SwiftLint on all Swift sources (--strict)
	cd $(CURDIR) && swiftlint lint --config .swiftlint.yml --strict

lint-ts: ## Run TypeScript type check (tsc --noEmit)
	npm run typecheck

clean: ## Remove build artifacts (DerivedData, test results, dist)
	rm -rf $(DERIVED_DATA) $(TEST_RESULTS) dist
