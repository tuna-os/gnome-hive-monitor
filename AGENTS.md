# Agent guide — Hive Monitor

## Scope and responsibilities

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changes. This guide applies to
all files in this repository. Keep each change within its assigned issue.

Agents can inspect code, update docs, implement fixes, run checks, and submit
pull requests. Report the checks run and any checks that the host cannot run.
Maintainers review and merge changes. An agent must not merge its own PR or
bypass a required check or approval. A task assignment does not grant access
to release credentials or permission to change shared infrastructure.

## Repository map and boundaries

Hive Monitor is a GNOME Shell 45–50 extension. It uses JavaScript ESM and
`gi://` modules that ship with GNOME Shell.

| Path | Purpose |
|---|---|
| `extension.js` | Panel, status display, and idea dialog |
| `prefs.js` | Settings UI |
| `hiveClient.js` | Hive status requests |
| `githubClient.js` | GitHub issue requests |
| `schemas/` | GSettings keys and defaults |
| `metadata.json` | Extension identity and Shell versions |
| `tests/test_extension.py` | Metadata, schema, and source checks |

Keep API use compatible with all declared Shell versions. Test UI and request
changes in a GNOME session as described in CONTRIBUTING.md. The Python tests
cannot test the full GJS runtime or Shell UI.

The extension reads `GET /api/widget` with `X-Hive-Internal`. It files ideas
as GitHub issues with a separate GitHub token. Preserve that separation and
HTTPS checks. Never put tokens in logs, docs, commits, or PRs. Changes to the
hive service or org workflows belong in their source repositories.

## Local checks

There is no `justfile`, package build step, or JavaScript lint command here.
Run these commands from the repository root:

```bash
python3 -m unittest discover -s tests -v
python3 -m json.tool metadata.json > /dev/null
glib-compile-schemas --strict --dry-run schemas/
gnome-extensions pack --force --extra-source=schemas/
```

The last two commands need GLib tools and GNOME extension tools. For live
checks, follow the setup and log commands in CONTRIBUTING.md. Do not commit
schema caches or extension archives produced by local checks.

## CI and shared tuna-os tools

[Prose](.github/workflows/ste.yml) runs for Markdown changes on PRs, pushes to
`main`, and manual dispatch. It calls
[tuna-os/.github's STE workflow](https://github.com/tuna-os/.github/blob/main/.github/workflows/ste-lint.yml).
That workflow runs the prose rule tests and checks this repo's `.ste-budget`.
Never raise the budget to pass a check. Fix new findings instead.

With a sibling checkout of `tuna-os/.github`, run the same prose gate locally:

```bash
node ../.github/.github/actions/ste-lint/ste-lint.mjs --summary
node ../.github/.github/actions/ste-lint/ste-lint.mjs --max "$(cat .ste-budget)"
```

This repo has no CI job for extension tests, packaging, or release deployment.
Run local checks and report their results; a prose check does not test the
extension. The README is synced to `tuna-os/docs`. Edit its source here so
the next sync keeps the change. See the
[org agent guide](https://github.com/tuna-os/.github/blob/main/AGENTS.md)
for shared workflow scope.

## Pull requests and merge authority

Start from current `upstream/main` and target `main`. Use a fork branch when
you lack upstream write access. Keep the PR focused and link its issue. Use a
Conventional Commit title such as `docs: add agent guide`.

Sign off every commit with `git commit -s` for the DCO. The sign-off email must
match the author email. Describe the change, checks, and any runtime limits in
the PR. Resolve review feedback and required checks before merge. Maintainers
retain merge and release authority; agents submit changes for review.
