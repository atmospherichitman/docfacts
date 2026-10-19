/**
 * The GitHub Action's security contract.
 *
 * This is the guard that would have caught the bug that shipped. An earlier
 * version of this action interpolated workflow inputs straight into its bash
 * script — a GitHub Actions script injection — and was believed fixed for a
 * while before anyone opened the file again. Nothing failed in the meantime,
 * because nothing was checking.
 *
 * A companion suite in the development repository *executes* the extracted
 * script against a stubbed CLI and checks its behaviour. This one checks its
 * shape. Both are needed: shape alone is what was previously reviewed, and
 * reviewing shape by eye is how the bug survived.
 *
 * ── Why this parses YAML instead of matching text ───────────────────────
 *
 * The first version of this file asserted on the raw file with multiline
 * regular expressions, and two of them used `.*\n`. In JavaScript `\r` is a
 * line terminator, so `.` does not match it, and `.*\n` cannot match a line
 * ending in CRLF. On a Windows checkout — `core.autocrlf` is `true` there by
 * default — those two tests failed while Ubuntu and macOS passed. The action
 * was correct; the tests were wrong about the file they were reading.
 *
 * Parsing structurally removes that whole class of problem: the YAML parser
 * normalises line endings itself, so the assertions are about the document
 * rather than about how a platform happens to spell a newline. The few
 * assertions that genuinely are about shell source text normalise line
 * endings first and say so.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import YAML from "yaml";

/** The file sits at the repository root in both the public and dev layouts. */
const CANDIDATES = ["action.yml", "packages/docfacts/action.yml"];

interface ActionStep {
  id?: string;
  shell?: string;
  run?: string;
  env?: Record<string, string>;
}

interface ActionFile {
  inputs?: Record<string, { description?: string; required?: boolean; default?: unknown }>;
  outputs?: Record<string, { description?: string; value?: string }>;
  runs?: { using?: string; steps?: ActionStep[] };
}

let action: ActionFile;
let step: ActionStep;
/** The shell source, with line endings normalised. */
let runScript: string;

beforeAll(() => {
  const found = CANDIDATES.find((p) => fs.existsSync(p));
  expect(found, `action.yml not found in any of ${CANDIDATES.join(", ")}`).toBeDefined();

  action = YAML.parse(fs.readFileSync(found as string, "utf-8")) as ActionFile;

  expect(action.runs?.using, "the action is not a composite action").toBe("composite");
  const steps = action.runs?.steps ?? [];
  expect(steps.length, "the action has no steps").toBeGreaterThan(0);
  step = steps[0];

  expect(typeof step.run, "the first step has no run block").toBe("string");
  // A YAML block scalar already normalises line breaks, but normalising
  // again costs nothing and makes the intent explicit for anyone who adds an
  // assertion below.
  runScript = (step.run as string).replace(/\r\n/g, "\n");
  expect(runScript.length, "the run block is suspiciously short").toBeGreaterThan(100);
});

/** The inputs the action declares, as a list of names. */
const inputNames = (): string[] => Object.keys(action.inputs ?? {});

describe("no workflow input reaches the shell as source text", () => {
  it("has no ${{ }} expression anywhere in the run block", () => {
    // The whole vulnerability in one assertion. GitHub substitutes these as
    // text before bash parses the script, so an input containing `$(...)`
    // or `;` becomes a command rather than a path.
    const offenders = runScript
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes("${{"));
    expect(
      offenders,
      `run block interpolates expressions:\n${offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join("\n")}`,
    ).toEqual([]);
  });

  it("passes every declared input through the step's env block", () => {
    const env = step.env ?? {};
    const mapped = Object.values(env).map((v) => String(v).trim());

    expect(inputNames().length, "the action declares no inputs").toBeGreaterThan(0);
    for (const name of inputNames()) {
      // Exactly the canonical form, so a near-miss like `inputs.reference`
      // without braces cannot satisfy it.
      expect(
        mapped.includes(`\${{ inputs.${name} }}`),
        `input '${name}' is declared but not mapped into the env block; env is ${JSON.stringify(env)}`,
      ).toBe(true);
    }
  });

  it("maps nothing into env except declared inputs", () => {
    // A stray `${{ github.event.pull_request.title }}` in env would be
    // attacker-controlled data arriving under a trusted-looking name.
    const allowed = new Set(inputNames().map((n) => `\${{ inputs.${n} }}`));
    for (const [key, value] of Object.entries(step.env ?? {})) {
      const v = String(value).trim();
      if (!v.includes("${{")) continue;
      expect(allowed.has(v), `env.${key} maps ${v}, which is not a declared input`).toBe(true);
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

  it("takes the version from the input rather than following the latest release", () => {
    expect(runScript).toMatch(/docfacts@\$\{DF_VERSION\}/);
  });

  it("defaults the version input to an exact version", () => {
    // Read from the parsed document, not matched in the file. YAML may quote
    // this or not, and on a CRLF checkout the line does not end where an
    // LF-only pattern expects it to.
    const version = action.inputs?.version;
    expect(version, "the action declares no version input").toBeDefined();
    expect(String(version?.default), "the version default is not an exact version").toMatch(
      /^\d+\.\d+\.\d+$/,
    );
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

describe("the declared interface", () => {
  it("declares the version input SECURITY.md tells people to pin", () => {
    if (!fs.existsSync("SECURITY.md")) return;
    const security = fs.readFileSync("SECURITY.md", "utf-8");
    if (!/pin the `version` input/i.test(security)) return;
    expect(action.inputs?.version, "SECURITY.md documents an input that does not exist").toBeDefined();
  });

  it("exposes the findings count and the report path", () => {
    expect(Object.keys(action.outputs ?? {}).sort()).toEqual(["findings", "report"]);
  });

  it("builds its outputs from the step, not from an input", () => {
    for (const [name, output] of Object.entries(action.outputs ?? {})) {
      expect(String(output.value), `output '${name}' does not come from the step`).toMatch(
        /^\$\{\{\s*steps\.[a-z_]+\.outputs\.[a-z_]+\s*\}\}$/,
      );
    }
  });
});

describe("the tests themselves are not fooled by line endings", () => {
  // The regression this file is a correction for: two assertions used `.*\n`,
  // which cannot match a CRLF line because `.` excludes `\r` in JavaScript.
  // Ubuntu and macOS passed, Windows failed, and the action was fine.
  it("reaches the same conclusions on a CRLF copy of the file", () => {
    const found = CANDIDATES.find((p) => fs.existsSync(p)) as string;
    const raw = fs.readFileSync(found, "utf-8");
    const lf = raw.replace(/\r\n/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");

    const fromLf = YAML.parse(lf) as ActionFile;
    const fromCrlf = YAML.parse(crlf) as ActionFile;

    expect(JSON.stringify(fromCrlf)).toEqual(JSON.stringify(fromLf));
    expect(fromCrlf.inputs?.version?.default).toBe(fromLf.inputs?.version?.default);
    expect(fromCrlf.runs?.steps?.[0].env).toEqual(fromLf.runs?.steps?.[0].env);
    // And the block scalar comes back without carriage returns either way,
    // so the shell-source assertions above are safe.
    expect(String(fromCrlf.runs?.steps?.[0].run)).not.toMatch(/\r/);
  });
});
