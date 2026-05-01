#!/usr/bin/env python3
"""Pick the first available iPhone iOS Simulator; print UDID on line 1, label on line 2.

Used by iOS Security Checks (swift-tests) so CI does not rely on an indented shell heredoc
(which would inject leading spaces and break Python with IndentationError).
"""
from __future__ import annotations

import json
import subprocess
import sys


def main() -> None:
    data = json.loads(
        subprocess.check_output(
            ["xcrun", "simctl", "list", "devices", "available", "--json"],
            text=True,
        )
    )

    for runtime in sorted(data.get("devices", {})):
        if not runtime.startswith("com.apple.CoreSimulator.SimRuntime.iOS-"):
            continue
        for device in data["devices"][runtime]:
            if not device.get("isAvailable"):
                continue
            name = device.get("name", "")
            if not name.startswith("iPhone"):
                continue
            runtime_label = runtime.removeprefix(
                "com.apple.CoreSimulator.SimRuntime.iOS-"
            ).replace("-", ".")
            print(device["udid"])
            print(f"{name} ({runtime_label})")
            return

    sys.stderr.write("error: no available iPhone simulator found on runner\n")
    sys.exit(1)


if __name__ == "__main__":
    main()
