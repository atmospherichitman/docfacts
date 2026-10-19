/**
 * The tutorial, checked against the tool it is teaching.
 *
 * `docs/tutorial.md` tells a reader to create two documents, run one
 * command, and see a particular report. If the checker's wording or
 * behaviour changes, the tutorial becomes a confident, plausible,
 * out-of-date document describing a command that no longer does that — the
 * exact failure this project exists to catch. It should not be the one it
 * ships.
 *
 * So the documents are extracted from the tutorial itself and run through
 * the checker. No network: this uses the source in this repository rather
 * than the published package, so it is fast enough to run on every change.
 * The published version was verified separately, by hand, against
 * docfacts@0.1.0.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { check } from "../src/check.js";

const TUTORIAL = ["docs/tutorial.md", "packages/docfacts/docs/tutorial.md"].find((p) =>
  fs.existsSync(p),
);

let reference: string;
let draftBroken: string;
let draftFixed: string;

beforeAll(() => {
  expect(TUTORIAL, "docs/tutorial.md not found").toBeDefined();
  const text = fs.readFileSync(TUTORIAL as string, "utf-8");

  // The documents a reader is told to create are the ````markdown blocks.
  // Four-tick fences, because the documents themselves contain fenced code.
  const documents = [...text.matchAll(/````markdown\n([\s\S]*?)\n````/g)].map((m) => m[1]);
  expect(documents, "expected a reference, a broken draft and a fixed draft").toHaveLength(3);
  [reference, draftBroken, draftFixed] = documents;
});

/** Findings only; notes are not problems. */
const findingsFor = (draft: string) =>
  check(reference, draft).findings.filter((f) => f.level === "finding");

describe("the documents the tutorial asks you to create", () => {
  it("has a reference the checker can read an interface out of", () => {
    const result = check(reference, draftFixed);
    // The tutorial shows this block and says "that is right". If the
    // reference stops parsing, every finding below it is meaningless.
    expect(result.reference.toolCommand).toBe("pagoda");
    expect(result.declared.supported).toBeGreaterThan(0);
    expect(result.declared.unsupported).toBe(2);
  });

  it("produces exactly the three findings the tutorial walks through", () => {
    const findings = findingsFor(draftBroken);
    expect(findings).toHaveLength(3);

    const byToken = new Map(findings.map((f) => [f.token, f]));
    expect([...byToken.keys()].sort()).toEqual(["--jobs", "--minify", "--watch"]);

    // Two contradicted, one merely unsupported — the distinction the
    // tutorial spends a section explaining.
    expect(byToken.get("--minify")?.kind).toBe("unsupported_used");
    expect(byToken.get("--minify")?.confidence).toBe("confirmed");
    expect(byToken.get("--watch")?.kind).toBe("unsupported_used");
    expect(byToken.get("--watch")?.confidence).toBe("confirmed");
    expect(byToken.get("--jobs")?.kind).toBe("fabricated");
    expect(byToken.get("--jobs")?.confidence).not.toBe("confirmed");
  });

  it("still misses the wrong exit code, which the tutorial says it misses", () => {
    // The tutorial's most useful section is the one admitting this: the
    // broken draft claims exit code 2, the reference lists 0 and 1, and the
    // claim is in prose rather than in a table, so it is not cross-checked.
    //
    // If this ever starts being caught, that is good news — and the
    // tutorial becomes wrong and must be updated.
    expect(draftBroken).toMatch(/exits with `0` on success and `2`/);
    const findings = findingsFor(draftBroken);
    expect(findings.some((f) => f.token === "2")).toBe(false);
  });

  it("reports nothing for the corrected draft", () => {
    expect(findingsFor(draftFixed)).toEqual([]);
  });
});

describe("what the tutorial quotes", () => {
  let text: string;
  beforeAll(() => {
    text = fs.readFileSync(TUTORIAL as string, "utf-8");
  });

  it("quotes finding text the checker actually produces", () => {
    const findings = findingsFor(draftBroken);
    for (const finding of findings) {
      expect(text, `the tutorial does not quote: ${finding.what}`).toContain(finding.what);
    }
  });

  it("quotes draft evidence verbatim rather than paraphrasing it", () => {
    // A tutorial about not inventing quotes should not invent quotes. This
    // caught a real slip: a quoted line had been shortened by hand.
    const findings = findingsFor(draftBroken);
    for (const finding of findings) {
      if (!finding.draftEvidence) continue;
      expect(text, `evidence not quoted exactly: ${finding.draftEvidence}`).toContain(
        finding.draftEvidence,
      );
    }
  });

  it("does not promise that a clean result means the document is correct", () => {
    expect(text).toMatch(/not mean the document is correct|not a signature on the document/i);
    expect(text).toMatch(/Missing content is not detected/i);
    expect(text).toMatch(/reference is taken as true/i);
  });

  it("claims no benchmark, accuracy rate or testimonial", () => {
    for (const overclaim of [
      /\b\d+(\.\d+)?%\s*(accurate|accuracy|precision|recall)/i,
      /\b(users|developers|teams) (love|trust|rely on)\b/i,
      /\bfastest\b/i,
      /\bguarantees? (that )?(your |the )?(document|docs) (is|are) correct/i,
    ]) {
      expect(text, `overclaim: ${overclaim}`).not.toMatch(overclaim);
    }
  });
});
