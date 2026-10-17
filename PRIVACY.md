# Privacy

**Your documents never leave your machine.**

docfacts is a local command-line program. It reads the two files you name,
computes a report, writes it to standard output, and exits.

## What it does

- Reads exactly the two file paths you pass on the command line.
- Writes the report to standard output.

## What it does not do

- **No network access.** There is no HTTP client, no `fetch`, no socket, no
  DNS lookup. The package contains no code capable of making a request.
- **No telemetry, analytics or usage reporting.** None, including none that
  is "anonymous" or "aggregate".
- **No crash or error reporting.** Errors are printed to your terminal and
  nowhere else.
- **No files written.** Nothing is cached, logged or saved. No temporary
  files, no config file, no state directory.
- **No dependencies.** Nothing else is installed with it, so there is no
  third party that could do any of the above.
- **Nothing executed.** Commands appearing in your documents are read as
  text. No shell, no subprocess, no `eval`.
- **No environment inspection.** No API keys, tokens or credentials are read,
  because none are needed.

## How to verify this rather than believe it

The claims above are asserted by tests that walk the package's import graph
and fail if any file references `child_process`, `spawn`, `exec`, `eval`,
`fetch`, `node:http`, `node:https`, `node:net`, `node:dgram` or an HTTP
library.

You can also check it yourself in less than a minute:

```sh
npm pack docfacts && tar -xzf docfacts-*.tgz
grep -rE "fetch\(|node:http|node:net|child_process|eval\(" package/dist/
```

That should print nothing. The package is a few files and no dependencies, so
reading all of it is realistic.

You can also run it with the network disabled, which changes nothing about
how it behaves.

## Documents you check

They are yours. They are read, held in memory for the duration of the
command, and discarded when the process exits. They are not copied, hashed,
summarised or transmitted.

This matters for the obvious case: the documents you check are often an
unreleased specification. A tool for reading those has no business opening a
socket, and "it only sends a hash" is the kind of claim that turns out to be
untrue later. The design here is to be incapable rather than well-behaved.

## Contact

Report a privacy concern as a security issue on the repository rather than in
a public issue thread.
