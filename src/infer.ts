// DocFacts — Copyright (c) 2026 Antwon Randolph. MIT licensed; see LICENSE.
/**
 * Infer what is checkable from a reference document.
 *
 * Every A10 specification was TypeScript: I wrote the feature list and the
 * fact patterns by hand, per assignment. A customer has a changelog and a
 * config reference and no intention of writing a `QualitySpec`. So the
 * checkable part has to be read out of the text they already have.
 *
 * What survives that translation and what does not:
 *
 *  - **Survives.** Whether a flag, command, variable, exit code or endpoint
 *    appears in the reference at all; whose command a flag belongs to;
 *    whether the reference denies or deprecates it; what value it gives for
 *    a default. These are claims about the reference, and the reference is
 *    right there.
 *  - **Does not.** Which facts are *essential*, how long the document should
 *    be, which warnings are safety-critical. Those are the customer's
 *    intent, not properties of the text, and inventing them would be making
 *    up the customer's requirements and then grading against them.
 *
 * So this module infers the first set and the CLI checks only that. A tool
 * that silently graded against guessed requirements would be worse than no
 * tool, because its output would look like the same kind of finding.
 */

import {
  acknowledgesDeprecation,
  extractCommandUses,
  extractEndpointUses,
  extractExitCodeUses,
  extractFlagUses,
  presentsAsUsable,
  sentenceAround,
} from "./spec.js";
import type { FeatureKind, SpecFeature } from "./spec.js";

export interface InferredReference {
  /** The binary the reference is mostly about. */
  toolCommand: string;
  features: SpecFeature[];
  envNamespaces: string[];
  /** Subject to the value the reference gives as its default. */
  defaults: Map<string, string>;
  /** What inference could not settle. Printed in the report's limitations. */
  notes: string[];
}

/** Environment variables: SCREAMING_SNAKE with at least one underscore. */
const ENV_TOKEN = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

/**
 * Variables that belong to the shell, not to the tool being documented.
 *
 * A draft that mentions `PATH` is not inventing an interface, and reporting
 * it would be the kind of false finding that makes a checker worthless.
 */
const SHELL_VARIABLES = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "PWD",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "EDITOR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
]);

/**
 * Guess which command the reference is about.
 *
 * The most frequent token in command position inside command-shaped text.
 * Ties and absences are reported rather than resolved silently, because
 * command association is only as good as this guess: get it wrong and every
 * flag in the document is attributed to the wrong binary.
 */
