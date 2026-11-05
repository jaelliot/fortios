"""Validate results from the synthetic Core SEDI device test."""


def recovery_complete(recovery):
    return isinstance(recovery, dict) and all(recovery.get(key) is True for key in (
        "credentialRecovered", "bindingRecovered", "grantMetadataRecovered"
    ))


def xctest_passed(summary):
    if not isinstance(summary, dict) or summary.get("result") != "Passed":
        return False
    counts = {"totalTestCount": 1, "passedTests": 1, "failedTests": 0,
              "skippedTests": 0, "expectedFailures": 0}
    return all(type(summary.get(key)) is int and summary[key] == value for key, value in counts.items())
