/**
 * Compare a draft against a reference and say what the reference does not
 * support.
 *
 * This is the narrow half of the A10 gate — the half that needs nothing from
 * the customer but the two documents. Word count, essential facts and
 * safety-critical warnings are deliberately absent: they are the customer's
 * requirements, and a tool that guessed them would report invented
 * requirements in the same voice as real findings.
 *
 * What is left is the part a chat window cannot do at all: given this source
 * of truth, which claims in this document are not in it.
 */

import {
  acknowledgesDeprecation,
  buildIndex,
  extractCommandUses,
  extractEndpointUses,
  extractExitCodeUses,
  extractFlagUses,
  lookup,
  presentsAsUsable,
  sentenceAround,
} from "./spec.js";
import type { FeatureKind, FeatureUse, SpecFeature } from "./spec.js";
import { collectDefaults, inferReference, KIND_LABEL, KIND_ORDER } from "./infer.js";
import type { InferredReference } from "./infer.js";

export type FindingKind =
  | "fabricated"
  | "misattributed"
  | "unsupported_used"
  | "default_disagrees"
  | "internal_contradiction"
  | "deprecated_unacknowledged";

/**
 * How strong the evidence for a finding is.
 *
 * The distinction matters more than it looks. "The reference says this flag
 * was removed and your draft tells people to pass it" is a contradiction I
 * can show you. "This flag is not in the reference" is an *absence* — it may
 * be a fabrication, or the reference may simply not cover it, or my reading
 * of the reference may have missed it. Reporting both in the same voice
 * would overstate the second and make the first easier to dismiss.
 */
export type Confidence =
  /** The reference states the opposite, or the draft disagrees with itself. */
  | "confirmed"
  /** Something is unsupported by the reference, which is weaker than contradicted. */
  | "uncertain";

export interface Finding {
  kind: FindingKind;
  /** "finding" is a problem; "note" is worth saying and is not a problem. */
  level: "finding" | "note";
  confidence: Confidence;
  featureKind?: FeatureKind;
  token: string;
  what: string;
  /** The draft's own words. */
  draftEvidence?: string;
  /** The reference's own words, where the reference is what makes it wrong. */
  referenceEvidence?: string;
}

export interface CheckResult {
  reference: InferredReference;
  findings: Finding[];
  /** Counts of what the reference declares, by status. */
  declared: Record<string, number>;
  /** Tokens in the draft that the reference supports. Reported as checked. */
  confirmed: number;
  limitations: string[];
}

/** Things this check does not and cannot establish. Always printed. */
export const LIMITATIONS = [
  "A clean result does NOT mean the document is correct. It means nothing in it " +
    "contradicted the reference in the specific ways listed above.",
  "Whether the instructions work, whether an operator could follow them, and " +
    "whether the ordering is sane are not checked and cannot be.",
  "Whether anything important is MISSING is not checked. That depends on what you " +
    "need the document to cover, which is not in the reference.",
  "Prose quality, tone and house style are not checked.",
  "A fact stated as prose rather than as a flag, variable, code or endpoint is not " +
    "cross-checked. Numbers, version strings and dates in sentences are not verified.",
  "The reference is taken as true. If the reference is wrong, a document faithful to " +
    "it passes.",
  "Nothing here is executed. Commands in either document are read as text, never run.",
];

/** Every command the reference actually documents. */
function documentedCommands(ref: InferredReference): Set<string> {
  const known = new Set<string>(ref.toolCommand ? [ref.toolCommand.toLowerCase()] : []);
  for (const f of ref.features) {
    if (f.command) known.add(f.command.toLowerCase());
    if (f.kind === "command") known.add(f.token.split(/\s+/)[0].toLowerCase());
  }
  return known;
}

function uses(text: string, ref: InferredReference): FeatureUse[] {
  const known = documentedCommands(ref);
  return [
    ...extractFlagUses(text, ref.toolCommand, [...known]),
    ...(ref.toolCommand ? extractCommandUses(text, ref.toolCommand) : []),
    ...extractEnvUsesScoped(text, ref),
    ...extractExitCodeUses(text),
    ...extractEndpointUses(text),
  ];
}

/**
 * Environment variables in the draft, restricted to namespaces the reference
 * uses.
 *
 * Without the restriction every `FOO_BAR` in a draft — including the
 * customer's own unrelated variables — reads as an invention.
 */
function extractEnvUsesScoped(text: string, ref: InferredReference): FeatureUse[] {
  const prefixes = [
    ...new Set(ref.envNamespaces.map((n) => n.split("_")[0]).filter(Boolean)),
  ];
  if (prefixes.length === 0) return [];
  const pattern = new RegExp(`\\b(?:${prefixes.join("|")})_[A-Z0-9_]{2,40}\\b`, "g");
  const seen = new Set<string>();
  const out: FeatureUse[] = [];
  for (const m of text.matchAll(pattern)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    // The sentence, not a character window. A window starting mid-word
    // quotes "ty on spinning disks, pass --unsafe-fsync..." at the customer,
    // and evidence they cannot read is evidence they cannot check.
    out.push({ token: m[0], kind: "env", context: sentenceAround(text, m.index) });
  }
  return out;
}

