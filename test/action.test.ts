/**
 * The GitHub Action's security contract, asserted textually.
 *
 * This is the guard that would have caught the bug that shipped. An earlier
 * version of this action interpolated workflow inputs straight into its bash
 * script — a GitHub Actions script injection — and was believed fixed for a
 * while before anyone opened the file again. Nothing failed in the meantime,
 * because nothing was checking.
 *
 * So these tests read `action.yml` as text and assert the four properties
 * that version got wrong. Deliberately dependency-free (no YAML parser) so
 * it can run anywhere the package runs, including in the published
 * repository's own CI on every pull request.
 *
 * A companion suite in the development repository *executes* the extracted
 * script against a stubbed CLI and checks the behaviour. This one checks the
 * shape. Both are needed: shape alone is what was previously reviewed, and
 * reviewing shape by eye is how the bug survived.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";

/** Resolved once; the file sits at the repository root in both layouts. */
const CANDIDATES = ["action.yml", "packages/docfacts/action.yml"];

let raw: string;
/** The body of the `run:` block — the part that becomes shell source. */
let runScript: string;

beforeAll(() => {
  const found = CANDIDATES.find((p) => fs.existsSync(p));
  expect(found, `action.yml not found in any of ${CANDIDATES.join(", ")}`).toBeDefined();
  raw = fs.readFileSync(found as string, "utf-8");

  // Textual extraction rather than a YAML parse, so this test needs nothing
  // installed. The block starts at `run: |` and runs to the end of file or
  // to the next line indented less than the block's body.
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*run:\s*\|/.test(l));
  expect(start, "action.yml has no `run: |` block").toBeGreaterThan(-1);

  const body: string[] = [];
  const indent = (l: string) => l.length - l.trimStart().length;
  let blockIndent: number | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      body.push(line);
      continue;
    }
    if (blockIndent === null) blockIndent = indent(line);
    if (indent(line) < blockIndent) break;
    body.push(line);
  }
  runScript = body.join("\n");
  expect(runScript.length, "the extracted run block is empty").toBeGreaterThan(100);
});

describe("no workflow input reaches the shell as source text", () => {
  it("has no ${{ }} expression anywhere in the run block", () => {
    // The whole vulnerability in one assertion. GitHub substitutes these as
    // text before bash parses the script, so an input containing `$(...)`
    // or `;` becomes a command rather than a path.
    const offenders = runScript
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes("${{"));
    expect(offenders, `run block interpolates expressions:\n${offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join("\n")}`).toEqual([]);
  });

  it("passes every declared input through an env block instead", () => {
    // Scoped to the `inputs:` section. Keys under `outputs:` are indented
    // identically, and counting those made this test demand that an output
    // be passed in as an input.
    const section = /^inputs:\s*$([\s\S]*?)^[a-z]/m.exec(raw);
    expect(section, "action.yml has no inputs: section").not.toBeNull();
    const declared = [...(section as RegExpExecArray)[1].matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map(
      (m) => m[1],
    );
    expect(declared.length, "no inputs were found to check").toBeGreaterThan(0);
    for (const name of declared) {
      expect(
        raw.includes(`\${{ inputs.${name} }}`),
        `input '${name}' is declared but never passed anywhere`,
      ).toBe(true);
    }
    // And each of those references must sit in an `env:` mapping, which is
    // the only safe place for them.
    const envBlock = /env:\s*\n((?:\s+DF_[A-Z_]+:.*\n)+)/.exec(raw);
    expect(envBlock, "the step has no env: block mapping inputs").not.toBeNull();
    for (const name of declared) {
      expect(
        (envBlock as RegExpExecArray)[1].includes(`inputs.${name}`),
        `input '${name}' is not mapped into the env block`,
      ).toBe(true);
    }
  });

  it("reads its inputs as quoted shell variables", () => {
    // Unquoted "$DF_REFERENCE" would word-split a path containing a space.
    const unquoted = runScript.match(/(?<!")\$DF_[A-Z_]+(?!")/g) ?? [];
    const allowed = new Set(["$DF_REPORT", "$DF_DIGEST", "$DF_CLI_STATUS", "$DF_VERSION"]);
    const bad = unquoted.filter((v) => !allowed.has(v));
    expect(bad, `unquoted input variables: ${bad.join(", ")}`).toEqual([]);
  });
});