export function inferToolCommand(text: string): { tool: string; note?: string } {
  const counts = new Map<string, number>();

  /**
   * Only shell-shaped code counts.
   *
   * Real documentation is full of fenced JSON, TOML and YAML, and the
   * "most frequent token in command position" rule happily elects a config
   * *value*. Run against six real projects it chose `off` for ESLint,
   * `exclude` for Ruff, `false` for Vitest and `the` for uv — and with
   * `the` as the tool, "the project" and "the command" were reported as
   * fabricated commands. Three confirmed findings, all nonsense.
   */
  const SHELL_FENCES = new Set([
    "",
    "sh",
    "bash",
    "zsh",
    "shell",
    "shellsession",
    "console",
    "terminal",
    "cmd",
    "powershell",
    "ps1",
  ]);

  /**
   * Words that are never the tool, however often they appear in command
   * position: English articles and the vocabulary of configuration files.
   */
  const NEVER_A_TOOL = new Set([
    "the", "a", "an", "and", "or", "if", "then", "else", "for", "to", "in", "on", "at",
    "of", "is", "are", "be", "it", "this", "that", "with", "from", "by", "as", "all",
    "true", "false", "null", "none", "off", "on_", "yes", "no", "error", "warn", "warning",
    "info", "debug", "default", "auto", "always", "never", "enable", "disable", "enabled",
    "disabled", "include", "exclude", "ignore", "select", "extend", "set", "add", "remove",
    "name", "version", "type", "value", "key", "path", "src", "dist", "test", "tests",
    "example", "examples", "note", "notes", "warning_", "important", "tip",
  ]);

  const scan = (line: string, requireArgument: boolean) => {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    // A command with nothing after it is as likely to be a bare word in
    // prose, so inline code and indented prose must show an argument.
    if (requireArgument && tokens.length < 2) return;

    let i = 0;
    // Step over an environment prefix (FOO=bar cmd ...) and a runner.
    while (i < tokens.length && tokens[i].includes("=")) i++;
    if (i < tokens.length && /^(?:\$|#|>|sudo|npx|pnpm|yarn|bunx|uvx|poetry|docker)$/i.test(tokens[i])) i++;
    if (i >= tokens.length) return;

    const raw = tokens[i];
    if (raw.startsWith("-")) return;
    const bare = raw.replace(/^.*\//, "").toLowerCase();
    if (!/^[a-z][a-z0-9_.-]{1,30}$/.test(bare)) return;
    if (NEVER_A_TOOL.has(bare)) return;

    // A token followed by a flag is much more likely to be a command, so it
    // is worth more than one that merely sits first.
    const followedByFlag = tokens.slice(i + 1).some((t) => t.startsWith("--"));
    counts.set(bare, (counts.get(bare) ?? 0) + (followedByFlag ? 3 : 1));
  };

  // Capture the language and tolerate the rest of the info string, which can
  // be "```bash npm2yarn" or "```js title=\"a.js\"". Requiring a newline
  // straight after the language skips the opener and mis-pairs every fence
  // after it.
  for (const m of text.matchAll(/```([a-zA-Z0-9_-]*)[^\n]*\n([\s\S]*?)```/g)) {
    if (!SHELL_FENCES.has(m[1].toLowerCase())) continue;
    for (const line of m[2].split("\n")) scan(line, false);
  }
  for (const m of text.matchAll(/^ {2,}(\S.*)$/gm)) scan(m[1], true);
  for (const m of text.matchAll(/`([^`\n]{2,200})`/g)) scan(m[1], true);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return {
      tool: "",
      note:
        "No command could be identified in the reference, so flags mentioned in prose " +
        "are not attributed to any command and misattribution is not checked. " +
        "Pass --tool to name it.",
    };
  }
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return {
      tool: ranked[0][0],
      note:
        `The reference names "${ranked[0][0]}" and "${ranked[1][0]}" equally often; ` +
        `"${ranked[0][0]}" was assumed to be the documented tool. Pass --tool to be sure.`,
    };
  }
  return { tool: ranked[0][0] };
}

/**
 * The status the reference gives a token.
 *
 * `presentsAsUsable` is reused in reverse: it already answers "does this
 * mention carry a denial", which is the same question asked of the source
 * rather than of a draft. Any denial anywhere wins, because a reference that
 * says a flag was removed has said so whatever else it lists.
 */
function statusFromReference(
  text: string,
  token: string,
  occurrences: Occurrence[],
): { status: SpecFeature["status"]; evidence?: string } {
  // Deprecation is checked before denial, and only on the explicit word.
  //
  // "`--legacy-index` is deprecated and will be removed in 4.0" contains
  // "removed in", so the denial test fires and the flag reads as gone. It is
  // not gone: it works today and the draft should say it is on the way out.
  // A future removal is a deprecation, and reading it as a present denial
  // would have the tool reporting correct use of a working flag.
  // Looked for in the whole paragraph, not the matched line. A reference
  // writes "--legacy-index   Write the 2.x index alongside the 3.x one. This
  // flag is / deprecated and will be removed in 4.0." — the annotation wraps
  // onto the next line, which is how every flag table in the world is
  // formatted. Deprecation is a coarse annotation about a feature, so the
  // coarse unit is the right one; a denial is a specific claim and stays
  // scoped to its clause below.
  const deprecationEvidence = occurrences.find((o) => /\bdeprecat/i.test(o.entry));
  if (deprecationEvidence) {
    return { status: "deprecated", evidence: deprecationEvidence.context };
  }

  for (const { context } of occurrences) {
    // Scoped to the clause, not the sentence. In "`BEACONDB_PORT` is ignored
    // in 3.2; use `--port`" the denial belongs to the variable, and a
    // sentence-wide window hands it to `--port` as well — which would report
    // a correct draft for using a supported flag. One false finding like that
    // costs more trust than a missed one gains.
    const clause = clauseContaining(context, token);
    if (!presentsAsUsable(clause, token)) {
      return { status: "unsupported", evidence: context };
    }
  }

  // The weaker deprecation signals, after denial has had its turn — and
  // asked of the entry, not the document.
  //
  // `acknowledgesDeprecation` spans sentences on purpose, because when
  // checking a *draft* the question is whether the document says it
  // anywhere nearby. Inference is the opposite case: a flag table has no
  // blank line in it, so a document-wide window lets one deprecated entry
  // mark every flag beside it as deprecated. Same helper, two scopes, and
  // the scope is the whole difference.
  const weaker = occurrences.find((o) => acknowledgesDeprecation(o.entry, token));
  if (weaker) {
    return { status: "deprecated", evidence: weaker.context };
  }
  return { status: "supported", evidence: occurrences[0]?.context };
}

/**
 * The clause of `context` that contains `token`.
 *
 * Split on semicolons and em dashes, which is where English joins two
 * statements about two different things.
 */
function clauseContaining(context: string, token: string): string {
  const parts = context.split(/\s*[;—]\s*/);
  if (parts.length === 1) return context;
  const lower = token.toLowerCase();
  return parts.find((p) => p.toLowerCase().includes(lower)) ?? context;
}

interface Occurrence {
  /** The clause-sized unit: a command line, or the enclosing sentence. */
  context: string;
  /** The whole table entry or sentence, including wrapped continuations. */
  entry: string;
}

/**
 * The whole entry containing an index: its line plus wrapped continuations.
 *
 * A paragraph is too coarse and a line is too narrow. A flag table has no
 * blank lines in it, so the paragraph containing `--config` also contains
 * `--legacy-index ... deprecated`, and every flag in the block reads as
 * deprecated. A single line is wrong the other way, because the annotation
 * wraps:
 *
 *     --legacy-index      Write the 2.x index alongside the 3.x one. This flag is
 *                         deprecated and will be removed in 4.0.
 *
 * A continuation is a following line indented further than the entry's own
 * line, which is exactly how a wrapped table entry is laid out and exactly
 * not how the next entry is.
 */
function entryAround(text: string, index: number): string {
  const lines = text.split("\n");
  let offset = 0;
  let lineNumber = 0;
  for (; lineNumber < lines.length; lineNumber++) {
    const end = offset + lines[lineNumber].length;
    if (index <= end) break;
    offset = end + 1;
  }

  const indentOf = (l: string) => l.length - l.trimStart().length;
  const own = lines[lineNumber] ?? "";
  const baseIndent = indentOf(own);
  const collected = [own];

  for (let i = lineNumber + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;
    if (indentOf(line) <= baseIndent) break;
    collected.push(line);
  }
  return collected.join("\n");
}

/** Every sentence or command line in which a token appears. */
function occurrencesOf(text: string, token: string): Occurrence[] {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found: Occurrence[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(new RegExp(escaped, "gi"))) {
    const line = text.slice(text.lastIndexOf("\n", m.index) + 1).split("\n")[0];
    // A command-shaped line stands alone; prose is read as a sentence.
    const isCommandish = /^\s{2,}\S/.test(line) || /^\s*[$#>]\s/.test(line);
    const context = isCommandish ? line.trim() : sentenceAround(text, m.index);
    if (seen.has(context)) continue;
    seen.add(context);
    found.push({ context, entry: entryAround(text, m.index) });
  }
  return found;
}

/**
 * Collect "<subject> ... default ... <value>" from a document.
 *
 * Per line, and deliberately so: a default and its subject sit together, and
 * a window that crosses lines picks up the next setting's value. Returns a
 * set per subject, so a document stating two values for one subject is
 * visible as such.
 */
export function collectDefaults(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\|/g, " ");
    const at = line.search(/\bdefault/i);
    if (at < 0) continue;

    const before = line.slice(0, at);
    const after = line.slice(at).replace(/^default(?:s to| is|ed to|s)?\s*[:=]?\s*/i, "");

    // The subject must look like an interface, not like English.
    //
    // A bare-word fallback was the original rule, and on real documentation
    // it elected "the": Jest's reference says "the default is ..." and Ruff's
    // says "the default", so "the" acquired two values and was reported as a
    // contradiction. A sentence about a default is not a declaration of one.
    //
    // So: a flag, an environment variable, or a configuration key with a dot
    // or an underscore in it. Anything else is prose and is skipped.
    const flagsAndVars = [...before.matchAll(/(--[a-z][a-z0-9-]*|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b)/g)];
    const configKeys = [...before.matchAll(/(?<![-\w])([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)\b/g)];
    const subject = (flagsAndVars.at(-1) ?? configKeys.at(-1))?.[1];
    if (!subject) continue;

    // Greedy, then one trailing sentence mark removed. A lazy match that
    // stopped at the first period turned /etc/beacondb/beacondb.toml into
    // /etc/beacondb/beacondb — wrong in the same way on both sides of the
    // comparison, which is exactly how it would have gone unnoticed.
    const value = /^`?([^\s`,;)]+)`?/.exec(after)?.[1]?.replace(/[.,;]+$/, "");
    if (!value || /^(?:the|a|an|is|to|of|in|for)$/i.test(value)) continue;

    const key = subject.startsWith("--") || /^[A-Z]/.test(subject) ? subject : subject.toLowerCase();
    const set = out.get(key) ?? new Set<string>();
    set.add(value);
    out.set(key, set);
  }
  return out;
}

export function inferReference(
  text: string,
  options: { toolCommand?: string } = {},
): InferredReference {
  const notes: string[] = [];

  let tool = options.toolCommand?.toLowerCase() ?? "";
  if (!tool) {
    const guessed = inferToolCommand(text);
    tool = guessed.tool;
    if (guessed.note) notes.push(guessed.note);
  }

  const features: SpecFeature[] = [];
  const seen = new Set<string>();
  const add = (f: SpecFeature) => {
    const key = `${f.kind}:${f.kind === "env" ? f.token : f.token.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    features.push(f);
  };

  // ── flags, with the command the reference attributes them to ──
  for (const use of extractFlagUses(text, tool, tool ? [tool] : [])) {
    const { status, evidence } = statusFromReference(text, use.token, occurrencesOf(text, use.token));
    const owner = use.attributedTo ?? tool;
    add({
      token: use.token,
      kind: "flag",
      // A flag the reference attributes to another command is that command's.
      status: owner && tool && owner !== tool && status === "supported" ? "contextual" : status,
      command: owner || undefined,
      note: evidence,
    });
  }

  // ── subcommands ──
  if (tool) {
    for (const use of extractCommandUses(text, tool)) {
      const { status, evidence } = statusFromReference(text, use.token, occurrencesOf(text, use.token));
      add({ token: use.token, kind: "command", status, note: evidence });
    }
  }

  // ── environment variables ──
  const namespaces = new Set<string>();
  for (const m of text.matchAll(ENV_TOKEN)) {
    const token = m[1];
    if (SHELL_VARIABLES.has(token)) continue;
    const { status, evidence } = statusFromReference(text, token, occurrencesOf(text, token));
    add({ token, kind: "env", status, note: evidence });
    namespaces.add(token);
  }

  // ── exit codes and endpoints ──
  for (const use of extractExitCodeUses(text)) {
    const { status, evidence } = statusFromReference(text, use.token, [
      { context: use.context, entry: use.context },
    ]);
    add({ token: use.token, kind: "exit_code", status, note: evidence });
  }
  for (const use of extractEndpointUses(text)) {
    const { status, evidence } = statusFromReference(text, use.token, [
      { context: use.context, entry: use.context },
    ]);
    add({ token: use.token, kind: "endpoint", status, note: evidence });
  }

  const defaults = new Map<string, string>();
  for (const [subject, values] of collectDefaults(text)) {
    if (values.size === 1) defaults.set(subject, [...values][0]);
    else {
      notes.push(
        `The reference gives more than one default for ${subject} (${[...values].join(", ")}), ` +
          `so its value is not cross-checked.`,
      );
    }
  }

  if (features.length === 0) {
    notes.push(
      "No flags, commands, variables, exit codes or endpoints were found in the reference. " +
        "With nothing to compare against, this check cannot say anything about the draft.",
    );
  }

  return { toolCommand: tool, features, envNamespaces: [...namespaces], defaults, notes };
}

/** Kinds in the order a report should list them. */
export const KIND_ORDER: FeatureKind[] = ["command", "flag", "env", "exit_code", "endpoint"];

export const KIND_LABEL: Record<FeatureKind, string> = {
  command: "command",
  flag: "flag",
  env: "environment variable",
  exit_code: "exit or status code",
  endpoint: "endpoint",
};
