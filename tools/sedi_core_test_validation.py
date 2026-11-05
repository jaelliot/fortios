"""Validate results from the synthetic Core SEDI device test."""


def recovery_complete(recovery):
    return isinstance(recovery, dict) and all(recovery.get(key) is True for key in (
        "credentialRecovered", "bindingRecovered", "grantMetadataRecovered"
    ))
