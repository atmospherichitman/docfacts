/**
 * The feature taxonomy, and the two things A9 got wrong.
 *
 * A9's detector treated "appears in the source material" as "supported". Two
 * consequences, one found and one pinned as a known weakness:
 *
 *  - `useradd --system` in the meshgate reference made `--system` supported,
 *    which was right, but it was right by accident: the detector could not
 *    tell whose flag it was, so `meshgate --system` would also have passed.
 *  - "There is no `--auth` flag in 0.9" made `--auth` supported, which was
 *    wrong. The specification said the opposite of what the detector read.
 *
 * These tests fix both as *behaviour*, with the positive case beside every
 * negative one, because a detector that rejects everything is as useless as
 * one that accepts everything.
 */

import { describe, it, expect } from "vitest";
import {
  acknowledgesDeprecation,
  extractCommandUses,
  normaliseEndpoint,
  buildIndex,
  extractEndpointUses,
  extractEnvUses,
  extractExitCodeUses,
  extractFlagUses,
  lookup,
  nearestHeading,
  presentsAsUsable,
  sentenceAround,
} from "../src/spec.js";
import type { FeatureIndex } from "../src/spec.js";

const INDEX: FeatureIndex = {
  toolCommand: "quilldeck",
  features: [
    { token: "--watch", kind: "flag", status: "supported", command: "quilldeck" },
    { token: "--theme", kind: "flag", status: "supported", command: "quilldeck" },
    {
      token: "--legacy-render",
      kind: "flag",
      status: "deprecated",
      command: "quilldeck",
      note: "replaced by --theme in 0.9",
    },
    {
      token: "--auth",
      kind: "flag",
      status: "unsupported",
      command: "quilldeck",
      note: "there is no --auth flag in 0.9",
    },
    { token: "--system", kind: "flag", status: "contextual", command: "useradd" },
    { token: "QUILLDECK_THEME", kind: "env", status: "supported" },
    { token: "30", kind: "exit_code", status: "supported" },
    { token: "GET /decks", kind: "endpoint", status: "supported" },
  ],
};

