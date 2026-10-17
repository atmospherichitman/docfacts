/**
 * Regressions found by running against real published documentation.
 *
 * Phase 4 of A12 ran the verifier over six public documentation pairs —
 * ESLint, Jest, Ruff, Prettier, Vitest and uv. The synthetic suite was green
 * and the real run produced **six confident false findings and about
 * twenty-five noisy ones**, every one a defect in the reader rather than in
 * the documents.
 *
 * Each case below is reduced from the document that produced it, with the
 * project named. They are kept because the synthetic fixtures could not have
 * found any of them: I wrote those fixtures, so they are formatted the way I
 * imagine documentation is formatted.
 */

import { describe, it, expect } from "vitest";
import {
  extractCommandUses,
  extractFlagUses,
  presentsAsUsable,
} from "../src/spec.js";
import { collectDefaults, inferReference, inferToolCommand } from "../src/infer.js";
import { check } from "../src/check.js";

describe("fenced code blocks with an info string (Jest)", () => {
  // Jest's GettingStarted.md opens a block with "```bash npm2yarn". An
  // opener of ```[a-z]*\n does not match that, so the opener was skipped and
  // the CLOSING fence paired with the next opener — turning a paragraph of
  // prose into a code block whose sentences were scanned as commands. This
  // one bug produced most of the noise across all six projects.
  const doc = [
    "```bash npm2yarn",
    "npm install --save-dev jest",
    "```",
    "",
    "You can run Jest directly from the CLI.",
    "",
    "```javascript",
    "test('adds', () => {});",
    "```",
  ].join("\n");

  it("does not read prose between blocks as commands", () => {
    const uses = extractCommandUses(doc, "jest");
    const fromCode = uses.filter((u) => !u.fromProse).map((u) => u.token);
    expect(fromCode).not.toContain("jest directly");
  });

  it("still reads the block that has the info string", () => {
    // The opener must be recognised, not merely tolerated.
    const flags = extractFlagUses(doc, "jest", ["npm"]).map((f) => f.token);
    expect(flags).toContain("--save-dev");
  });

  it("handles a title= info string too", () => {
    const titled = ['```js title="jest.config.js"', "module.exports = {};", "```", "", "Run Jest now."].join("\n");
    expect(extractCommandUses(titled, "jest").filter((u) => !u.fromProse)).toEqual([]);
  });
});

describe("comments inside code blocks (Ruff)", () => {
  // Ruff's tutorial has, inside a TOML block:
  //   # Add the `line-too-long` rule ... By default, Ruff omits rules that ...
  // which was read as the command "ruff omits".
  it("does not read a comment line as a command", () => {
    const doc = ["```toml", "# By default, Ruff omits rules that are not enabled", 'select = ["E501"]', "```"].join("\n");
    expect(extractCommandUses(doc, "ruff")).toEqual([]);
  });

  it("ignores a trailing comment's prose", () => {
    const doc = ["```sh", "ruff check .   # ruff fixes nothing here", "```"].join("\n");
    const tokens = extractCommandUses(doc, "ruff").map((u) => u.token);
    expect(tokens).toContain("ruff check");
    expect(tokens).not.toContain("ruff fixes");
  });

  it("does not treat # as a root prompt", () => {
    // Dropping # as a prompt marker loses a command on a root-prompt line,
    // which is a false negative. Reading a comment as a command is a false
    // finding. The second is the costlier direction.
    expect(extractCommandUses("```sh\n# install the thing first\n```", "ruff")).toEqual([]);
  });

  it("still honours $ and > prompts", () => {
    expect(extractCommandUses("```sh\n$ ruff check .\n```", "ruff").map((u) => u.token)).toEqual([
      "ruff check",
    ]);
  });
});

