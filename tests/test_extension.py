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

    def test_project_url_matches_repository(self):
        self.assertEqual(
            self.metadata.get("url"),
            "https://github.com/tuna-os/gnome-hive-monitor",
        )


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


class TestPackCommand(unittest.TestCase):
    """The documented pack command must ship every module the extension loads.

    `gnome-extensions pack` adds only extension.js, prefs.js, metadata.json,
    stylesheets and schemas on its own. Any other module needs an
    --extra-source flag, or the ZIP holds an extension.js whose imports
    cannot resolve and GNOME Shell refuses to load it.
    """

    ENTRY_POINTS = ("extension.js", "prefs.js")
    DOCS = ("AGENTS.md", "CONTRIBUTING.md")
    LOCAL_IMPORT = re.compile(r"""from\s+['"]\./([\w.-]+\.js)['"]""")

    def local_modules(self):
        seen = set()
        pending = list(self.ENTRY_POINTS)
        while pending:
            name = pending.pop()
            for dep in self.LOCAL_IMPORT.findall((REPO_ROOT / name).read_text(encoding="utf-8")):
                if dep not in seen and dep not in self.ENTRY_POINTS:
                    seen.add(dep)
                    pending.append(dep)
        return seen

    def pack_sources(self, doc):
        text = (REPO_ROOT / doc).read_text(encoding="utf-8").replace("\\\n", " ")
        commands = [line for line in text.splitlines() if "gnome-extensions pack " in line]
        self.assertTrue(commands, f"{doc} has no gnome-extensions pack command")
        return [set(re.findall(r"--extra-source=(\S+)", cmd)) for cmd in commands]

    def test_local_imports_found(self):
        # Guards the regex: the extension is known to import its clients.
        self.assertIn("hiveClient.js", self.local_modules())

    def test_pack_command_includes_every_imported_module(self):
        modules = self.local_modules()
        for doc in self.DOCS:
            for sources in self.pack_sources(doc):
                with self.subTest(doc=doc):
                    self.assertEqual(sorted(modules - sources), [],
                                     f"{doc}: add --extra-source for each missing module")


if __name__ == "__main__":
    unittest.main()
