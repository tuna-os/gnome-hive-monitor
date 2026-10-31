# Contributing to Hive Monitor

Thank you for your interest in Hive Monitor! This document shows how to develop locally, check the schema, pack the extension, and send pull requests.

<!-- hive-contribute-plea: donated-compute appeal, keep in sync across repos -->
## Contribute compute — no code needed

**[Donate time with your AI CLI](https://hub.tunaos.org/#contribute).**

Your machine runs one task at a time using your signed-in AI coding CLI.
The relay alternates between eligible **School** (OS) and **Reef** (apps)
hives after each task. If one hive has no work, the other can continue.

The guide covers prerequisites, verified `just` setup, credentials, provider
costs, and how to stop with Ctrl+C. Your subscription quota or API charges apply.
Never post account credentials or API keys in issues or pull requests.

## Architecture and Requirements

Hive Monitor is a GNOME Shell extension for GNOME Shell 45–50. It uses standard ECMAScript modules (ESM) and GObject Introspection (`gi://`).

- **Target Shell Versions**: GNOME Shell 45, 46, 47, 48, 49, 50
- **Language**: JavaScript (ESM format)
- **Dependencies**: Uses standard `gi://` modules (`GLib`, `Gio`, `GObject`, `Clutter`, `St`, `Adw`, `Gtk`, `Soup`), plus libsecret (`Secret`) and a running Secret Service.

## Local Development Setup

To test changes live in a local session of GNOME Shell:

1. Create a symlink from this repository directory into the user extensions folder:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/hive-monitor@tunaos.org
```

2. Compile the GSettings schema locally:

```bash
glib-compile-schemas schemas/
```

3. If you link the extension for the first time, log out and back in. This lets GNOME Shell find the new extension directory. On Wayland, you cannot restart the shell in place.

4. Enable the extension and open preferences:

```bash
gnome-extensions enable hive-monitor@tunaos.org
gnome-extensions prefs hive-monitor@tunaos.org
```

5. To test updates to JavaScript files (`extension.js` or `prefs.js`), disable and re-enable the extension. This loads your changes without a full logout:

```bash
gnome-extensions disable hive-monitor@tunaos.org
gnome-extensions enable hive-monitor@tunaos.org
```

6. To monitor logs and debug messages from GNOME Shell:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

## Validation and Linting

Before you send a pull request, run these validation checks:

### 1. Schema Compilation Verification

Verify that GSettings schema XML is syntactically valid and compiles cleanly with `--strict`:

```bash
glib-compile-schemas --strict --dry-run schemas/
```

### 2. Extension Metadata Validation

Verify that `metadata.json` is valid JSON and contains required extension metadata keys:

```bash
python3 -m json.tool metadata.json > /dev/null
```

### 3. Packaging Verification

Ensure the extension can be packed cleanly using `gnome-extensions pack`:

```bash
gnome-extensions pack --force --extra-source=schemas/
```

## Pull Request Guidelines

1. **Sign Your Commits**: All commits must follow the Developer Certificate of Origin (DCO) standard using `git commit -s`.
2. **Atomic Changes**: Keep PRs focused on a single feature, bug fix, or documentation update.
3. **Compatibility**: Ensure any new API usage remains compatible across the supported GNOME Shell versions (45–50).

Credential storage regression checks: `node tests/test_credentials.mjs`.
In a GNOME session, also test migration of both old tokens, a locked keyring,
Save and removal in preferences, status polling, and filing an idea.
