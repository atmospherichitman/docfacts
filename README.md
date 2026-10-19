# docfacts

Check a technical document against the reference it was written from.

It reports the commands, flags, environment variables, exit codes and
endpoints your draft claims that your reference does not support — the
plausible, helpful-looking additions that are the hardest to spot by reading.

**It runs nothing. It sends nothing. It has no dependencies.**

```
npm install -g docfacts
docfacts --reference ./upgrade-notes.md --draft ./guide.md
```

New here? The [five-minute tutorial](docs/tutorial.md) walks through one
real example — a migration guide telling people to use a flag that was
removed — including the finding it catches and the one it misses. There is
also a [website](https://atmospherichitman.github.io/docfacts/).

## What problem this solves

You have a specification, a changelog or a config reference. Someone — a
colleague, or a language model — wrote a guide from it. The guide reads well.
Somewhere in it is a flag that does not exist.

That failure is specific and easy to produce. Asked to write an install guide
from a reference that never mentioned it, a capable model produced:

```
journalctl -u meshgate --no-pager -n 50
```

`--no-pager` is a real `journalctl` flag. It is helpful. It is not in the
reference. Nothing about the output looks wrong, and a reader cannot tell
which parts came from the source.

docfacts reads your reference, works out what it actually supports, and tells
you where the draft went beyond it.

## Usage

```
docfacts --reference <file> --draft <file> [options]

  -r, --reference <file>   the source of truth the draft was written from
  -d, --draft <file>       the document to check
      --tool <name>        the command the reference documents, if the guess is wrong
      --json               machine-readable output
  -V, --version            print the version
  -h, --help               this text
```

Exit codes: **0** no findings, **1** findings, **2** usage or input error —
so it drops into CI without a wrapper.

### In a pipeline

```yaml
- run: npx docfacts --reference docs/api-spec.md --draft docs/guide.md
```

The build fails when the guide claims something the spec does not support.

### As a GitHub Action

```yaml
name: Docs
on: pull_request          # not pull_request_target — see below

permissions:
  contents: read          # all this needs; a write token is a liability

jobs:
  docfacts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: atmospherichitman/docfacts@v0.1.0
        with:
          reference: docs/api-spec.md
          draft: docs/guide.md
          # tool: forge             # if the documented command is not inferred
          # version: "0.1.0"        # the npm version to run; pinned by default
          # fail-on-findings: "false"   # report without blocking
```

`@v0.1.0` never moves. `@v0` follows the latest compatible release, which
gets you fixes without an edit and means the code you run can change without
one. Pick whichever of those you prefer; a commit SHA is stricter than both.

Three things about this are deliberate, and worth keeping if you adapt it:

- **`pull_request`, never `pull_request_target`.** The latter runs with a
  write-capable token and your secrets available to a pull request's own
  code. Checking documentation needs neither.
- **`permissions: contents: read`.** The action reads two files and writes
  its report outside the checkout. It asks for nothing else.
- **Paths come from your workflow, not from the pull request.** The action
  rejects inputs that start with `-` or contain `..`, but the right habit is
  to name the files yourself rather than take a path from content.

Exit codes are `0` for a clean check, `1` for findings, and `2` for an input
or usage error. A missing file, an unreadable report, or a version that does
not match the pin is a `2` and fails the job — `fail-on-findings: "false"`
silences findings and nothing else. "No findings" is only ever reported when
the tool actually ran and actually found none.

The step also sets two outputs: `findings` (the count) and `report` (the path
to the JSON report, for `actions/upload-artifact`).

## What it reports

| | |
|---|---|
| `fabricated` | not in the reference at all |
| `unsupported_used` | the reference says it does not exist, and the draft offers it |
| `misattributed` | a flag the reference gives to a different command |
| `default_disagrees` | the draft's default differs from the reference's |
| `internal_contradiction` | the draft gives one thing two values |
| `deprecated_unacknowledged` | *a note* — it works, but say that it is going away |

Findings are split into two groups, because they are different claims:

- **Contradicted by the reference.** The reference says the opposite, and the
  report quotes it. You can check this in seconds.
- **Not supported by the reference.** It appears in the draft and not in the
  reference. That may mean the draft invented it, or that your reference does
  not cover it, or that this tool failed to read it.

Collapsing those into one list would overstate the second and make the first
easier to dismiss, so they are kept apart.

Every finding quotes the draft's own words, and anything the reference makes
wrong quotes the reference too. The report also prints **how the reference
was read**, before the findings, so a wrong reading is visible rather than
silent.

### Example

```
Contradicted by the reference (2)
------------------------------
  1. [unsupported_used] the draft presents the flag "--unsafe-fsync" as
     usable, but the reference says it is not
     in the draft:
      For durability on spinning disks, pass --unsafe-fsync to force a flush.
     in the reference:
      --unsafe-fsync was removed in 3.2.

  2. [misattributed] the draft gives "--system" to "beacondb", but the
     reference gives it to "useradd"
     ...

Not supported by the reference (1)
-------------------------------
  1. [fabricated] the flag "--verbose" does not appear in the reference
     in the draft:
      beacondb serve --port 8080 --workers 8 --verbose
```

## Limitations

Read this part. A tool like this is only useful if you know what it does not
do.

**A clean report does not mean the document is correct.** It means nothing in
it contradicted your reference in the specific ways listed above. In
particular:

- **Missing content is not checked.** Whether the document covers what it
  needs to cover depends on what you need, which is not in the reference.
  This is the largest gap.
- **Facts stated as prose are not cross-checked.** Numbers, versions and
  dates in sentences are not verified. "Requires kernel 5.10" against a
  reference saying 5.15 will pass.
- **Nothing is executed**, so nothing is validated. Whether the instructions
  work is not checked and cannot be.
- **Prose quality, ordering and tone are not checked.**
- **The reference is taken as true.** A document faithful to a wrong
  reference passes.
- **A reference with no structure yields nothing checkable.** Pure prose with
  no commands or options gives the tool nothing to compare against, and it
  says so rather than reporting a clean result.
- **Inference is heuristic.** It reads flag tables, indented blocks, inline
  code and prose, and a reference formatted in a way it has not seen may be
  read wrong. That is why the report prints what it inferred.

Known gaps:

- A fabricated status code in a table under a heading that does not mention
  codes is not detected. That scoping exists because without it a table of
  *flag values* was read as undocumented exit codes and flagged correct work.
  Codes stated outright (`exits 503`) are caught anywhere.
- A fabricated subcommand whose name is a common English word may be missed,
  traded deliberately against a much more common false positive.

## Privacy

Your documents stay on your machine. See [PRIVACY.md](PRIVACY.md).

Briefly: no network code, no telemetry, no analytics, no crash reporting, no
dependencies, no files written. The package contains no code that can open a
socket or start a process, and that is enforced by a test rather than
promised in prose.

## Requirements

Node 20 or newer. No other dependencies.

## License

MIT. See [LICENSE](LICENSE).