describe("runners (Prettier)", () => {
  // Prettier's install guide says `npx prettier . --check`, and taking the
  // first bare token made --check a claim about npx.
  it("credits the program a runner runs", () => {
    const uses = extractFlagUses("```sh\nnpx prettier . --check\n```", "prettier", ["prettier"]);
    expect(uses.find((u) => u.token === "--check")?.attributedTo).toBe("prettier");
  });

  it.each([
    ["npx prettier --check", "prettier"],
    ["pnpm dlx ruff check --fix", "dlx"],
    ["sudo docker run --rm thing", "run"],
    ["uvx ruff check --fix", "ruff"],
    ["FORCE_COLOR=1 npx prettier --write", "prettier"],
    ["$ npx eslint --fix", "eslint"],
  ])("steps over the runner in %s", (line, expected) => {
    const uses = extractFlagUses(`\`\`\`sh\n${line}\n\`\`\``, "x", [expected]);
    expect(uses[0]?.attributedTo).toBe(expected);
  });

  it("keeps a runner as the command when it is the whole invocation", () => {
    // `npm --global` is a claim about npm.
    const uses = extractFlagUses("```sh\nnpm --global\n```", "x", ["npm"]);
    expect(uses.find((u) => u.token === "--global")?.attributedTo).toBe("npm");
  });
});

describe("restrictions on combining options (Prettier)", () => {
  // "Note that `--write` cannot be used with `--debug-check`." was read as a
  // denial of --write, so a guide telling people to use --write — the flag's
  // entire purpose — was reported as contradicting the reference.
  it("does not read a combination restriction as a denial", () => {
    expect(
      presentsAsUsable("Note that `--write` cannot be used with `--debug-check`.", "--write"),
    ).toBe(true);
  });

  it.each([
    "`--a` cannot be used with `--b`.",
    "`--a` may not be combined with `--b`.",
    "`--a` must not be specified together with `--b`.",
    "`--a` cannot be used at the same time as `--b`.",
  ])("tolerates %s", (sentence) => {
    expect(presentsAsUsable(sentence, "--a")).toBe(true);
  });

  it("NEGATIVE CONTROL: a real denial is still a denial", () => {
    expect(presentsAsUsable("There is no `--a` flag.", "--a")).toBe(false);
    expect(presentsAsUsable("`--a` was removed in 2.0.", "--a")).toBe(false);
    expect(presentsAsUsable("`--a` cannot be used any more.", "--a")).toBe(false);
  });

  it('no longer treats "without" as a denial', () => {
    // Ruff: "without `force-exclude` enabled, `ruff check /path/to/file.py`
    // ..." denied nothing and was read as denying the command. And "run
    // without --verbose" never meant the flag did not exist.
    expect(
      presentsAsUsable("without `force-exclude` enabled, `ruff check /path/x.py` will lint it", "ruff check"),
    ).toBe(true);
    expect(presentsAsUsable("Run it without `--verbose` for quieter output.", "--verbose")).toBe(true);
  });
});

describe("inferring the tool from real documentation", () => {
  // The first version took the most frequent token in command position
  // across every fenced block. Real docs are full of JSON and TOML, so it
  // elected `off` for ESLint, `exclude` for Ruff, `false` for Vitest and
  // `the` for uv — and with `the` as the tool, "the project" and "the
  // command" were reported as fabricated commands.
  it("ignores configuration blocks", () => {
    const doc = [
      "```json",
      '{ "rules": { "semi": "off", "quotes": "off", "eqeqeq": "off" } }',
      "```",
      "```sh",
      "eslint --fix .",
      "```",
    ].join("\n");
    expect(inferToolCommand(doc).tool).toBe("eslint");
  });

  it.each(["off", "false", "true", "the", "exclude", "select", "error", "default"])(
    "never elects %s",
    (word) => {
      const doc = ["```toml", `${word} = 1`, `x = "${word}"`, "```", "```sh", `${word} thing`, "```"].join("\n");
      expect(inferToolCommand(doc).tool).not.toBe(word);
    },
  );

  it("prefers a token that is followed by a flag", () => {
    const doc = ["```sh", "mytool --fix .", "othertool", "othertool", "```"].join("\n");
    expect(inferToolCommand(doc).tool).toBe("mytool");
  });

  it("reports no tool rather than inventing one", () => {
    // Vitest's cli-generated.md is an options table with no shell examples.
    // Returning nothing disables the command checks, which is right.
    const table = ["| Option | Description |", "| --- | --- |", "| `--run` | run once |"].join("\n");
    const got = inferToolCommand(table);
    expect(got.tool).toBe("");
    expect(got.note).toMatch(/No command could be identified/);
  });
});

