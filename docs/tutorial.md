# Tutorial: catching a wrong command in a migration guide

A guide that tells people to use a flag that was removed is worse than no
guide. It reads perfectly, it sounds confident, and the first a reader knows
about it is an error message.

This walkthrough takes about five minutes. You will write two short
documents, run one command, read what DocFacts reports, fix the guide, and
watch the findings go away. Everything below is real output from
`docfacts@0.1.0` — you should get the same thing, word for word.

You need Node 20 or newer. Nothing else: no account, no API key, no config
file.

---

## The situation

A fictional static-site builder called Pagoda has just released version 2.0.
You have its release notes, and someone has written a getting-started guide
from them. The guide looks fine. It is not.

Make a folder and put these two files in it.

### `release-notes.md` — the reference

This is your source of truth: the document that describes how the software
actually behaves.

````markdown
# Pagoda 2.0 release notes

Pagoda is a static site builder. Version 2.0 changes how builds are
configured and how output is written.

## Building a site

```bash
pagoda build --config pagoda.toml --out dist
```

## Options

`--config <file>`  Path to the configuration file. Defaults to `pagoda.toml`
in the current directory.

`--out <dir>`  Directory to write the built site into. Defaults to `build`.

`--drafts`  Include pages marked `draft = true`.

`--verbose`  Print each page as it is written.

## Environment

`PAGODA_CACHE_DIR`  Where build caches are kept. Defaults to `.pagoda-cache`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | The build succeeded. |
| `1` | The build failed. |

## Removed in 2.0

`--minify` was removed. Minification is always on in 2.0 and cannot be
disabled.

`--watch` was removed from `build`. Use `pagoda serve` instead.
````

### `guide.md` — the draft to check

This is the document you are about to publish.

````markdown
# Getting started with Pagoda 2.0

Pagoda turns a folder of Markdown into a static website. This guide covers
your first build.

## Install and build

Build the site with:

```bash
pagoda build --config pagoda.toml --out dist
```

Pagoda writes the finished site into the directory you pass to `--out`.

## Faster builds

For large sites, enable minification and parallel rendering:

```bash
pagoda build --minify --jobs 8
```

Set `PAGODA_CACHE_DIR` to keep the cache on a fast disk.

## Previewing while you write

Rebuild automatically as files change:

```bash
pagoda build --watch
```

## Checking the result

Pagoda exits with `0` on success and `2` if any page failed to render.
````

Read the guide and see how many problems you can spot before running
anything. Most people find one. There are three that DocFacts will catch,
and a fourth it will not — which turns out to be the most useful part of
this tutorial.

---

## Run the check

```sh
npx docfacts@0.1.0 --reference release-notes.md --draft guide.md
```

Or install it first, if you would rather:

```sh
npm install -g docfacts
docfacts --reference release-notes.md --draft guide.md
```

---

## What it found

The report opens by telling you what it understood the reference to say.
This part matters: if DocFacts has misread your reference, every finding
below it is suspect, and this is where you would notice.

```
What the reference declares
---------------------------
  commands (2)
      supported    pagoda build, pagoda serve
  flags (6)
      supported    --config, --drafts, --out, --verbose
      unsupported  --minify, --watch
  environment variables (1)
      supported    PAGODA_CACHE_DIR
  exit or status codes (2)
      supported    0, 1
```

That is right. It has read both options that were removed and marked them
unsupported.

### Contradicted by the reference

```
Contradicted by the reference (2)
------------------------------
  1. [unsupported_used] the draft presents the flag "--minify" as usable, but the reference says it is not
     in the draft:
      pagoda build --minify --jobs 8
     in the reference:
      `--minify` was removed.

  2. [unsupported_used] the draft presents the flag "--watch" as usable, but the reference says it is not
     in the draft:
      pagoda build --watch
     in the reference:
      `--watch` was removed from `build`.
```

These are the strong findings. DocFacts is not guessing that `--minify`
looks unfamiliar — it found the sentence in your reference saying the option
was removed, and quotes it next to the line in the draft that tells a reader
to use it. You can confirm both in seconds without opening either file.

A flag, if you have not met the term, is an option you add to a command to
change what it does — the `--minify` part of `pagoda build --minify`.

### Not supported by the reference

```
Not supported by the reference (1)
-------------------------------
  These appear in the draft and not in the reference. That may mean the draft
  invented them, or that the reference does not cover them, or that this tool
  failed to read them. Check each against your source before acting.

  1. [fabricated] the flag "--jobs" does not appear in the reference
     in the draft:
      pagoda build --minify --jobs 8
```

