import unittest

from tools.sedi_core_test_validation import recovery_complete


class RecoveryResultTest(unittest.TestCase):
    def test_requires_all_three_explicit_successes(self):
        complete = {
            "credentialRecovered": True,
            "bindingRecovered": True,
            "grantMetadataRecovered": True,
        }
        self.assertTrue(recovery_complete(complete))
        for key in complete:
            with self.subTest(missing=key):
                self.assertFalse(recovery_complete({k: v for k, v in complete.items() if k != key}))
            with self.subTest(failed=key):
                self.assertFalse(recovery_complete({**complete, key: False}))
            with self.subTest(non_boolean=key):
                self.assertFalse(recovery_complete({**complete, key: 1}))
        for invalid in ({}, None, [], "success"):
            self.assertFalse(recovery_complete(invalid))


if __name__ == "__main__":
    unittest.main()
