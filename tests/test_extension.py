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


class TestStatusRequestGeneration(unittest.TestCase):
    """A status reply may only render if it is the newest one asked for.

    Replicate the generation counter in HiveIndicator._refresh(): each request
    takes the next generation, and a callback renders only while it still owns
    the current one. Cancelling alone does not give this, because Soup can
    deliver a reply that was already in flight when its cancellable was
    cancelled, and two overlapping polls can finish out of order."""

    class Indicator:
        """The ordering logic of _refresh/_render with no GNOME Shell."""

        def __init__(self):
            self.gen = 0
            self.rendered = []

        def refresh(self):
            """Send a request; returns its reply callback."""
            self.gen += 1
            mine = self.gen
            def reply(data):
                if mine == self.gen:
                    self.rendered.append(data)
            return reply

    def test_newest_reply_renders(self):
        ind = self.Indicator()
        reply = ind.refresh()
        reply("fresh")
        self.assertEqual(ind.rendered, ["fresh"])

    def test_stale_reply_is_dropped_after_settings_change(self):
        ind = self.Indicator()
        old = ind.refresh()          # poll with the old URL/token
        new = ind.refresh()          # settings changed, poll again
        new("fresh")
        old("stale")                 # old reply lands last
        self.assertEqual(ind.rendered, ["fresh"],
                         "a reply from a superseded request must not render")

    def test_out_of_order_replies_keep_the_newest(self):
        ind = self.Indicator()
        first = ind.refresh()
        second = ind.refresh()
        third = ind.refresh()
        second("second")             # replies arrive in any order
        third("third")
        first("first")
        self.assertEqual(ind.rendered, ["third"])

    def test_every_outcome_is_gated_not_only_success(self):
        """An error from a superseded request must not overwrite a good status
        either: the error branches are gated the same way as success."""
        ind = self.Indicator()
        old = ind.refresh()
        new = ind.refresh()
        new("ok")
        old("error: cannot reach the hive")
        self.assertEqual(ind.rendered, ["ok"])

    def test_source_claims_a_generation_per_request(self):
        """Anchor the replica above to the code: the counter must exist and be
        taken before the request is sent."""
        source = (REPO_ROOT / "extension.js").read_text(encoding="utf-8")
        self.assertIn("this._statusGen = 0;", source)
        self.assertIn("const gen = ++this._statusGen;", source)

    def test_source_gates_all_four_status_callbacks(self):
        """fetchWidgetStatus has four outcomes. Each must check the generation,
        or a stale reply reaches the panel through whichever one is unguarded."""
        source = (REPO_ROOT / "extension.js").read_text(encoding="utf-8")
        call = source[source.index("fetchWidgetStatus(this._session"):]
        call = call[:call.index("\n    }")]
        for cb in ("onSuccess", "onInvalidUrl", "onError", "onAuthError"):
            self.assertIn(cb, call, f"{cb} must still be handled")
        self.assertEqual(
            call.count("if (current())"), 4,
            "all four status outcomes must be gated on the current generation")


class TestCancellableSeparation(unittest.TestCase):
    """Status polling and idea filing must not share one cancellable.

    A hive-url or hive-token edit aborts the status poll. It must not abort an
    idea POST the user already confirmed, which goes to GitHub with a separate
    credential. These are source assertions because the behaviour lives in
    GJS/Soup calls this suite cannot execute."""

    def setUp(self):
        self.source = (REPO_ROOT / "extension.js").read_text(encoding="utf-8")

    def test_two_distinct_cancellables_exist(self):
        for name in ("_statusCancel", "_ideaCancel"):
            self.assertIn(f"this.{name} = new Gio.Cancellable()", self.source,
                          f"{name} must be its own Gio.Cancellable")

    def test_no_single_shared_cancellable_remains(self):
        self.assertNotRegex(
            self.source, r"this\._cancel\b",
            "the shared _cancel must be gone; a shared cancellable cannot "
            "abort the status poll while leaving the idea POST running")

    def test_status_fetch_uses_the_status_cancellable(self):
        self.assertRegex(
            self.source,
            r"fetchWidgetStatus\(\s*this\._session,\s*this\._statusCancel",
            "the status poll must be cancellable on its own")

    def test_idea_post_uses_the_idea_cancellable(self):
        self.assertRegex(
            self.source,
            r"fileIssue\(\s*this\._session,\s*this\._ideaCancel",
            "filing an idea must not be cancelled by a hive settings edit")

    def test_settings_change_aborts_only_the_status_poll(self):
        self.assertIn("_abortStatus()", self.source,
                      "the settings handler must abort the in-flight poll")
        self.assertNotIn("this._ideaCancel.cancel();\n            this._restartTimer",
                         self.source,
                         "a settings edit must not cancel the idea POST")

    def test_destroy_cancels_both(self):
        tail = self.source[self.source.index("    destroy() {"):]
        for name in ("_statusCancel", "_ideaCancel"):
            self.assertIn(f"this.{name}.cancel();", tail,
                          f"destroy() must cancel {name}, or a late reply "
                          "touches freed actors")


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
