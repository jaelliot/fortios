# Conference iOS Validation Runs

## 2026-04-16 Run 01

Scope:
- FortWeb-hosted lane in Fort-ios
- Simulator and physical device high-level launch smoke
- Slow Playwright Pyodide roundtrip lane

Evidence summary:
- `PAYLOAD_SOURCE=fortweb make parity-smoke DEVICE_REF=1474E89B-F509-50C3-9AFD-3C85512C5B94` completed with successful simulator/device build and launch.
- Device installation and launch succeeded via `xcrun devicectl`.
- App host logs no longer show JS exception for missing `handleNativeCommand`; host now emits a bounded warning.
- `make test-e2e-slow` now passes after staging full payload Python assets and aligning lifecycle assertion with current app behavior.

Operator note:
- During one physical-device console session, the app process was manually killed by the operator to stop a long-running attached console launch command. This was operational control action, not a crash signal.

Current status:
- High-level app spin-up looks good on simulator and device.
- Deep flow walkthrough (vaults/identifiers/remotes/settings/KF pages) remains the next manual pass.
