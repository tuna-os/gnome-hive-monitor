# Agent contributor guide

Hive Monitor is a GNOME Shell extension written in JavaScript (ES modules and
GObject Introspection). It supports GNOME Shell 45–50. Keep changes compatible
with all six versions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, live testing, and pull
request guidelines. Keep pull requests focused. Sign every commit for the
Developer Certificate of Origin with `git commit -s`; the sign-off must match
the commit author.

## Checks

Run these commands from the repository root before submitting a pull request:

```bash
# Run the Python unit tests.
python3 -m unittest discover -s tests -v

# Validate the schema and metadata.
glib-compile-schemas --strict --dry-run schemas/
python3 -m json.tool metadata.json > /dev/null

# Check extension packaging.
gnome-extensions pack --force --extra-source=schemas/
```

For live testing, compile the schema with `glib-compile-schemas schemas/` and
follow the setup steps in CONTRIBUTING.md. The Python tests do not replace a
live GNOME Shell test.

The `Prose` workflow checks Markdown with the shared Simplified Technical
English linter and the `.ste-budget` limit. To run the same budget check locally,
clone [tuna-os/.github](https://github.com/tuna-os/.github) alongside this
repository and run:

```bash
node ../.github/.github/actions/ste-lint/ste-lint.mjs --summary
node ../.github/.github/actions/ste-lint/ste-lint.mjs --max "$(< .ste-budget)"
```

Do not raise `.ste-budget` to make a check pass. This repository does not
currently define a JavaScript lint command.
