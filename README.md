# Hive Monitor — GNOME Shell extension

Watch a [kubestellar/hive](https://github.com/kubestellar/hive) instance from
the GNOME top bar, and file an idea into it without opening a browser.

Nothing is hardcoded to a particular hive. Point it at a self-hosted spoke, the
hosted hub, or someone else's instance — it is all configuration.


<!-- hive-contribute-plea: donated-compute appeal, keep in sync across repos -->
## Contribute compute — no code needed

**[Donate time with your AI CLI](https://hub.tunaos.org/#contribute).**

Your machine runs one task at a time using your signed-in AI coding CLI.
The relay alternates between eligible **School** (OS) and **Reef** (apps)
hives after each task. If one hive has no work, the other can continue.

The guide covers prerequisites, verified `just` setup, credentials, provider
costs, and how to stop with Ctrl+C. Your subscription quota or API charges apply.
Never post account credentials or API keys in issues or pull requests.

## What it shows

The panel reads the hive's own `GET /api/widget`:

| Field | Shown as |
|---|---|
| `mode` | Governor mode — `SURGE` / `BUSY` / `QUIET` / `IDLE` |
| `issues`, `prs` | Queue depth, `issues/prs`, optional |
| `running`, `paused` | Agent counts, in the menu |
| `last_eval` | How long since the governor last evaluated |

**A paused agent flips the icon to a warning.** That is the failure this widget
exists to catch: a hive with paused lanes looks completely healthy from the
outside while part of it does nothing. The governor still computes those agents
as due and then silently skips them.

## Filing an idea

*New Idea…* opens a small dialog and creates a **GitHub issue** on a repository
you configure, labelled `ai-fix-requested` by default.

Ideas go to GitHub rather than to a hive bead on purpose — GitHub issues *are*
the hive's work queue. The governor polls them, and its SURGE/BUSY/QUIET modes
are driven by their depth. Beads are per-agent internal state, and Inception is
for scaffolding whole new projects; neither is an intake channel for "I had an
idea". Point it at one of the hive's **managed repositories** or the governor
will never see the issue.

## Install

```bash
git clone https://github.com/tuna-os/gnome-hive-monitor.git \
  ~/.local/share/gnome-shell/extensions/hive-monitor@tunaos.org
cd ~/.local/share/gnome-shell/extensions/hive-monitor@tunaos.org
glib-compile-schemas schemas/
```

Then log out and back in — GNOME Shell only scans for *new* extension
directories at session start, and on Wayland there is no way to restart the
shell in place. After that:

```bash
gnome-extensions enable hive-monitor@tunaos.org
gnome-extensions prefs  hive-monitor@tunaos.org
```

## Configuration

| Setting | Notes |
|---|---|
| **Hive URL** | e.g. `https://hive.example.org`, no trailing slash |
| **Hive token** | The hive's `HIVE_DASHBOARD_TOKEN` |
| **Refresh interval** | 15–3600s, default 60 |
| **Repository** | `owner/name` an idea becomes an issue in |
| **GitHub token** | Needs only `issues:write` on that repository |
| **Labels** | Comma-separated, default `ai-fix-requested` |

Tokens are stored in the login keyring through libsecret (Secret Service).
Press **Save** next to a token after you edit it. Save an empty field to
remove that token. Existing tokens move from GSettings to the keyring on
first use; the old value is cleared only after the secure write succeeds.
If the keyring is locked or unavailable, unlock it and retry in Settings.

### About the hive token

It is sent as the `X-Hive-Internal` header, which is the only credential a hive
accepts for server-to-server reads:

- `Authorization: Bearer` is **disabled** on a direct-route spoke (one with
  `dashboard.authorized_users` set) — it returns 401.
- A browser session cookie works, but an extension has no way to complete a
  GitHub device-flow login to obtain one.

`X-Hive-Internal` is **read-only**. The hive rejects mutations made with it
(`owner access required`), so this extension can never change your fleet's
configuration — by design. It reads status; the only thing it writes is a
GitHub issue, with your GitHub token.

Treat the hive token as a secret: it grants read access to your fleet's status.

## Requirements

GNOME Shell 45–50 (ESM extensions), libsecret with its GObject introspection
bindings (`Secret`), and a running Secret Service such as GNOME Keyring.

## License

Apache-2.0, matching upstream hive.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup, schema validation, packaging, and pull request guidelines.
