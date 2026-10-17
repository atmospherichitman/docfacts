/**
 * The docverify CLI, tested against a correct draft and an erroneous one.
 *
 * The correct draft is the harder test and the one that decides whether the
 * tool is worth shipping. Anyone can flag everything.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check, renderReport, LIMITATIONS } from "../src/check.js";
import { collectDefaults, inferReference, inferToolCommand } from "../src/infer.js";
import { parseArgs, run } from "../src/docverify.js";
import { BEACONDB_REFERENCE, CORRECT_DRAFT, ERRONEOUS_DRAFT, EXPECTED_ERRORS } from "./fixture.js";

const problems = (text: string, draft = CORRECT_DRAFT) =>
  check(text, draft).findings.filter((f) => f.level === "finding");

let dir: string;
let refFile: string;
let draftFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "docverify-"));
  refFile = path.join(dir, "reference.md");
  draftFile = path.join(dir, "draft.md");
  fs.writeFileSync(refFile, BEACONDB_REFERENCE, "utf8");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const capture = (argv: string[]) => {
  let out = "";
  const code = run(argv, (s) => {
    out += s;
  });
  return { code, out };
};

// ── reading the reference ────────────────────────────────────────

describe("inferring what the reference declares", () => {
  const inferred = inferReference(BEACONDB_REFERENCE);

  it("identifies the documented tool", () => {
    expect(inferred.toolCommand).toBe("beacondb");
    expect(inferToolCommand(BEACONDB_REFERENCE).tool).toBe("beacondb");
  });

  const statusOf = (token: string, kind = "flag") =>
    inferred.features.find((f) => f.token === token && f.kind === kind)?.status;

  it("reads supported flags as supported", () => {
    expect(statusOf("--config")).toBe("supported");
    expect(statusOf("--port")).toBe("supported");
    expect(statusOf("--workers")).toBe("supported");
  });

  it("reads a removed flag as unsupported", () => {
    expect(statusOf("--unsafe-fsync")).toBe("unsupported");
  });

  it("reads a flag that will be removed as deprecated, not gone", () => {
    // "deprecated and will be removed in 4.0" contains "removed in". It
    // still works today, and calling it unsupported would report correct use
    // of a working flag.
    expect(statusOf("--legacy-index")).toBe("deprecated");
  });

  it("attributes another command's flags to that command", () => {
    const system = inferred.features.find((f) => f.token === "--system");
    expect(system?.command).toBe("useradd");
    expect(system?.status).toBe("contextual");
  });

  it("reads the commands, and the one that does not exist", () => {
    expect(statusOf("beacondb serve", "command")).toBe("supported");
    expect(statusOf("beacondb compact", "command")).toBe("supported");
    expect(statusOf("beacondb reset", "command")).toBe("unsupported");
  });

  it("reads an ignored variable as unsupported without condemning the flag beside it", () => {
    // "BEACONDB_PORT is ignored in 3.2; use --port instead." One clause
    // denies the variable. The other recommends the flag.
    expect(statusOf("BEACONDB_PORT", "env")).toBe("unsupported");
    expect(statusOf("--port")).toBe("supported");
  });

  it("reads the exit codes and endpoints", () => {
    expect(statusOf("20", "exit_code")).toBe("supported");
    expect(statusOf("21", "exit_code")).toBe("supported");
    expect(statusOf("GET /health", "endpoint")).toBe("supported");
    expect(statusOf("POST /snapshot", "endpoint")).toBe("supported");
  });

  it("does not treat shell variables as the tool's interface", () => {
    expect(inferred.features.some((f) => f.token === "PATH")).toBe(false);
    expect(inferred.features.some((f) => f.token === "HOME")).toBe(false);
  });

  it("collects the defaults the reference states", () => {
    expect(inferred.defaults.get("--port")).toBe("8080");
    expect(inferred.defaults.get("--workers")).toBe("4");
    expect(inferred.defaults.get("BEACONDB_DATA_DIR")).toBe("/var/lib/beacondb");
  });

  it("reports an unidentifiable tool rather than guessing silently", () => {
    const prose = inferReference("This document contains no commands at all, only sentences.");
    expect(prose.toolCommand).toBe("");
    expect(prose.notes.join(" ")).toMatch(/No command could be identified/);
  });

  it("accepts an explicit tool name", () => {
    expect(inferReference(BEACONDB_REFERENCE, { toolCommand: "other" }).toolCommand).toBe("other");
  });
});

describe("collecting defaults", () => {
  it("takes the subject before the word and the value after it", () => {
    const got = collectDefaults("    --port <n>    Listen port. Default: 8080.");
    expect([...(got.get("--port") ?? [])]).toEqual(["8080"]);
  });

  it("keeps both values when a document states two", () => {
    const got = collectDefaults(["--workers defaults to 8", "the --workers default is 4"].join("\n"));
    expect([...(got.get("--workers") ?? [])].sort()).toEqual(["4", "8"]);
  });

  it("ignores a line where the value is a filler word", () => {
    expect(collectDefaults("--port uses the default of the platform").get("--port")).toBeUndefined();
  });
});

// ── the correct draft ────────────────────────────────────────────

describe("a correct draft", () => {
  it("produces no findings at all", () => {
    const found = problems(BEACONDB_REFERENCE);
    expect(found.map((f) => `${f.kind}:${f.token}`)).toEqual([]);
  });

  it("exits 0", () => {
    fs.writeFileSync(draftFile, CORRECT_DRAFT, "utf8");
    expect(capture(["--reference", refFile, "--draft", draftFile]).code).toBe(0);
  });

  it("confirms the claims it checked rather than staying silent", () => {
    const result = check(BEACONDB_REFERENCE, CORRECT_DRAFT);
    expect(result.confirmed).toBeGreaterThan(5);
  });

  it("does not report the deprecated flag, because the draft says it is deprecated", () => {
    const result = check(BEACONDB_REFERENCE, CORRECT_DRAFT);
    expect(result.findings.filter((f) => f.token === "--legacy-index")).toEqual([]);
  });

  it("does not report the reference's own denials repeated back", () => {
    // The correct draft says "There is no --unsafe-fsync flag in 3.2" and
    // "There is also no beacondb reset command". Saying so is useful and
    // must not read as using them.
    const result = check(BEACONDB_REFERENCE, CORRECT_DRAFT);
    expect(result.findings.filter((f) => f.token === "--unsafe-fsync")).toEqual([]);
    expect(result.findings.filter((f) => f.token === "beacondb reset")).toEqual([]);
  });

  it("does not report useradd's flags against beacondb", () => {
    const result = check(BEACONDB_REFERENCE, CORRECT_DRAFT);
    expect(result.findings.filter((f) => f.token === "--system" || f.token === "--shell")).toEqual([]);
  });
});

// ── the erroneous draft ──────────────────────────────────────────

describe("a draft with genuine errors", () => {
  const found = check(BEACONDB_REFERENCE, ERRONEOUS_DRAFT).findings;
  const ids = found.map((f) => `${f.kind}:${f.token}`);

  it.each(EXPECTED_ERRORS.map((e) => [`${e.kind}:${e.token}`, e.why] as const))(
    "finds %s — %s",
    (id) => {
      expect(ids).toContain(id);
    },
  );

  it("exits 1", () => {
    fs.writeFileSync(draftFile, ERRONEOUS_DRAFT, "utf8");
    expect(capture(["--reference", refFile, "--draft", draftFile]).code).toBe(1);
  });

  it("quotes the draft's own words as evidence for each finding", () => {
    for (const f of found.filter((x) => x.kind === "fabricated")) {
      expect(f.draftEvidence, f.token).toBeTruthy();
    }
  });

  it("quotes the reference for anything the reference is what makes wrong", () => {
    for (const f of found.filter((x) => x.kind === "unsupported_used")) {
      expect(f.referenceEvidence, f.token).toBeTruthy();
    }
  });

  it("separates an invention from a feature the reference denies", () => {
    // They need different fixes: remove the first, correct the claim about
    // the second. Collapsing them into "unsupported" loses that.
    const verbose = found.find((f) => f.token === "--verbose");
    const fsync = found.find((f) => f.token === "--unsafe-fsync");
    expect(verbose?.kind).toBe("fabricated");
    expect(fsync?.kind).toBe("unsupported_used");
  });
});

// ── the report ───────────────────────────────────────────────────

describe("the report", () => {
  it("never claims a clean result means the document is correct", () => {
    const report = renderReport(check(BEACONDB_REFERENCE, CORRECT_DRAFT), {
      reference: "r.md",
      draft: "d.md",
    });
    expect(report).toMatch(/does NOT mean the document is correct/);
    expect(report).toMatch(/Whether anything important is MISSING is not checked/);
    expect(report).not.toMatch(/guarantee[sd]? (?:that )?(?:the )?(?:document|draft) is correct/i);
  });

  it("prints the limitations even when there is nothing to report", () => {
    const report = renderReport(check(BEACONDB_REFERENCE, CORRECT_DRAFT), {
      reference: "r.md",
      draft: "d.md",
    });
    for (const l of LIMITATIONS) expect(report).toContain(l.slice(0, 50));
  });

  it("shows how the reference was read, so a finding can be argued with", () => {
    const report = renderReport(check(BEACONDB_REFERENCE, ERRONEOUS_DRAFT), {
      reference: "r.md",
      draft: "d.md",
    });
    expect(report).toContain("What the reference declares");
    expect(report).toMatch(/unsupported\s+--unsafe-fsync/);
    expect(report).toMatch(/deprecated\s+--legacy-index/);
  });

  it("says nothing is executed", () => {
    const report = renderReport(check(BEACONDB_REFERENCE, CORRECT_DRAFT), {
      reference: "r.md",
      draft: "d.md",
    });
    expect(report).toMatch(/never run/);
  });
});

// ── the command line ────────────────────────────────────────────

describe("the command line", () => {
  it("parses both spellings of each option", () => {
    expect(parseArgs(["-r", "a", "-d", "b"])).toMatchObject({ reference: "a", draft: "b" });
    expect(parseArgs(["--reference", "a", "--draft", "b", "--tool", "t", "--json"])).toMatchObject({
      reference: "a",
      draft: "b",
      tool: "t",
      json: true,
    });
  });

  it("refuses an option without a value", () => {
    expect(() => parseArgs(["--reference"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--reference", "--draft"])).toThrow(/needs a value/);
  });

  it("refuses an unknown option", () => {
    expect(() => parseArgs(["--wat"])).toThrow(/unknown option/);
  });

  it("prints usage and exits 2 with no arguments", () => {
    const { code, out } = capture([]);
    expect(code).toBe(2);
    expect(out).toMatch(/Usage/);
  });

  it("exits 0 for --help", () => {
    expect(capture(["--help"]).code).toBe(0);
  });

  it("exits 2 when a file is missing, naming it", () => {
    const { code, out } = capture(["-r", refFile, "-d", path.join(dir, "nope.md")]);
    expect(code).toBe(2);
    expect(out).toMatch(/does not exist/);
  });

  it("exits 2 on an empty draft rather than reporting it as clean", () => {
    fs.writeFileSync(draftFile, "   \n\n  ", "utf8");
    const { code, out } = capture(["-r", refFile, "-d", draftFile]);
    expect(code).toBe(2);
    expect(out).toMatch(/empty|no text/);
  });

  it("exits 2 on a directory", () => {
    expect(capture(["-r", refFile, "-d", dir]).code).toBe(2);
  });

  it("emits json carrying the limitations too", () => {
    fs.writeFileSync(draftFile, ERRONEOUS_DRAFT, "utf8");
    const { code, out } = capture(["-r", refFile, "-d", draftFile, "--json"]);
    expect(code).toBe(1);
    const parsed = JSON.parse(out);
    expect(parsed.tool).toBe("beacondb");
    expect(parsed.findings.length).toBeGreaterThan(5);
    // A machine consumer must not be able to present clean as correct either.
    expect(parsed.cleanResultIsNotAGuaranteeOfCorrectness).toBe(true);
    expect(parsed.limitations.length).toBeGreaterThan(3);
  });

  it("survives a reference with nothing checkable in it", () => {
    fs.writeFileSync(refFile, "Some prose with no interface in it whatsoever.", "utf8");
    fs.writeFileSync(draftFile, "More prose, equally devoid of commands.", "utf8");
    const { code, out } = capture(["-r", refFile, "-d", draftFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/nothing checkable was found/);
  });
});

// ── the two promises that are not about accuracy ─────────────────

describe("it never executes and never transmits", () => {
  /** Every project source file the CLI pulls in, followed transitively. */
  const closure = (entry: string, seen = new Set<string>()): Set<string> => {
    const file = path.resolve(entry);
    if (seen.has(file) || !fs.existsSync(file)) return seen;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = path.resolve(path.dirname(file), m[1].replace(/\.js$/, ".ts"));
      closure(target, seen);
    }
    return seen;
  };

  const files = [...closure("src/docverify.ts")];

  /**
   * Code only, comments removed.
   *
   * The first version of this test failed on `docverify.ts` because its own
   * doc comment promises not to import `child_process`, and the test matched
   * the promise. Funny, and a real lesson: assert against what runs.
   */
  const codeOf = (file: string) =>
    fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("pulls in the modules it needs and nothing exotic", () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it("imports nothing that can execute a process", () => {
    for (const file of files) {
      const text = codeOf(file);
      expect(text, file).not.toMatch(/child_process|node:child_process/);
      expect(text, file).not.toMatch(/\bexecFile\b|\bspawn\b|\bexecSync\b|\bspawnSync\b/);
      expect(text, file).not.toMatch(/\beval\(|new Function\(/);
    }
  });

  it("imports nothing that can reach the network", () => {
    // The documents are somebody's unreleased specification. "It only sends a
    // hash" is the sort of claim that turns out to be untrue later, so the
    // code is kept incapable rather than well-behaved.
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bfetch\(|node:https?|node:net|node:dgram|XMLHttpRequest/);
      expect(text, file).not.toMatch(/\baxios\b|\bgot\b\(|node-fetch|undici/);
    }
  });

  it("writes only to the stream the caller gave it", () => {
    // `run` takes a writer, so a test can capture everything it emits. No
    // file is written anywhere by a check.
    const before = fs.readdirSync(dir).sort();
    fs.writeFileSync(draftFile, ERRONEOUS_DRAFT, "utf8");
    capture(["-r", refFile, "-d", draftFile]);
    expect(fs.readdirSync(dir).sort()).toEqual([...before, "draft.md"].sort());
  });
});
