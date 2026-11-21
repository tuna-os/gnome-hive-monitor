# Modularization roadmap

See [meta issue #66](https://github.com/tuna-os/gnome-hive-monitor/issues/66).
This plan proposes boundaries for modules. They are not all present on `main`.
Keep #66 open until the completion checks below pass on the merged code.

## Work and dependencies

| Step | Responsibility | Tracked work | Candidate PR |
| --- | --- | --- | --- |
| M1 | Shared HTTP transport and response handling | [#62](https://github.com/tuna-os/gnome-hive-monitor/issues/62), [#68](https://github.com/tuna-os/gnome-hive-monitor/issues/68) | [#93](https://github.com/tuna-os/gnome-hive-monitor/pull/93) |
| M2 | Settings validation shared by runtime and preferences | [#64](https://github.com/tuna-os/gnome-hive-monitor/issues/64) | [#94](https://github.com/tuna-os/gnome-hive-monitor/pull/94) |
| M3 | Status polling and display formatting | [#63](https://github.com/tuna-os/gnome-hive-monitor/issues/63) | [#95](https://github.com/tuna-os/gnome-hive-monitor/pull/95) |
| M4 | Idea validation and submission separated from dialog actors | [#67](https://github.com/tuna-os/gnome-hive-monitor/issues/67), [#57](https://github.com/tuna-os/gnome-hive-monitor/issues/57) | [#92](https://github.com/tuna-os/gnome-hive-monitor/pull/92) |

These PRs remain open as of 2026-10-24. A candidate link does not establish acceptance or completion.
Review duplicate proposals under each child issue before you select an implementation.
The repository URL correction in #65 is already on `main` through PR #82.

M1 and M2 can proceed independently. Integrate M2 with M3 so the poller uses the
same URL rules as preferences. Integrate M2 with M4 so repository and label
validation have one source. M3 and M4 can proceed independently after these
shared contracts are clear. M1 must preserve the client interfaces that both use.

## Module contracts

### M1: HTTP transport

The transport completes requests through Soup, detects cancellation, decodes bytes, and classifies responses. API clients own endpoints, headers,
expected status codes, payloads, and user messages. Distinguish authentication failures from network failures. Preserve HTTP 200 for widget success
and HTTP 201 for issue creation. An empty or malformed issue response must not
turn a successful creation into a reported failure that encourages duplicate
submissions. Cancellation must not produce a user error.

### M2: Settings validation

Use one validation module for runtime checks, preferences feedback, and client
checks before credentials are sent. Retain HTTPS, host, and userinfo checks for
Hive URLs and the strict `owner/name` rule for GitHub paths. Keep validation
separate from GSettings reads and UI messages. Reject invalid configuration at runtime too. Parse URLs in GJS without
a browser URL global. Keep pure rules separate from any GLib URI adapter.

### M3: Status polling and formatting

The poller owns timers, settings subscriptions, request generations, and status
cancellation. Inject its fetch and timer dependencies so tests can control
request completion and time. It emits display data without access to Shell actors.
The renderer maps data to text and icon names. Pass translation and time
as inputs so it can run without GNOME Shell.

HiveIndicator applies those fields
and handles menu actions. These modules do not construct actors.

Preserve separate cancellation for status requests and idea submissions. A
settings change must invalidate replies from old polls when the new settings
are incomplete. Only the newest poll can update the display. Destroy must remove
the timer, disconnect settings, and block access to actors from queued callbacks.

### M4: Idea input and submission

Pure functions trim the fields, reject a blank title, and parse labels. The
dialog owns entries, focus, validation feedback, and closure. Submission code
owns the API call and its result; the indicator sends notifications through Shell. The
GitHub client remains responsible for the encoded payload and the attribution line.
Test rejection of invalid input. For valid input, verify that submission occurs once.

## Completion checks

- [ ] M1–M4 have merged implementations with no duplicate validation rules.
- [ ] Tests import and execute functions from production JavaScript. Python replicas
      and source-text checks do not establish runtime behavior.
- [ ] Tests for the renderer cover counts, paused agents, missing fields, invalid dates,
      relative time, and injected translations without a Shell session.
- [ ] Tests for the poller control replies out of order, settings changes, cancellation,
      timer replacement, incomplete configuration, and destruction.
- [ ] Tests for the transport cover failures of the network, cancellation, 401/403, other HTTP
      errors, malformed JSON, and successful creation with an unreadable body.
- [ ] Validation tests exercise the same functions used by preferences and
      runtime, including unsafe URL and repository path inputs.
- [ ] Tests for ideas cover blank and trimmed input, labels, success, and failure.
- [ ] The packed extension includes every imported module. Run the schema,
      metadata, and packaging checks in CONTRIBUTING.md after integration.
- [ ] A check in Shell confirms refresh of status, preferences changes, idea
      submission, and disable/enable behavior across the supported Shell range.

Keep test dependencies separate from runtime dependencies. Preserve the release
contract in ROADMAP.md: GNOME Shell 45–50 and no external packages from npm at runtime.
This plan does not add retries, change authentication storage, or build a CLI.
It defines reusable boundaries that a future CLI can consume.
