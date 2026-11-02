import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


class TestHttpTransportArchitecture(unittest.TestCase):
    def setUp(self):
        self.transport_src = (REPO_ROOT / "httpTransport.js").read_text(encoding="utf-8")
        self.hive_src = (REPO_ROOT / "hiveClient.js").read_text(encoding="utf-8")
        self.github_src = (REPO_ROOT / "githubClient.js").read_text(encoding="utf-8")

    def test_http_transport_file_exists_and_exports_expected_functions(self):
        transport_path = REPO_ROOT / "httpTransport.js"
        self.assertTrue(transport_path.exists(), "httpTransport.js must exist")
        self.assertGreater(transport_path.stat().st_size, 0)
        for expected_export in (
            "export function isAuthStatus",
            "export function isSuccessStatus",
            "export function decodeBytes",
            "export function parseJson",
            "export function sendRequest",
        ):
            self.assertIn(expected_export, self.transport_src,
                          f"httpTransport.js must export {expected_export}")

    def test_clients_import_and_delegate_to_http_transport(self):
        self.assertIn("import {sendRequest} from './httpTransport.js';", self.hive_src)
        self.assertIn("import {sendRequest} from './httpTransport.js';", self.github_src)
        self.assertIn("sendRequest(session, msg, cancellable", self.hive_src)
        self.assertIn("sendRequest(session, msg, cancellable", self.github_src)

    def test_no_duplicate_network_handling_in_clients(self):
        for name, src in [("hiveClient.js", self.hive_src), ("githubClient.js", self.github_src)]:
            self.assertNotIn("send_and_read_finish", src,
                             f"{name} should not directly call send_and_read_finish")
            self.assertNotIn("Gio.IOErrorEnum.CANCELLED", src,
                             f"{name} should not directly match Gio.IOErrorEnum.CANCELLED")
            self.assertNotIn("new TextDecoder().decode", src,
                             f"{name} should not duplicate TextDecoder bytes decoding")

    def test_github_client_maintains_url_guard_order(self):
        guard = self.github_src.find("if (!isValidRepo(repo))")
        request = self.github_src.find("Soup.Message.new('POST'")
        self.assertNotEqual(guard, -1)
        self.assertNotEqual(request, -1)
        self.assertLess(guard, request, "repo guard must precede Soup.Message.new")

    def test_node_unit_tests_pass(self):
        mjs_test = REPO_ROOT / "tests" / "test_http_transport.mjs"
        self.assertTrue(mjs_test.exists(), "test_http_transport.mjs must exist")
        proc = subprocess.run(["node", str(mjs_test)], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, f"Node tests failed: {proc.stderr}\n{proc.stdout}")


if __name__ == "__main__":
    unittest.main()
