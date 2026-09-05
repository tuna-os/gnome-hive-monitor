# Contributing to Hive Monitor

Thank you for your interest in contributing to Hive Monitor! This document provides guidelines for local development, schema validation, packaging, and submitting pull requests.

## Architecture and Requirements

Hive Monitor is a GNOME Shell extension targeting GNOME Shell 45–50 using standard ECMAScript modules (ESM) and GObject Introspection (`gi://`).

- **Target Shell Versions**: GNOME Shell 45, 46, 47, 48, 49, 50
- **Language**: JavaScript (ESM format)
- **Dependencies**: Uses standard `gi://` modules (`GLib`, `Gio`, `GObject`, `Clutter`, `St`, `Adw`, `Gtk`, `Soup`) shipping with GNOME Shell.

## Local Development Setup

To test changes live against your local GNOME Shell session:

1. Create a symlink from this repository directory into the user extensions folder:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/hive-monitor@tunaos.org
```

2. Compile the GSettings schema locally:

```bash
glib-compile-schemas schemas/
```

3. If this is the first time the extension is linked, log out and back in so GNOME Shell discovers the new extension directory (on Wayland, restarting the shell in place is not supported).

4. Enable the extension and open preferences:

```bash
gnome-extensions enable hive-monitor@tunaos.org
gnome-extensions prefs hive-monitor@tunaos.org
```

5. When testing updates to JavaScript files (`extension.js` or `prefs.js`), you can disable and re-enable the extension to load your changes without a full logout:

```bash
gnome-extensions disable hive-monitor@tunaos.org
gnome-extensions enable hive-monitor@tunaos.org
```

6. To monitor logs and debug messages from GNOME Shell:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

## Validation and Linting

Before opening a pull request, run the following validation checks:

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