describe("defaults stated in prose (Jest, Ruff)", () => {
  // Jest's reference says "the default is ..." and Ruff's says "the
  // default", and a bare-word fallback elected "the" as the subject — which
  // then held two values and was reported as a contradiction.
  it("does not take an article as the subject of a default", () => {
    const got = collectDefaults("By default, the default is to run all tests.");
    expect(got.has("the")).toBe(false);
    expect(got.has("default")).toBe(false);
  });

  it("still reads a flag's default", () => {
    expect([...(collectDefaults("    --port <n>   Listen port. Default: 8080.").get("--port") ?? [])]).toEqual(["8080"]);
  });

  it("still reads a dotted or underscored configuration key's default", () => {
    expect(collectDefaults("max_inflight defaults to 256").get("max_inflight")).toBeDefined();
    expect(collectDefaults("server.port defaults to 3000").get("server.port")).toBeDefined();
  });
});

describe("judging only what the reference can judge", () => {
  const reference = [
    "# mytool 1.0",
    "",
    "```sh",
    "mytool build --out dist",
    "```",
    "",
    "## Flags",
    "",
    "    --out <dir>   Output directory. Default: dist",
  ].join("\n");

  it("says nothing about a third-party command's flags (ESLint, Prettier)", () => {
    // `npm install mytool --save-dev` is a claim about npm. A reference for
    // mytool says nothing about npm's flags, so reporting --save-dev as
    // absent from it is true and useless. Seven of these across six
    // projects.
    const draft = "```sh\nnpm install mytool --save-dev\nmytool build --out dist\n```";
    const findings = check(reference, draft).findings.map((f) => f.token);
    expect(findings).not.toContain("--save-dev");
  });

  it("does not call a prose-sighted command invented (Jest, uv)", () => {
    // "run Jest directly" is a sentence. A word list cannot keep up with
    // English, so prose may confirm a command the reference discusses and
    // may not declare one invented.
    const draft = "Run mytool directly from the CLI for integration testing.";
    const findings = check(reference, draft).findings.filter((f) => f.kind === "fabricated");
    expect(findings).toEqual([]);
  });

  it("NEGATIVE CONTROL: still catches an invented flag on the documented tool", () => {
    const draft = "```sh\nmytool build --out dist --turbo-mode\n```";
    const findings = check(reference, draft).findings.map((f) => f.token);
    expect(findings).toContain("--turbo-mode");
  });

  it("NEGATIVE CONTROL: still catches an invented subcommand in code", () => {
    const draft = "```sh\nmytool optimise --out dist\n```";
    const findings = check(reference, draft).findings.map((f) => f.token);
    expect(findings).toContain("mytool optimise");
  });
});

describe("real reference pages are incomplete, and that is not a contradiction", () => {
  // The honest result of Phase 4: after the fixes, the six pairs produced no
  // confirmed findings and six uncertain ones, and every uncertain one was a
  // real feature that the particular reference page did not happen to
  // document. That is what the uncertain tier is for, and reporting it as a
  // contradiction would have been wrong six times out of six.
  it("reports a feature missing from the reference as uncertain, never confirmed", () => {
    const reference = "# tool\n\n```sh\ntool run --fast\n```";
    const draft = "```sh\ntool run --fast --slow\n```";
    const findings = check(reference, draft).findings.filter((f) => f.level === "finding");
    expect(findings).toHaveLength(1);
    expect(findings[0].token).toBe("--slow");
    expect(findings[0].confidence).toBe("uncertain");
  });

  it("reserves confirmed for what the reference actually contradicts", () => {
    const reference = "# tool\n\n```sh\ntool run --fast\n```\n\nThere is no `--slow` flag.";
    const draft = "```sh\ntool run --slow\n```";
    const findings = check(reference, draft).findings.filter((f) => f.level === "finding");
    expect(findings[0].confidence).toBe("confirmed");
    expect(findings[0].referenceEvidence).toMatch(/no `--slow`/);
  });
});
