# Changelog

All notable changes to docfacts are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — GitHub Action could not run on a GitHub runner

The Action invoked the CLI with `npx docfacts@<version>`, which failed on
ubuntu runners with `sh: 1: docfacts: not found` and exit 127. `npx`
installs a package and then asks a shell to run a *command named after it*,
so the run depended on a bin link existing, on `PATH`, on the executable
bit, on the shebang, and on `npx` not deciding that some local package
already satisfied the spec — which matters here, because the Action is
normally run inside a checkout, and for this repository that checkout is
itself a package named `docfacts`.

None of that indirection is necessary. The Action now installs the pinned
version into a directory of its own under `$RUNNER_TEMP`, with its own
project root so npm cannot resolve against the checkout, reads the entry
point from the installed package's `bin` metadata, verifies the installed
version matches the pin, and runs it with `node`. There is no command
lookup left to fail.

The failure also produced no diagnosis, so each way this can go wrong now
reports what is actually wrong: the install failing, the installed package
declaring no `docfacts` command, the declared command being absent from the
package, or npm installing a different version than the one pinned. Exit
127 is explicitly an environment failure and never a clean result.

The install also runs with `--ignore-scripts`. Nothing fetched from a
registry should run lifecycle code on a runner holding a checkout and a
token; docfacts declares no scripts and no dependencies, so this costs
nothing.

No change to the CLI or the published package.

### Security — GitHub Action

The GitHub Action in this repository was unsafe as first committed, and is
rewritten. **If you copied `action.yml` or referenced this action by branch
rather than by tag, take the new version.** The npm package was never
affected; the CLI itself is unchanged.

Four problems, each fixed:

- **Script injection.** `${{ inputs.reference }}`, `${{ inputs.draft }}` and
  `${{ inputs.tool }}` were interpolated into the action's bash script.
  GitHub substitutes `${{ }}` as text before bash parses it, so an input
  containing `$(...)` or `;` became a command rather than a path. Every input
  now reaches the shell through `env:` and is read as a quoted variable;
  nothing untrusted is part of the script's source. Verified by executing the
  action against a set of injection payloads.
- **Suppressed exit codes.** Two `npx` calls ended in `|| true`, so a missing
  file — which the CLI reports as exit 2 — became "0 findings" and a passing
  job. Exit codes are now captured and interpreted: 0 and 1 are results,
  anything else fails.
- **A malformed report read as success.** The finding count was parsed with a
  `catch` that returned `0`, so unparseable or absent JSON also reported "no
  findings". A missing, empty, malformed or wrong-version report now fails
  the job and says why. "No findings" is only reported when the tool
  actually ran and found none.
- **Report written into the checkout.** `docfacts.json` was written to the
  working directory, where a later step could commit it. It now goes to
  `$RUNNER_TEMP`, and its path is exposed as the `report` output.

Also in this pass:

- `fail-on-findings` governs findings and nothing else — input and usage
  errors fail the job regardless. A value other than `"true"` or `"false"` is
  a usage error rather than a silent `false`.
- A new `version` input, pinned by default, and the report's own version is
  checked against the pin so a mismatched install cannot pass unnoticed.
- Input paths are rejected if they are empty, start with `-`, contain a `..`
  segment, or are not readable regular files.
- The CLI is invoked once rather than twice; the log digest is rendered from
  the JSON report.
- `set -euo pipefail`.

The action's safe-usage requirements — `pull_request` rather than
`pull_request_target`, and `permissions: contents: read` — are documented in
the README and `SECURITY.md`. A dependency-free test suite now asserts these
properties on every pull request to this repository.

## [0.1.0] — unreleased

First release candidate. **Not yet published to npm.**

### Added

- `docfacts --reference <file> --draft <file>`, with `docverify` as an alias.
- Inference of what a reference document supports: commands, flags,
  environment variables, exit and status codes, endpoints, and stated
  defaults, each classified as supported, unsupported, deprecated or
  belonging to another command.
- Six finding kinds: `fabricated`, `unsupported_used`, `misattributed`,
  `default_disagrees`, `internal_contradiction`, and
  `deprecated_unacknowledged` as a note.
- Findings split by confidence: contradicted by the reference, versus merely
  not supported by it.
- A human-readable report and `--json`, both carrying the limitations and an
  explicit statement that a clean result is not a guarantee of correctness.
- Exit codes 0 (clean), 1 (findings), 2 (usage or input error).
- `--help`, `--version`, and `--tool` for when the documented command cannot
  be inferred.
- Input validation: regular files only, a 2 MB ceiling, and refusal of
  directories, devices, pipes and empty files.
- Text normalisation so a byte-order mark, CRLF endings, lone surrogates and
  NUL bytes do not change the result.

### Security and privacy

- No network code, no telemetry, no files written, no execution of document
  contents, and no dependencies. Enforced by tests over the import graph, not
  by assertion in documentation.

### Known limitations

- Missing content is not detected.
- Facts stated as prose are not cross-checked.
- Inference is heuristic and sensitive to how a reference is laid out.
- A fabricated status code in a table under an unrelated heading is not
  detected.
- A fabricated subcommand whose name is a common English word may be missed.

See the README for the full list.
