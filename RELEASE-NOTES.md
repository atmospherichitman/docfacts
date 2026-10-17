# Release notes

## 0.1.0 — first public release

The first release. A command-line tool that checks a technical document
against the reference it was written from.

```sh
npm install -g docfacts
docfacts --reference ./spec.md --draft ./guide.md
```

### What it finds

Claims your reference does not support: invented commands, flags,
environment variables, exit codes and endpoints; options attributed to the
wrong command; features your reference says do not exist, offered as if they
work; defaults that disagree with the reference or with each other.

Findings are split in two, because they are different claims.
**Contradicted by the reference** means your source says the opposite, and
the report quotes it. **Not supported by the reference** means something is
absent — which may mean the draft invented it, or that your reference does
not cover it, or that DocFacts misread it.

### What it does not find

Missing content, facts stated in prose, whether the instructions actually
work, or whether the writing is any good. A clean report is not a guarantee
of correctness, and the tool says so on every run.

### How it was tested

2,577 automated tests, plus a run against six real documentation pairs from
ESLint, Jest, Ruff, Prettier, Vitest and uv. **That run found seven defects
in DocFacts itself**, six of which gave confident wrong answers — a fence
with an info string that mis-paired and turned prose into code, comments read
as commands, `npx` taking credit for the tool it runs, and a restriction on
combining two flags read as a denial of one. All are fixed and pinned by
regression tests.

The synthetic suite had found none of them. That is worth knowing when
weighing any claim made from synthetic tests, including the ones here.

### Honest status

No published accuracy rate, because there isn't one worth quoting from six
documents. Expect to find it useful on documentation shaped like the projects
above, and expect surprises on documentation shaped differently. Issues about
the second kind are the most useful thing you can send.
