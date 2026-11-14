# Agent contributor guide

Hive Monitor is a GNOME Shell extension written in JavaScript (ES modules and
GObject Introspection). It supports GNOME Shell 45–50. Keep changes compatible
with all six versions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, live testing, and pull
request guidelines. Keep pull requests focused and use `main` as the PR base.
Sign every commit for the Developer Certificate of Origin with `git commit -s`;
the sign-off must match the commit author.

## Repository map

The extension reads status from a kubestellar/hive instance and can file ideas
as GitHub issues.

| Path | Purpose |
| --- | --- |
| `extension.js` | Panel indicator, status polling, and the New Idea dialog |
| `prefs.js` | Preferences window and settings bindings |
| `hiveClient.js` | Hive widget status requests |
| `githubClient.js` | GitHub issue requests and repository validation |
| `metadata.json` | Extension UUID, schema ID, and supported Shell versions |
| `schemas/` | GSettings XML; compiled schema files are build output |
| `tests/test_extension.py` | Python tests for metadata, schema, and selected logic |
| `tests/test_widget.cjs` | Node tests for widget status and display logic |
| `docs/observability.md` | Logs and diagnostic events |
| `runbooks/client-diagnostics.md` | Steps to diagnose client failures |

## Checks

Run these commands from the repository root before submitting a pull request:

```bash
# Run the Python and Node tests.
python3 -m unittest discover -s tests -v
node --test tests/test_widget.cjs

# Install dependencies and check JavaScript lint.
npm ci --ignore-scripts
npm run lint

# Validate the schema and metadata.
glib-compile-schemas --strict --dry-run schemas/
python3 -m json.tool metadata.json > /dev/null

# Check extension packaging.
gnome-extensions pack --force --extra-source=schemas/ \
  --extra-source=hiveClient.js --extra-source=githubClient.js
```

The Python tests use the standard library. Some tests check source text or
copy selected logic. The Node tests use Shell and Soup doubles. These tests
do not run GJS, GTK, Soup, or GNOME Shell.
Report any check you cannot run and the reason in the PR.
Do not commit ZIP packages, `schemas/gschemas.compiled`, or `__pycache__/`.

For live testing, compile the schema with `glib-compile-schemas schemas/` and
follow the setup steps in CONTRIBUTING.md. On first install, log out and back
in before you enable the extension. On Wayland, GNOME Shell cannot restart
in place. After JavaScript changes, disable and enable the extension.

For UI or client changes, check status refresh, preferences, errors, and
extension disable/enable in a GNOME session. Test idea submission only against
a repository you have permission to use. Record the Shell versions you test;
a passing test suite does not prove support across all six versions.
Keep credentials out of logs, tests, issues, and PRs.

## CI and pull requests

The `CI` workflow runs Python tests, metadata and schema checks, and JavaScript
syntax checks. The `JavaScript lint` workflow runs ESLint. CI does not test
packaging or the live Shell UI. Include local check results and any manual
desktop checks in the PR.

The `Prose` workflow checks Markdown with the shared Simplified Technical
English linter and the `.ste-budget` limit. To run the same budget check locally,
clone [tuna-os/.github](https://github.com/tuna-os/.github) alongside this
repository and run:

```bash
node ../.github/.github/actions/ste-lint/ste-lint.mjs --summary
node ../.github/.github/actions/ste-lint/ste-lint.mjs --max "$(cat .ste-budget)"
```

Do not raise `.ste-budget` to make a check pass. Resolve failed checks and
review feedback before merge. Maintainers handle approval and merge; agents
must not merge their own PRs or bypass write gates.
