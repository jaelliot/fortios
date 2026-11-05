import unittest

from tools.sedi_core_test_validation import recovery_complete, xctest_passed


class RecoveryResultTest(unittest.TestCase):
    def test_xctest_requires_one_pass_and_no_skips_or_failures(self):
        valid = {"result": "Passed", "totalTestCount": 1, "passedTests": 1,
                 "failedTests": 0, "skippedTests": 0, "expectedFailures": 0}
        self.assertTrue(xctest_passed(valid))
        for key in valid:
            with self.subTest(missing=key):
                self.assertFalse(xctest_passed({k: v for k, v in valid.items() if k != key}))
            with self.subTest(wrong=key):
                self.assertFalse(xctest_passed({**valid, key: "Failed" if key == "result" else True}))
        for invalid in (None, [], "Passed"):
            self.assertFalse(xctest_passed(invalid))

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
