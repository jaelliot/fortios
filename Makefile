.DEFAULT_GOAL := help

XCODE_PROJECT := xcodeproj/KeriWallet/KeriWallet.xcodeproj
SCHEME        := KeriWallet
SIMULATOR     := platform=iOS Simulator,name=iPhone 17 Pro
DERIVED_DATA  := build/DerivedData
TEST_RESULTS  := build/TestResults.xcresult

.PHONY: help setup pyodide sync build test open clean

help: ## Show available make targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## Install Node dependencies for the web payload (run once after clone)
	cd ../ios-pyodide-payload && npm ci

pyodide: ## Download Pyodide v0.29.1 runtime + crypto wheels (run once per machine)
	bash ../ios-pyodide-payload/scripts/download-pyodide.sh

sync: ## Build web payload and sync dist/ → WebPayload/
	./sync-payload.sh

build: ## Build KeriWallet for iOS Simulator (Debug)
	xcodebuild build \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR)' \
	  -derivedDataPath $(DERIVED_DATA)

test: ## Run all tests on iOS Simulator
	xcodebuild test \
	  -project $(XCODE_PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination '$(SIMULATOR)' \
	  -resultBundlePath $(TEST_RESULTS) \
	  -derivedDataPath $(DERIVED_DATA) \
	  -parallel-testing-enabled NO

open: ## Open KeriWallet.xcodeproj in Xcode
	open $(XCODE_PROJECT)

lint: ## Run SwiftLint on all Swift sources
	cd $(CURDIR) && swiftlint lint --config .swiftlint.yml --strict

clean: ## Remove build artifacts (DerivedData + test results)
	rm -rf $(DERIVED_DATA) $(TEST_RESULTS)
