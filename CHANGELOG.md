# Changelog

All notable changes to docfacts are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