export function check(referenceText: string, draftText: string, options: { toolCommand?: string } = {}): CheckResult {
  const reference = inferReference(referenceText, options);
  const index = buildIndex({ toolCommand: reference.toolCommand, features: reference.features });
  const knownCommands = documentedCommands(reference);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let confirmed = 0;

  const push = (f: Finding) => {
    const key = `${f.kind}:${f.token}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  for (const use of uses(draftText, reference)) {
    const feature: SpecFeature | undefined = lookup(index, use.token, use.kind);
    const label = KIND_LABEL[use.kind];

    if (!feature) {
      // A prose sighting is not grounds for calling something invented.
      // "Run Jest directly" is a sentence, and the word list that was
      // supposed to catch it cannot keep up with English.
      if (use.fromProse) continue;

      // Nor is a flag the draft gives to a command the reference never
      // documents. `npm install --save-dev prettier` is a claim about npm,
      // and a reference for Prettier says nothing about npm's flags — so
      // reporting `--save-dev` as absent from it is true and useless. Six
      // public projects produced seven of these.
      if (
        use.kind === "flag" &&
        use.attributedTo !== undefined &&
        !knownCommands.has(use.attributedTo.toLowerCase())
      ) {
        continue;
      }

      push({
        kind: "fabricated",
        level: "finding",
        // Absence of evidence. The reference may not cover it, or this tool
        // may have failed to read it.
        confidence: "uncertain",
        featureKind: use.kind,
        token: use.token,
        what: `the ${label} "${use.token}" does not appear in the reference`,
        draftEvidence: use.context,
      });
      continue;
    }

    if (feature.status === "unsupported") {
      if (presentsAsUsable(use.context, use.token)) {
        push({
          kind: "unsupported_used",
          level: "finding",
          // The reference says the opposite, in words that are quoted below.
          confidence: "confirmed",
          featureKind: use.kind,
          token: use.token,
          what:
            `the draft presents the ${label} "${use.token}" as usable, but the reference ` +
            `says it is not`,
          draftEvidence: use.context,
          referenceEvidence: feature.note,
        });
      }
      continue;
    }

    if (feature.status === "deprecated" && !acknowledgesDeprecation(draftText, use.token)) {
      push({
        kind: "deprecated_unacknowledged",
        level: "note",
        confidence: "confirmed",
        featureKind: use.kind,
        token: use.token,
        what: `the reference deprecates the ${label} "${use.token}" and the draft does not say so`,
        draftEvidence: use.context,
        referenceEvidence: feature.note,
      });
      continue;
    }

    // Command association, for flags only: a flag the reference gives to
    // another command is a wrong claim about this tool's interface.
    //
    // Only when the reference actually documents the command the draft
    // credits. ESLint's guide says `npm install eslint --global`, and
    // ESLint's own reference happens to use `--global` as an ESLint flag in
    // a config example — so the tool announced a contradiction between two
    // statements that are both correct. If the draft attributes a flag to a
    // command the reference never documents, there is nothing to contradict
    // and nothing to say.
    if (use.kind === "flag" && use.attributedTo !== undefined) {
      const owner = (feature.command ?? reference.toolCommand).toLowerCase();
      const attributedIsDocumented =
        knownCommands.has(use.attributedTo.toLowerCase());
      if (owner && attributedIsDocumented && use.attributedTo.toLowerCase() !== owner) {
        push({
          kind: "misattributed",
          level: "finding",
          // The reference attributes it to a different command, explicitly.
          confidence: "confirmed",
          featureKind: "flag",
          token: use.token,
          what:
            `the draft gives "${use.token}" to "${use.attributedTo}", but the reference ` +
            `gives it to "${owner}"`,
          draftEvidence: use.context,
          referenceEvidence: feature.note,
        });
        continue;
      }
    }

    confirmed += 1;
  }

  // ── defaults: against the reference, and against itself ──
  const draftDefaults = collectDefaults(draftText);
  for (const [subject, values] of draftDefaults) {
    if (values.size > 1) {
      push({
        kind: "internal_contradiction",
        level: "finding",
        // Both values are in the draft; no reading of the reference is needed.
        confidence: "confirmed",
        token: subject,
        what: `the draft gives ${subject} two different defaults: ${[...values].join(" and ")}`,
      });
      continue;
    }
    const draftValue = [...values][0];
    const referenceValue = reference.defaults.get(subject);
    if (referenceValue !== undefined && referenceValue !== draftValue) {
      push({
        kind: "default_disagrees",
        level: "finding",
        confidence: "confirmed",
        token: subject,
        what:
          `the draft says ${subject} defaults to ${draftValue}; the reference says ` +
          `${referenceValue}`,
        referenceEvidence: `the reference states ${referenceValue}`,
      });
    }
  }

  const declared: Record<string, number> = {};
  for (const f of reference.features) declared[f.status] = (declared[f.status] ?? 0) + 1;

  return { reference, findings, declared, confirmed, limitations: LIMITATIONS };
}

const indent = (text: string, by = "      ") =>
  text
    .split("\n")
    .map((l) => by + l.trim())
    .join("\n");

/** Render the report a customer reads. */
export function renderReport(
  result: CheckResult,
  files: { reference: string; draft: string },
): string {
  const problems = result.findings.filter((f) => f.level === "finding");
  const notes = result.findings.filter((f) => f.level === "note");
  const out: string[] = [];

  out.push("Document verification report");
  out.push("===========================");
  out.push("");
  out.push(`  reference : ${files.reference}`);
  out.push(`  draft     : ${files.draft}`);
  out.push(
    `  tool      : ${result.reference.toolCommand || "(none identified)"}`,
  );
  out.push("");

  // What the reference was read as saying. This is the thing to argue with
  // if a finding looks wrong, so it goes before the findings.
  out.push("What the reference declares");
  out.push("---------------------------");
  const byKind = new Map<FeatureKind, SpecFeature[]>();
  for (const f of result.reference.features) {
    byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  }
  if (result.reference.features.length === 0) {
    out.push("  nothing checkable was found in the reference");
  } else {
    for (const kind of KIND_ORDER) {
      const items = byKind.get(kind);
      if (!items?.length) continue;
      out.push(`  ${KIND_LABEL[kind]}s (${items.length})`);
      for (const status of ["supported", "unsupported", "deprecated", "contextual"] as const) {
        const matching = items.filter((i) => i.status === status);
        if (!matching.length) continue;
        const tokens = matching.map((i) => i.token).sort().join(", ");
        out.push(`      ${status.padEnd(12)} ${tokens}`);
      }
    }
  }
  out.push("");

  const confirmed = problems.filter((f) => f.confidence === "confirmed");
  const uncertain = problems.filter((f) => f.confidence === "uncertain");

  /** One finding, with whatever evidence there is for it. */
  const render = (f: Finding, n: number) => {
    out.push(`  ${n}. [${f.kind}] ${f.what}`);
    if (f.draftEvidence) {
      out.push(`     in the draft:`);
      out.push(indent(f.draftEvidence));
    }
    if (f.referenceEvidence) {
      out.push(`     in the reference:`);
      out.push(indent(f.referenceEvidence));
    }
    out.push("");
  };

  // Confirmed and unsupported are reported apart, because they are different
  // claims. One says the reference states the opposite and quotes it; the
  // other says something is absent, which may mean the draft invented it, or
  // that the reference does not cover it, or that this tool misread the
  // reference. Putting them in one list would overstate the second and make
  // the first easier to wave away.
  out.push(`Contradicted by the reference (${confirmed.length})`);
  out.push("------------------------------");
  if (confirmed.length === 0) {
    out.push("  Nothing in the draft contradicts the reference in the ways checked.");
    out.push("");
  }
  confirmed.forEach((f, i) => render(f, i + 1));

  out.push(`Not supported by the reference (${uncertain.length})`);
  out.push("-------------------------------");
  out.push(
    "  These appear in the draft and not in the reference. That may mean the draft",
  );
  out.push(
    "  invented them, or that the reference does not cover them, or that this tool",
  );
  out.push("  failed to read them. Check each against your source before acting.");
  out.push("");
  if (uncertain.length === 0) {
    out.push("  Nothing.");
    out.push("");
  }
  uncertain.forEach((f, i) => render(f, i + 1));

  if (notes.length > 0) {
    out.push(`Notes (${notes.length})`);
    out.push("---------");
    for (const n of notes) {
      out.push(`  - ${n.what}`);
      if (n.referenceEvidence) out.push(indent(n.referenceEvidence));
    }
    out.push("");
  }

  out.push("What was checked");
  out.push("----------------");
  out.push(
    `  ${result.confirmed} claim(s) in the draft matched something the reference supports.`,
  );
  out.push(
    `  The reference was read as declaring ` +
      (Object.entries(result.declared)
        .map(([status, n]) => `${n} ${status}`)
        .join(", ") || "nothing") +
      `.`,
  );
  out.push("");

  out.push("Limitations");
  out.push("-----------");
  for (const l of result.limitations) {
    out.push(`  - ${l}`);
  }
  if (result.reference.notes.length > 0) {
    out.push("");
    out.push("  For this pair of documents specifically:");
    for (const n of result.reference.notes) out.push(`  - ${n}`);
  }
  out.push("");

  return out.join("\n");
}
