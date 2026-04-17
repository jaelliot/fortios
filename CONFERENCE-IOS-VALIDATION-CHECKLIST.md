# Conference iOS Validation Checklist

This checklist is the conference acceptance script for the FortWeb-hosted payload inside the iOS wrapper.

Scope covered by this script:
- Vault create/open/switch
- Identifiers core flow
- Remotes core flow
- Settings read-only
- KERI Foundation witnesses/watchers pages

## 1. Baseline Preconditions

Run from repo root:

```sh
PAYLOAD_SOURCE=fortweb make ios-doctor
make bridge-check
make lint-ts
make test-ts
make test-e2e
```

Expected:
- All commands exit 0.
- No bridge contract drift.
- No Playwright structural failures.

## 2. Simulator Pass

Build and run:

```sh
PAYLOAD_SOURCE=fortweb make dev-sim
PAYLOAD_SOURCE=fortweb make run-sim
make logs-sim
```

Use simulator `iPhone 17 Pro` unless a different target is explicitly required.

### Flow A - Vault create/open/switch

1. Open app and confirm first screen loads with no blank white view.
2. Create a new vault with alias and passcode.
3. Open that vault with passcode.
4. Lock and reopen the same vault.
5. Switch to another vault if available.

Expected:
- No crash.
- No stuck loading state.
- Vault summary updates after open/switch.

### Flow B - Identifiers core

1. Navigate to Identifiers.
2. List identifiers for current vault.
3. Create a new identifier.
4. Open identifier detail page.
5. Return to list.

Expected:
- New identifier appears in list.
- Detail view renders without broken fields.

### Flow C - Remotes core

1. Navigate to Remotes.
2. Verify remotes list renders.
3. Add/resolve remote via OOBI path.
4. Open remote detail page.
5. Return to list.

Expected:
- No unhandled runtime errors.
- Remote changes appear after action completes.

### Flow D - Settings read-only

1. Navigate to Settings.
2. Verify settings sections render.
3. Verify diagnostics/build information is visible.

Expected:
- Settings page fully renders.
- No missing labels/value placeholders.

### Flow E - KF witnesses/watchers pages

1. Navigate to KF Witnesses.
2. Navigate to KF Watchers.
3. Trigger refresh/status actions if available.

Expected:
- Pages load and remain interactive.
- Any unavailable backend state is shown as bounded UX, not a crash.

### Simulator UI Acceptance

Expected:
- Header content is not clipped by notch/Dynamic Island.
- Tab bar is not blocked by home indicator.
- Touch targets are usable.
- Keyboard does not permanently obscure critical form actions.

## 3. Physical Device Parity Pass

List and select a device:

```sh
make ios-list-devices
```

Run parity smoke on selected device:

```sh
PAYLOAD_SOURCE=fortweb make parity-smoke DEVICE_REF=<udid-or-name>
make logs-device DEVICE_REF=<udid-or-name>
```

Repeat Flows A-E on device.

Expected:
- Same functional outcomes as simulator.
- No device-only navigation, bridge, or rendering regressions.
- Safe-area behavior remains correct on hardware.

## 4. Evidence To Capture

Capture and attach these artifacts for each full validation run:
- Exact commit SHA of Fort-ios and FortWeb.
- Command outputs for preconditions.
- Simulator logs from `make logs-sim`.
- Device logs from `make logs-device`.
- Short pass/fail notes for flows A-E.

## 5. Exit Criteria

The iOS conference lane is considered validated only if:
- Preconditions pass.
- Simulator flows A-E pass.
- Device flows A-E pass.
- No blocker-severity crash or broken core flow remains.