describe("the run cannot fail open", () => {
  it("never discards an exit code with || true", () => {
    // `|| true` after the CLI turned exit 2 — a missing file — into a green
    // check reporting zero findings.
    expect(runScript).not.toMatch(/\|\|\s*true/);
  });

  it("never swallows an error into a default count", () => {
    // The old version counted findings with a `catch` that returned '0', so
    // an unparseable report also reported "no findings".
    expect(runScript).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*[^}]*['"]0['"]/);
  });

  it("captures the CLI exit code and branches on it", () => {
    expect(runScript).toMatch(/cli_status=\$\?/);
    // 0 and 1 are results; everything else must be rejected explicitly.
    expect(runScript).toMatch(/0\|1\)/);
  });

  it("treats a missing or malformed report as a failure", () => {
    for (const phrase of ["not valid JSON", "is empty", "no findings array"]) {
      expect(runScript, `the report check does not handle: ${phrase}`).toContain(phrase);
    }
    // And says so explicitly, so the intent survives the next edit.
    expect(runScript).toMatch(/not as zero findings/);
  });

  it("verifies the report came from the pinned version", () => {
    expect(runScript).toMatch(/version mismatch/);
  });

  it("enables strict shell flags", () => {
    expect(runScript).toMatch(/set -euo pipefail/);
  });
});

describe("nothing is written into the checkout", () => {
  it("writes the report to RUNNER_TEMP", () => {
    expect(runScript).toMatch(/RUNNER_TEMP/);
  });

  it("does not redirect into a relative docfacts.json", () => {
    // The old version wrote ./docfacts.json into the working directory,
    // where a later step could commit it.
    expect(runScript).not.toMatch(/>\s*\.?\/?docfacts\.json/);
  });
});

describe("the CLI runs once, at a pinned version", () => {
  it("invokes npx exactly once", () => {
    expect(runScript.match(/npx\s+--yes/g) ?? []).toHaveLength(1);
  });

  it("pins the version rather than following the latest release", () => {
    expect(runScript).toMatch(/docfacts@\$\{DF_VERSION\}/);
    const def = /version:\s*\n(?:\s+.*\n)*?\s+default:\s*"(\d+\.\d+\.\d+)"/.exec(raw);
    expect(def, "the version input has no exact default").not.toBeNull();
  });

  it("validates the version before it becomes part of a package spec", () => {
    expect(runScript).toMatch(/\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/);
  });
});

describe("input validation", () => {
  it("rejects a path that would be read as a flag", () => {
    expect(runScript).toMatch(/read as a flag/);
  });

  it("rejects a traversing path", () => {
    expect(runScript).toMatch(/path segment/);
  });

  it("requires each input to be an existing regular file", () => {
    expect(runScript).toMatch(/-f "\$value"/);
  });

  it("rejects a fail-on-findings value it does not understand", () => {
    // Rather than treating anything that is not "true" as false, which would
    // let a typo disable the gate silently.
    expect(runScript).toMatch(/true\|false\)/);
  });
});

describe("the documented contract matches the file", () => {
  it("declares the version input that SECURITY.md tells people to pin", () => {
    if (!fs.existsSync("SECURITY.md")) return;
    const security = fs.readFileSync("SECURITY.md", "utf-8");
    if (!/pin the `version` input/i.test(security)) return;
    expect(raw).toMatch(/^ {2}version:\s*$/m);
  });

  it("exposes the report path so a workflow can upload it", () => {
    expect(raw).toMatch(/^ {2}report:\s*$/m);
  });
});
