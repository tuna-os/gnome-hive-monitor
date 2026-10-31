# Agent guidance for Hive Monitor

## Scope and repository map

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you change this repository.
Hive Monitor is a GNOME Shell extension that reads status from a
kubestellar/hive instance and can file ideas as GitHub issues.
It uses JavaScript ESM and the `gi://` modules supplied by GNOME Shell.
Keep API use compatible with GNOME Shell 45, 46, 47, 48, 49, and 50.

| Path | Purpose |
| --- | --- |
| `extension.js` | Panel indicator, status polling, and the New Idea dialog |
| `prefs.js` | Preferences window and settings bindings |
| `hiveClient.js` | Hive widget status requests |
| `githubClient.js` | GitHub issue requests and repository validation |
| `metadata.json` | Extension UUID, schema ID, and supported Shell versions |
| `schemas/` | GSettings XML; compiled schema files are build output |
| `tests/test_extension.py` | Python tests for metadata, schema, and selected logic |
| `docs/observability.md` | Logs and diagnostic events |
| `runbooks/client-diagnostics.md` | Steps to diagnose client failures |
| `.github/workflows/ste.yml` | Shared Markdown prose check |

## Development and validation

Run these checks from the repository root before you send a PR:

```bash
python3 -m unittest discover -s tests -v
glib-compile-schemas --strict --dry-run schemas/
python3 -m json.tool metadata.json > /dev/null
gnome-extensions pack --force --extra-source=schemas/
```

The Python tests use the standard library. Some tests check source text or
copy selected logic; they do not run GJS, GTK, Soup, or GNOME Shell.
Report any check you cannot run and the reason in the PR.
Do not commit ZIP packages, `schemas/gschemas.compiled`, or `__pycache__/`.

For a local desktop test, link the checkout and compile its schema:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/hive-monitor@tunaos.org
glib-compile-schemas schemas/
gnome-extensions enable hive-monitor@tunaos.org
gnome-extensions prefs hive-monitor@tunaos.org
```

If the extension directory already exists, inspect it before you change it.
On first install, log out and back in before you enable the extension.
On Wayland, GNOME Shell cannot restart in place.
After JavaScript changes, disable and enable the extension:

```bash
gnome-extensions disable hive-monitor@tunaos.org
gnome-extensions enable hive-monitor@tunaos.org
journalctl -f -o cat /usr/bin/gnome-shell
```

For UI or client changes, check status refresh, preferences, errors, and
extension disable/enable in a GNOME session. Test idea submission only against
a repository you have permission to use. Record the Shell versions you test;
a passing Python suite does not prove support across all six versions.
Keep credentials out of logs, tests, issues, and PRs.

## CI and pull requests

Use `main` as the PR base. Keep each PR focused on one change and sign off
every commit with `git commit -s` for the Developer Certificate of Origin.
The sign-off email must match the commit author's email.

The repository's `Prose` workflow calls the shared
`tuna-os/.github/.github/workflows/ste-lint.yml@main` workflow. It runs for
Markdown, MDX, budget, and workflow changes on PRs and pushes to `main`.
Its Simplified Technical English check uses `.ste-budget` as a limit on
findings. Do not raise the budget to make a PR pass.
The shared linter lives in `tuna-os/.github`, rather than in this checkout.

Run the local validation commands above even though the repository's workflow
does not run the extension tests or packaging checks. Include results and any
manual desktop checks in the PR. Resolve failed checks and review feedback
before merge; let maintainers handle approval and merge. Agents must not
merge their own PRs or bypass write gates.
