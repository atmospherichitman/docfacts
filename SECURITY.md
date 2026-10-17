# Security

## Reporting a vulnerability

Please report privately through GitHub's **"Report a vulnerability"** button
on the Security tab, rather than opening a public issue.

Include what you did, what happened, and what you expected. A proof of
concept helps. You will get an acknowledgement; this is a small project and
there is no SLA to promise, so none is promised.

## The threat model

DocFacts reads two files you name and prints a report. That is the whole
program, and most of its security properties come from what it *cannot* do.

### What it does not do, by construction

- **No network.** No HTTP client, no socket, no DNS. The package contains no
  code capable of making a request. Verify with:
  ```sh
  npm pack docfacts && tar -xzf docfacts-*.tgz
  grep -rE "fetch\(|node:http|node:net|child_process|eval\(" package/dist/
  ```
  That prints nothing, and a test in the suite asserts it keeps printing
  nothing.
- **No execution.** Commands appearing in your documents are read as text.
  There is no shell, no subprocess, no `eval`, no `new Function`.
- **No dependencies**, so no transitive supply chain.
- **No postinstall script.** A tool whose selling point is that it runs
  nothing should not run something at install time.
- **No files written.** No cache, no config, no state directory.

### What it does with your input

Both files are read into memory as UTF-8, normalised (byte-order mark, line
endings, lone surrogates, NUL bytes), and matched against regular
expressions. Inputs are capped at **2 MB** and must be regular files —
directories, devices, FIFOs and sockets are refused by name, because reading
a named pipe would hang rather than fail.

### Known limits

- Regular expressions over adversarial input can be slow. The 2 MB cap and
  per-kind match limits bound it, but a deliberately pathological document
  may take longer than a normal one. It cannot escape the process.
- Paths come from the command line and are used as given. There is no base
  directory to escape and nothing is written, so `../../etc/passwd` reads a
  file you could already read with `cat`. **Do not pass a path taken from a
  document**; paths should come from your workflow, not from content.

## Using the GitHub Action safely

- Run it on `pull_request`, **never `pull_request_target`**. The latter gives
  a pull request's code a write-capable token and your secrets; nothing about
  checking documentation needs either.
- Set `permissions: contents: read`. The action needs nothing more and asks
  for nothing more.
- Pin the action by tag or SHA, and pin the `version` input. It defaults to a
  fixed version for that reason.