describe("the index", () => {
  it("looks a feature up by token and kind", () => {
    const map = buildIndex(INDEX);
    expect(lookup(map, "--watch", "flag")?.status).toBe("supported");
    expect(lookup(map, "--auth", "flag")?.status).toBe("unsupported");
    expect(lookup(map, "--nope", "flag")).toBeUndefined();
  });

  it("separates the kinds, so an exit code is not a flag", () => {
    const map = buildIndex(INDEX);
    expect(lookup(map, "30", "exit_code")?.status).toBe("supported");
    expect(lookup(map, "30", "flag")).toBeUndefined();
  });

  it("treats flags case-insensitively and environment variables not", () => {
    const map = buildIndex(INDEX);
    expect(lookup(map, "--WATCH", "flag")?.status).toBe("supported");
    // Shell variables are case-sensitive; quilldeck_theme is a different name.
    expect(lookup(map, "quilldeck_theme", "env")).toBeUndefined();
  });

  it("refuses a duplicate rather than silently preferring one entry", () => {
    expect(() =>
      buildIndex({
        toolCommand: "quilldeck",
        features: [
          { token: "--watch", kind: "flag", status: "supported" },
          { token: "--watch", kind: "flag", status: "unsupported" },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});

describe("command association", () => {
  it("attributes a flag to the command it follows", () => {
    const uses = extractFlagUses("Create the user: `useradd --system quilldeck`", "quilldeck");
    const system = uses.find((u) => u.token === "--system");
    expect(system?.attributedTo).toBe("useradd");
  });

  it("attributes the tool's own flags to the tool", () => {
    const uses = extractFlagUses("```sh\nquilldeck render --watch deck.md\n```", "quilldeck");
    expect(uses.find((u) => u.token === "--watch")?.attributedTo).toBe("quilldeck");
  });

  it("does not let a subcommand displace the binary", () => {
    const uses = extractFlagUses("```sh\nquilldeck render --theme slate deck.md\n```", "quilldeck");
    expect(uses.find((u) => u.token === "--theme")?.attributedTo).toBe("quilldeck");
  });

  it("carries the command across several flags", () => {
    const uses = extractFlagUses(
      "```sh\nuseradd --system --shell /usr/sbin/nologin quilldeck\n```",
      "quilldeck",
    );
    expect(uses.filter((u) => u.attributedTo === "useradd").map((u) => u.token).sort()).toEqual([
      "--shell",
      "--system",
    ]);
  });

  it("resets at a pipe, so the second command owns its own flags", () => {
    const uses = extractFlagUses("```sh\nquilldeck list | grep --count slate\n```", "quilldeck");
    expect(uses.find((u) => u.token === "--count")?.attributedTo).toBe("grep");
  });

  it("strips a path, so /usr/bin/quilldeck is quilldeck", () => {
    const uses = extractFlagUses("```sh\n/usr/local/bin/quilldeck --watch\n```", "quilldeck");
    expect(uses.find((u) => u.token === "--watch")?.attributedTo).toBe("quilldeck");
  });

  it("attributes a flag mentioned in bare prose to the documented tool", () => {
    // A reader seeing "pass --system" in a quilldeck guide concludes it is a
    // quilldeck flag. The verifier concludes the same, and is then able to
    // call it a misattribution.
    const uses = extractFlagUses("For a service install, pass --system when rendering.", "quilldeck");
    expect(uses.find((u) => u.token === "--system")?.attributedTo).toBe("quilldeck");
  });

  it("does not mistake a short option's value for a command", () => {
    const uses = extractFlagUses("```sh\nquilldeck -n 50 --watch\n```", "quilldeck");
    expect(uses.find((u) => u.token === "--watch")?.attributedTo).toBe("quilldeck");
  });
});

describe("the sentence a use sits in", () => {
  it("spans a wrapped line, because markdown prose wraps mid-sentence", () => {
    // The quilldeck reference wraps across exactly this warning. If the
    // sentence stopped at the line break, the negation would be lost.
    const text = "Older builds differ. There is no `--auth`\nflag in 0.9, so omit it. Next thing.";
    const got = sentenceAround(text, text.indexOf("--auth"));
    expect(got).toContain("There is no");
    expect(got).toContain("so omit it.");
    expect(got).not.toContain("Next thing");
    expect(got).not.toContain("Older builds");
  });

  it("stops at a list item, so one bullet does not borrow another's words", () => {
    const text = "- `--watch` rebuilds on change.\n- `--theme` sets the theme.";
    const got = sentenceAround(text, text.indexOf("--theme"));
    expect(got).not.toContain("--watch");
  });

  it("stops at a blank line", () => {
    const text = "Not supported.\n\nRun `--watch` to rebuild.";
    expect(sentenceAround(text, text.indexOf("--watch"))).not.toContain("Not supported");
  });
});

describe("whether a use presents an unsupported feature as usable", () => {
  it("accepts a warning that the flag does not exist", () => {
    expect(presentsAsUsable("There is no `--auth` flag in 0.9.", "--auth")).toBe(false);
  });

  it("accepts a warning phrased after the token", () => {
    expect(presentsAsUsable("`--auth` is not supported in this release.", "--auth")).toBe(false);
    expect(presentsAsUsable("`--auth` is ignored.", "--auth")).toBe(false);
  });

  it("accepts an instruction not to use it", () => {
    expect(presentsAsUsable("Do not pass `--auth`.", "--auth")).toBe(false);
    expect(presentsAsUsable("Avoid `--auth` entirely.", "--auth")).toBe(false);
  });

  it("rejects an instruction to use it", () => {
    expect(presentsAsUsable("Pass `--auth` to enable login.", "--auth")).toBe(true);
  });

  it("rejects a bare command line, whatever the prose elsewhere said", () => {
    // A flag in a paste-able block is being offered to the reader. A warning
    // in another paragraph does not retract it.
    expect(presentsAsUsable("quilldeck render --auth deck.md", "--auth")).toBe(true);
  });

  it("is not fooled by a word that merely contains a negation", () => {
    // "nologin" contains "no". Without word boundaries this read as a denial.
    expect(presentsAsUsable("useradd --shell /usr/sbin/nologin && quilldeck --auth", "--auth")).toBe(
      true,
    );
  });
});

describe("the --auth case, end to end", () => {
  const map = buildIndex(INDEX);

  it("does not authorise the flag just because the spec names it", () => {
    const uses = extractFlagUses("There is no `--auth` flag in 0.9.", "quilldeck");
    const use = uses.find((u) => u.token === "--auth")!;
    expect(lookup(map, use.token, "flag")?.status).toBe("unsupported");
    // Correct mention: the spec's own warning, repeated.
    expect(presentsAsUsable(use.context, use.token)).toBe(false);
  });

  it("catches the flag offered to an operator in a command block", () => {
    const uses = extractFlagUses("```sh\nquilldeck render --auth deck.md\n```", "quilldeck");
    const use = uses.find((u) => u.token === "--auth")!;
    expect(lookup(map, use.token, "flag")?.status).toBe("unsupported");
    expect(presentsAsUsable(use.context, use.token)).toBe(true);
  });

  it("records both uses when a document warns and then uses it anyway", () => {
    // The dangerous shape: a correct paragraph followed by a wrong example.
    // Keeping only the first use would let the warning mask the failure.
    const text = [
      "There is no `--auth` flag in 0.9.",
      "```sh",
      "quilldeck render --auth deck.md",
      "```",
    ].join("\n\n");
    const uses = extractFlagUses(text, "quilldeck").filter((u) => u.token === "--auth");
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(uses.some((u) => presentsAsUsable(u.context, u.token))).toBe(true);
  });
});

describe("deprecation", () => {
  it("is acknowledged when the document says so near the use", () => {
    expect(
      acknowledgesDeprecation("`--legacy-render` is deprecated; use `--theme`.", "--legacy-render"),
    ).toBe(true);
  });

  it("is not acknowledged by silence", () => {
    expect(acknowledgesDeprecation("Run `--legacy-render` for the old output.", "--legacy-render")).toBe(
      false,
    );
  });
});

describe("the other extractors", () => {
  it("finds environment variables in the tool's namespace only", () => {
    const uses = extractEnvUses("Set QUILLDECK_THEME and check PATH and HOME.", ["QUILLDECK_THEME"]);
    expect(uses.map((u) => u.token)).toEqual(["QUILLDECK_THEME"]);
  });

  it("finds an invented variable in the namespace", () => {
    const uses = extractEnvUses("Set QUILLDECK_WORKERS to 4.", ["QUILLDECK_THEME"]);
    expect(uses.map((u) => u.token)).toEqual(["QUILLDECK_WORKERS"]);
  });

  it("finds exit codes asserted as exit codes", () => {
    const text = [
      "## Exit codes",
      "A bad deck exits 30.",
      "| `31` | parse failure |",
      "- `32`: write failure",
    ].join("\n");
    expect(extractExitCodeUses(text).map((u) => u.token).sort()).toEqual(["30", "31", "32"]);
  });

  it("does not read every number in the text as an exit code", () => {
    expect(extractExitCodeUses("quilldeck 0.9 renders 200 slides in 4 seconds.")).toEqual([]);
  });

  it("collapses a concrete path id to a placeholder", () => {
    expect(normaliseEndpoint("GET /decks/12345")).toBe("GET /decks/{id}");
    expect(normaliseEndpoint("GET /decks/{deckId}")).toBe("GET /decks/{id}");
    expect(normaliseEndpoint("get /Decks")).toBe("GET /decks");
    expect(normaliseEndpoint("POST /decks/7f3a9c2e1b4d/render")).toBe("POST /decks/{id}/render");
  });

  it("does not collapse the path itself", () => {
    expect(normaliseEndpoint("GET /slides/12345")).not.toBe("GET /decks/{id}");
  });

  it("finds endpoints as method and path", () => {
    const uses = extractEndpointUses("Call GET /decks, then POST /decks/{id}/render.");
    expect(uses.map((u) => u.token)).toEqual(["GET /decks", "POST /decks/{id}/render"]);
  });
});

describe("subcommands", () => {
  it("finds a subcommand in a command block", () => {
    const uses = extractCommandUses("```sh\nquilldeck render deck.md\n```", "quilldeck");
    expect(uses.map((u) => u.token)).toEqual(["quilldeck render"]);
  });

  it("finds one in inline code", () => {
    const uses = extractCommandUses("Run `quilldeck list` to see them.", "quilldeck");
    expect(uses.map((u) => u.token)).toEqual(["quilldeck list"]);
  });

  it("finds one named in prose as an instruction", () => {
    expect(extractCommandUses("Then run quilldeck publish to upload.", "quilldeck").map((u) => u.token)).toEqual(
      ["quilldeck publish"],
    );
    expect(
      extractCommandUses("The quilldeck doctor command checks the install.", "quilldeck").map((u) => u.token),
    ).toEqual(["quilldeck doctor"]);
  });

  it("does not read an ordinary sentence as an invocation", () => {
    // "quilldeck exits 30" is prose. Reporting `quilldeck exits` as a
    // fabricated command would reject a correct document.
    for (const text of [
      "quilldeck exits 30 on a parse failure.",
      "quilldeck is a renderer.",
      "quilldeck requires Node 20.",
      "quilldeck version 0.9 is current.",
    ]) {
      expect(extractCommandUses(text, "quilldeck")).toEqual([]);
    }
  });

  it("does not read a flag as a subcommand", () => {
    expect(extractCommandUses("```sh\nquilldeck --watch deck.md\n```", "quilldeck")).toEqual([]);
  });

  it("ignores the tool named as an argument to something else", () => {
    expect(extractCommandUses("```sh\nuseradd --system quilldeck\n```", "quilldeck")).toEqual([]);
  });
});

describe("a bare number is only an exit code where the section says so", () => {
  it("reads a table under an exit-code heading", () => {
    const text = "## Exit codes\n\n| `41` | already migrated |\n| `42` | corrupt |";
    expect(extractExitCodeUses(text).map((u) => u.token).sort()).toEqual(["41", "42"]);
  });

  it("does not read a table of flag values as exit codes", () => {
    // "--from 3" is an index version. A9's heuristic would have called 3 an
    // undocumented exit code and rejected a correct document.
    const text = "## Flags\n\n| `3` | source index version |\n| `4` | shards |";
    expect(extractExitCodeUses(text)).toEqual([]);
  });

  it("still reads an exit code stated outright in any section", () => {
    const text = "## Flags\n\n`--dry-run` exits 0 and changes nothing.";
    expect(extractExitCodeUses(text).map((u) => u.token)).toEqual(["0"]);
  });

  it("reports the heading a position sits under", () => {
    const text = "# Top\n\nbefore\n\n## Exit codes\n\nafter";
    expect(nearestHeading(text, text.indexOf("before"))).toBe("Top");
    expect(nearestHeading(text, text.indexOf("after"))).toBe("Exit codes");
    expect(nearestHeading("no headings here", 5)).toBe("");
  });
});

describe("a flag in prose belongs to the command the sentence names", () => {
  it("credits another command named before the flag", () => {
    // "run systemctl enable --now quilldeck" is a claim about systemctl.
    // Blaming quilldeck for it rejects a correct document.
    const uses = extractFlagUses("Enable it: systemctl enable --now quilldeck.", "quilldeck", [
      "systemctl",
    ]);
    expect(uses.find((u) => u.token === "--now")?.attributedTo).toBe("systemctl");
  });

  it("is not fooled by the tool's own name used as an argument", () => {
    // In `journalctl -u quilldeck --since today` the tool is the argument.
    const uses = extractFlagUses("Check journalctl -u quilldeck --since today.", "quilldeck", [
      "journalctl",
    ]);
    expect(uses.find((u) => u.token === "--since")?.attributedTo).toBe("journalctl");
  });

  it("falls back to the documented tool when no known command is named", () => {
    const uses = extractFlagUses("Pass --system when rendering.", "quilldeck", ["systemctl"]);
    expect(uses.find((u) => u.token === "--system")?.attributedTo).toBe("quilldeck");
  });

  it("does not credit an ordinary word that happens to precede the flag", () => {
    const uses = extractFlagUses("Please always pass --watch here.", "quilldeck", ["systemctl"]);
    expect(uses.find((u) => u.token === "--watch")?.attributedTo).toBe("quilldeck");
  });
});

describe("DEFECT A10-1: natural phrasings of a removal were read as usable", () => {
  // Found in the live run. The hexwell document said, correctly:
  //   "The `--flatten` flag has been removed, as nested fields are now
  //    always flattened."
  // and the gate reported it as presenting --flatten as usable. Two causes,
  // both in presentsAsUsable:
  //   1. the post-token list had "was removed" but not "has been removed";
  //   2. the window was [^.], so "e.g." and "4.0" truncated it and lost the
  //      negation that was sitting right there.
  // The context is already scoped to one sentence, so the period restriction
  // was belt-and-braces that only ever cost accuracy.

  it("reads 'has been removed' as a removal", () => {
    expect(
      presentsAsUsable("The `--flatten` flag has been removed, as nested fields are now always flattened.", "--flatten"),
    ).toBe(false);
  });

  it("reads the other natural phrasings as removals", () => {
    for (const sentence of [
      "`--flatten` have been removed in 4.0.",
      "`--flatten` was removed in 4.0.",
      "`--flatten` is no longer available.",
      "`--flatten` no longer exists.",
      "Passing `--flatten` is an error.",
      "`--flatten` must not be used.",
      "`--flatten` is gone.",
    ]) {
      expect(presentsAsUsable(sentence, "--flatten"), sentence).toBe(false);
    }
  });

  it("is not defeated by an abbreviation between the negation and the token", () => {
    // The live document's exit-code table read:
    //   "- `42`: The index is unreadable, or a removed command (e.g.,
    //    `hexwell make`) was used."
    // "removed" is right there; "e.g." broke the window.
    expect(
      presentsAsUsable("The index is unreadable, or a removed command (e.g., `hexwell make`) was used.", "hexwell make"),
    ).toBe(false);
    expect(
      presentsAsUsable("Removed in 4.0: the `--flatten` flag, i.e. nothing to pass.", "--flatten"),
    ).toBe(false);
  });

  it("NEGATIVE CONTROL: still catches a document that offers the flag", () => {
    // The whole fix is worthless if it just accepts more. These must stay
    // caught, or the gate has been widened rather than corrected.
    for (const sentence of [
      "Pass `--flatten` to flatten nested fields.",
      "Use `--flatten` when the input has nested objects.",
      "Run `hexwell make --flatten index.jsonl` to build.",
      "hexwell migrate --flatten --from 3",
    ]) {
      expect(presentsAsUsable(sentence, "--flatten"), sentence).toBe(true);
    }
    expect(presentsAsUsable("Run `hexwell make` to build the index.", "hexwell make")).toBe(true);
  });

  it("NEGATIVE CONTROL: a removal in a different sentence does not excuse a use", () => {
    // Sentence scoping is what keeps the wider window honest.
    expect(presentsAsUsable("Pass `--flatten` to flatten fields.", "--flatten")).toBe(true);
  });
});

describe("DEFECT A10-3: every 5xx status was invisible", () => {
  // Found by a negative control, in the permissive direction. The table and
  // list heuristics capped a number at 255, which is right for a process
  // exit code and wrong for an HTTP status: a fabricated 503 planted in an
  // API reference's own status-code section passed the gate. A document
  // inventing 5xx behaviour would have shipped.

  it("reads a 5xx status under a status heading", () => {
    const text = "## Status codes\n\n- `503`: The service is draining.";
    expect(extractExitCodeUses(text).map((u) => u.token)).toEqual(["503"]);
  });

  it("reads the whole HTTP range there", () => {
    const text = [
      "## Status codes",
      "| `200` | ok |",
      "| `404` | missing |",
      "| `503` | draining |",
    ].join("\n");
    expect(extractExitCodeUses(text).map((u) => u.token).sort()).toEqual(["200", "404", "503"]);
  });

  it("keeps the exit-code range where the heading is about exit codes", () => {
    // 0-255 is the process range, and a 503 under "Exit codes" is not one.
    const text = "## Exit codes\n\n| `42` | corrupt |\n| `503` | not an exit code |";
    expect(extractExitCodeUses(text).map((u) => u.token)).toEqual(["42"]);
  });

  it("NEGATIVE CONTROL: still ignores a table of flag values", () => {
    // The reason the section scoping exists at all. This must not regress.
    const text = "## Flags\n\n| `3` | source index version |\n| `503` | a size in MB |";
    expect(extractExitCodeUses(text)).toEqual([]);
  });

  it("NEGATIVE CONTROL: below 100 under a status heading is still read", () => {
    // A status section may legitimately tabulate a process code alongside.
    const text = "## Status codes\n\nA failed call exits 42.";
    expect(extractExitCodeUses(text).map((u) => u.token)).toEqual(["42"]);
  });
});
