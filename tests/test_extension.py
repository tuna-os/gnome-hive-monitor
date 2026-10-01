import json
import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

class TestMetadata(unittest.TestCase):
    def setUp(self):
        self.metadata_path = REPO_ROOT / "metadata.json"
        self.assertTrue(self.metadata_path.exists(), "metadata.json must exist")
        with open(self.metadata_path, "r", encoding="utf-8") as f:
            self.metadata = json.load(f)

    def test_required_fields_present(self):
        required_fields = ["uuid", "name", "description", "shell-version", "settings-schema", "version"]
        for field in required_fields:
            self.assertIn(field, self.metadata, f"Missing required metadata field: {field}")

    def test_uuid_format(self):
        uuid = self.metadata.get("uuid")
        self.assertEqual(uuid, "hive-monitor@tunaos.org")

    def test_shell_versions(self):
        versions = self.metadata.get("shell-version")
        self.assertIsInstance(versions, list)
        self.assertGreaterEqual(len(versions), 1)
        expected_supported = ["45", "46", "47", "48", "49", "50"]
        for ver in expected_supported:
            self.assertIn(ver, versions, f"Expected shell-version {ver} to be supported")

    def test_settings_schema_matches(self):
        schema_id = self.metadata.get("settings-schema")
        self.assertEqual(schema_id, "org.gnome.shell.extensions.hive-monitor")


class TestGSettingsSchema(unittest.TestCase):
    def setUp(self):
        self.schema_path = REPO_ROOT / "schemas" / "org.gnome.shell.extensions.hive-monitor.gschema.xml"
        self.assertTrue(self.schema_path.exists(), "GSettings XML schema must exist")
        self.tree = ET.parse(self.schema_path)
        self.root = self.tree.getroot()

    def test_schema_tag_and_id(self):
        self.assertEqual(self.root.tag, "schemalist")
        schema = self.root.find("schema")
        self.assertIsNotNone(schema, "Schema node must exist")
        self.assertEqual(schema.attrib.get("id"), "org.gnome.shell.extensions.hive-monitor")
        self.assertEqual(schema.attrib.get("path"), "/org/gnome/shell/extensions/hive-monitor/")

    def test_schema_keys(self):
        schema = self.root.find("schema")
        keys = {k.attrib.get("name"): k for k in schema.findall("key")}
        
        expected_keys = {
            "hive-url": "s",
            "hive-token": "s",
            "poll-seconds": "i",
            "github-repo": "s",
            "github-token": "s",
            "idea-labels": "s",
            "show-counts": "b",
        }

        for key_name, key_type in expected_keys.items():
            self.assertIn(key_name, keys, f"Expected key '{key_name}' in schema")
            self.assertEqual(keys[key_name].attrib.get("type"), key_type)
            default = keys[key_name].find("default")
            self.assertIsNotNone(default, f"Key '{key_name}' must have a default value")

        # Range check on poll-seconds
        poll_key = keys["poll-seconds"]
        range_tag = poll_key.find("range")
        self.assertIsNotNone(range_tag, "poll-seconds should define a range")
        self.assertEqual(range_tag.attrib.get("min"), "15")
        self.assertEqual(range_tag.attrib.get("max"), "3600")


class TestRepoValidation(unittest.TestCase):
    """github-repo is interpolated into the GitHub API request path, so it
    decides which endpoint the token is POSTed to. Replicate the REPO_RE
    guard in githubClient.js and check it rejects values that redirect the
    path, not merely values that look untidy."""

    # \Z, not $: Python's $ also matches just before a trailing newline, so
    # "owner/name\n" would pass a $-anchored copy while correctly failing the
    # JS original. The replica has to be as strict as the code it mirrors.
    REPO_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/[A-Za-z0-9._-]+\Z")

    def is_valid_repo(self, repo):
        if not isinstance(repo, str) or len(repo) > 512:
            return False
        name = repo[repo.find("/") + 1:]
        if name in (".", ".."):
            return False
        return self.REPO_RE.match(repo) is not None

    def test_accepts_well_formed_repos(self):
        for repo in ["owner/name", "tuna-os/gnome-hive-monitor", "a/b",
                     "user1/repo.js", "x-y/a_b-c.d", "A0/z9"]:
            self.assertTrue(self.is_valid_repo(repo), f"should accept {repo!r}")

    def test_rejects_path_escaping_repos(self):
        # Each of these sends the POST somewhere other than
        # /repos/<owner>/<name>/issues.
        for repo in ["a/b/../../user/repos", "../../user/repos", "o/..",
                     "x/y?", "o/n#frag", "o/n?x=1", "o/n/issues",
                     "http://evil.example/a/b"]:
            self.assertFalse(self.is_valid_repo(repo), f"should reject {repo!r}")

    def test_rejects_malformed_repos(self):
        for repo in ["", "o n", "/n", "o/", "o//n", "o/n ", "-o/n", "o/.",
                     "o/n\n", "a" * 600 + "/b"]:
            self.assertFalse(self.is_valid_repo(repo), f"should reject {repo!r}")

    def test_client_enforces_validation_before_building_url(self):
        """The guard must run before Soup.Message.new(), which parses the
        escaping values above without complaint."""
        src = (REPO_ROOT / "githubClient.js").read_text(encoding="utf-8")
        self.assertIn("isValidRepo", src)
        guard = src.find("if (!isValidRepo(repo))")
        # The actual call, not the word in the comment above it.
        request = src.find("Soup.Message.new('POST'")
        self.assertNotEqual(guard, -1, "fileIssue must reject an invalid repo")
        self.assertNotEqual(request, -1)
        self.assertLess(guard, request,
                        "repo must be validated before the request URL is built")


class TestExtensionLogic(unittest.TestCase):
    def test_ago_formatting_logic(self):
        """Replicate and verify the relative time formatting algorithm used in extension.js _ago(iso)."""
        def format_ago(delta_seconds):
            s = max(0, int(round(delta_seconds)))
            if s < 60:
                return f"{s}s ago"
            if s < 3600:
                return f"{int(round(s / 60))}m ago"
            return f"{int(round(s / 3600))}h ago"

        self.assertEqual(format_ago(0), "0s ago")
        self.assertEqual(format_ago(45), "45s ago")
        self.assertEqual(format_ago(59), "59s ago")
        self.assertEqual(format_ago(60), "1m ago")
        self.assertEqual(format_ago(120), "2m ago")
        self.assertEqual(format_ago(180), "3m ago")
        self.assertEqual(format_ago(3599), "60m ago")
        self.assertEqual(format_ago(3600), "1h ago")
        self.assertEqual(format_ago(7200), "2h ago")
        self.assertEqual(format_ago(86400), "24h ago")

    def test_source_files_exist_and_nonempty(self):
        for filename in ["extension.js", "prefs.js", "README.md", "CONTRIBUTING.md"]:
            path = REPO_ROOT / filename
            self.assertTrue(path.exists(), f"File {filename} must exist")
            self.assertGreater(path.stat().st_size, 0, f"File {filename} must not be empty")


if __name__ == "__main__":
    unittest.main()