This is a weaker claim, and DocFacts says so by putting it in a separate
section. `--jobs` is not mentioned anywhere in the release notes. That could
mean the writer invented it, or that the release notes are incomplete, or
that DocFacts failed to parse something. **Absence of evidence is not
evidence of absence**, and the tool does not pretend otherwise.

In this case it was invented. Pagoda has no `--jobs`.

The two sections exist because they are different claims. The first says
*your own reference contradicts this*. The second says *I could not find
this*. Treating them the same would make the second look more certain than
it is.

---

## The one it missed

Look at the last line of the draft:

> Pagoda exits with `0` on success and `2` if any page failed to render.

The reference lists exit codes `0` and `1`. There is no `2`. DocFacts did
not flag it.

This is not a bug, it is the documented boundary. From the report's own
limitations section:

```
  - A fact stated as prose rather than as a flag, variable, code or endpoint is not cross-checked. Numbers, version strings and dates in sentences are not verified.
```

The claim is in a sentence. Had the same claim been in a table or a code
block, it would have been caught — the tool reads structure, and a number in
running prose is not structure.

Worth knowing, because it tells you what the tool is for. DocFacts narrows
the amount of a document you have to check by hand. It does not remove the
need to check.

---

## Fix the guide

Three edits, each following what the reference actually says:

- minification is always on in 2.0, so there is nothing to enable
- `--watch` became `pagoda serve`
- there is no `--jobs`

And a fourth that DocFacts did not ask for, because it could not see it:
the failure exit code is `1`, not `2`.

Replace `guide.md` with this:

````markdown
# Getting started with Pagoda 2.0

Pagoda turns a folder of Markdown into a static website. This guide covers
your first build.

## Install and build

Build the site with:

```bash
pagoda build --config pagoda.toml --out dist
```

Pagoda writes the finished site into the directory you pass to `--out`.

## Faster builds

Minification is always on in 2.0, so there is nothing to enable. To see what
is taking time, build with:

```bash
pagoda build --verbose
```

Set `PAGODA_CACHE_DIR` to keep the cache on a fast disk.

## Previewing while you write

Rebuild automatically as files change:

```bash
pagoda serve
```

## Checking the result

Pagoda exits with `0` on success and `1` if the build failed.
````

Run the same command again:

```sh
npx docfacts@0.1.0 --reference release-notes.md --draft guide.md
```

```
Contradicted by the reference (0)
------------------------------
  Nothing in the draft contradicts the reference in the ways checked.

Not supported by the reference (0)
-------------------------------
  Nothing.

What was checked
----------------
  9 claim(s) in the draft matched something the reference supports.
  The reference was read as declaring 9 supported, 2 unsupported.
```

Nine claims in the guide now line up with the reference, and nothing
contradicts it.

---

## What a clean result does and does not mean

It means: nothing in your draft contradicted your reference **in the
specific ways DocFacts checks**.

It does not mean the document is correct. In particular:

- **Missing content is not detected.** A guide that omits the one step
  everyone gets wrong passes cleanly.
- **Prose is not cross-checked.** The exit code above is the example — a
  wrong number in a sentence goes unnoticed.
- **The reference is taken as true.** If your release notes are wrong, a
  guide that faithfully repeats them passes.
- **Nothing is executed.** DocFacts reads both files as text. It has no idea
  whether `pagoda build` works, or exists.
- **Inference is heuristic.** It is sensitive to how a reference is laid
  out. That exit-code table is read; the same information as a prose list
  might not be. If the "what the reference declares" section looks wrong,
  trust that over the findings — and please
  [open an issue](https://github.com/atmospherichitman/docfacts/issues),
  because that is the most useful bug report this project can get.

A clean result narrows what a human has to read closely. It is not a
signature on the document.

---

## Exit codes, for CI

| Code | Meaning |
|------|---------|
| `0` | No findings |
| `1` | Findings reported |
| `2` | Input or usage error — a missing file, a bad flag |

`2` is deliberately distinct from `1`. A check that cannot run should not
report that everything is fine.

To run this on every documentation change, there is a
[GitHub Action](../README.md#as-a-github-action). Start it with
`fail-on-findings: "false"` and watch what it says about your real
documentation for a week before letting it block a merge.

---

## Where to go next

- [`examples/`](../examples/) — a larger reference-and-guide pair with nine
  different kinds of mistake, including invented endpoints and environment
  variables, and a correct version of the same guide that reports nothing.
- [`README.md`](../README.md) — every finding kind, and the full
  limitations list.
- [`SECURITY.md`](../SECURITY.md) — what the tool reads, what it never does,
  and how to run the Action safely.

If you try this on your own documentation, the project would genuinely like
to know what happened — particularly anything it flagged that was actually
fine, or anything obvious it walked straight past.
