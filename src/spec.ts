// DocFacts — Copyright (c) 2026 Antwon Randolph. MIT licensed; see LICENSE.
/**
 * What a specification actually says about a feature.
 *
 * A9's detector asked one question — "does this token appear in the source?"
 * — and that is unsafe in a way the holdout exposed. The quilldeck reference
 * contains the sentence "There is no `--auth` flag in 0.9", so a document
 * that confidently told operators to pass `--auth` would have been treated as
 * supported by the specification. The specification said the opposite.
 *
 * Appearing in a document is not a status. These are:
 *
 *  - `supported` — the spec presents it as usable. Using it is correct.
 *  - `unsupported` — the spec explicitly says it does not exist, is ignored,
 *    or must not be used. Presenting it as usable is the **worst** failure
 *    available, worse than inventing something: the spec warned you.
 *  - `deprecated` — usable but on the way out. Using it without saying so is
 *    a defect; saying so is fine.
 *  - `contextual` — it appears in the spec as part of *another command's*
 *    invocation. `useradd --system` makes `--system` a useradd flag, not a
 *    flag of the tool being documented. Attributing it to the documented tool
 *    is a defect.
 *  - `unknown` — not in the spec at all. A fabrication.
 *
 * The other half of the fix is **command association**. A bare token tells
 * you nothing; `meshgate --system` and `useradd --system` are a wrong claim
 * and a correct one. So features carry the command they belong to, and the
 * verifier attributes each use in a document to the nearest preceding command
 * rather than to the air.
 *
 * ## Why context is a sentence and not a window
 *
 * Deciding whether a use *presents* a feature as usable means reading the
 * text around it, and how much text is not a detail — it is the whole
 * judgement:
 *
 *  - too narrow and "There is no `--auth` flag" fails, because the negation
 *    sits outside the inline code span. A correct document gets rejected.
 *  - too wide and a document that warns against `--auth` in one paragraph,
 *    then puts it in a copy-paste command block below, passes. A wrong
 *    document gets accepted.
 *
 * So the unit is the sentence for prose, and the **line** for anything
 * command-shaped. A command line carries no negation of its own, which is the
 * right answer: a flag sitting in a block an operator will paste is being
 * presented as usable no matter what the surrounding prose says.
 */

export type FeatureKind = "flag" | "env" | "exit_code" | "endpoint" | "command";

export type FeatureStatus =
  | "supported"
  | "unsupported"
  | "deprecated"
  | "contextual"
  | "unknown";

export interface SpecFeature {
  /** `--workers`, `MESHGATE_STATE_DIR`, `21`, `POST /shipments`, `meshgate reload`. */
  token: string;
  kind: FeatureKind;
  status: Exclude<FeatureStatus, "unknown">;
  /**
   * The command this belongs to.
   *
   * For the documented tool's own flags this is the tool's binary name. For a
   * `contextual` feature it is the other command — `useradd`, `journalctl`.
   * Environment variables, exit codes and endpoints leave it undefined.
   */
  command?: string;
  /** Why, in the spec's own words. Shown in defect reports. */
  note?: string;
}

/** One use of a feature found in a generated document. */
export interface FeatureUse {
  token: string;
  kind: FeatureKind;
  /** The command it was attributed to in the document, if any. */
  attributedTo?: string;
  /**
   * Found in prose rather than in anything command-shaped.
   *
   * Prose is read far more loosely, so a prose sighting is good enough to
   * say "the document uses a command the reference denies" and not good
   * enough to say "this command does not exist". See the note in
   * `extractCommandUses`.
   */
  fromProse?: boolean;
  /** The sentence or command line it appeared in. */
  context: string;
}

export interface FeatureIndex {
  /** The binary the document is about. */
  toolCommand: string;
  features: SpecFeature[];
}

/**
 * Collapse a concrete path id to a placeholder.
 *
 * A spec documents `GET /decks/{id}`; a useful document writes
 * `GET /decks/12345`, because an example with a real-looking id is easier to
 * follow. Without this, every such example reads as an invented endpoint and
 * a correct document gets rejected for being helpful.
 */
export function normaliseEndpoint(token: string): string {
  const [method, ...rest] = token.split(/\s+/);
  const path = rest.join(" ");
  const collapsed = path
    .split("/")
    .map((seg) => {
      if (seg === "") return seg;
      if (/^\{.*\}$/.test(seg)) return "{id}"; // {id}, {deckId}, {shipment_id}
      if (/^\d+$/.test(seg)) return "{id}"; // 12345
      if (/^[0-9a-f]{8,}$/i.test(seg)) return "{id}"; // hex or uuid fragment
      if (/^[A-Za-z0-9_-]{20,}$/.test(seg)) return "{id}"; // opaque token
      return seg.toLowerCase();
    })
    .join("/");
  return `${method.toUpperCase()} ${collapsed}`;
}

/** Normalise for comparison: flags are case-insensitive, env vars are not. */
function key(token: string, kind: FeatureKind): string {
  if (kind === "env") return `${kind}:${token}`;
  if (kind === "endpoint") return `${kind}:${normaliseEndpoint(token)}`;
  return `${kind}:${token.toLowerCase()}`;
}

export function buildIndex(index: FeatureIndex): Map<string, SpecFeature> {
  const map = new Map<string, SpecFeature>();
  for (const f of index.features) {
    const k = key(f.token, f.kind);
    if (map.has(k)) {
      throw new Error(`spec: duplicate feature ${f.token} (${f.kind})`);
    }
    map.set(k, f);
  }
  return map;
}

export function lookup(
  map: Map<string, SpecFeature>,
  token: string,
  kind: FeatureKind,
): SpecFeature | undefined {
  return map.get(key(token, kind));
}

/**
 * Programs that run another program. The command is what follows them.
 *
 * Real documentation is written as `npx prettier . --check`, and taking the
 * first bare token made that a claim about `npx`. Six public projects were
 * checked and this produced a confident, wrong finding in two of them.
 */
const RUNNERS = new Set([
  "npx", "pnpm", "pnpx", "yarn", "bunx", "bun", "npm", "uvx", "uv", "pipx", "poetry",
  "pdm", "hatch", "rye", "cargo", "go", "deno", "node", "python", "python3", "ruby",
  "sudo", "doas", "env", "time", "nohup", "xargs", "docker", "podman", "kubectl",
]);

/**
 * Advance past a shell prompt, environment assignments and runners.
 *
 * Returns the index of the token that is actually the command. A runner with
 * nothing after it stays the command, because `npm` alone is a claim about
 * npm.
 */
function commandIndex(tokens: readonly string[]): number {
  let i = 0;
  // `$` and `>` only. `#` is dropped as a prompt marker because it is far
  // more often a comment: Ruff's tutorial has "# Add the line-too-long rule
  // ... By default, Ruff omits rules that ...", inside a code block, and
  // reading that as a command produced "ruff omits". Missing a command on a
  // root-prompt line is a false negative; reading a comment as a command is
  // a false finding, and that is the costlier direction.
  while (i < tokens.length && /^[$>]$/.test(tokens[i])) i++;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  while (
    i + 1 < tokens.length &&
    RUNNERS.has(tokens[i].replace(/^.*\//, "").toLowerCase()) &&
    !tokens[i + 1].startsWith("-")
  ) {
    i++;
  }
  return i;
}

/** A comment line in a code block. Prose, not an invocation. */
function isCommentLine(line: string): boolean {
  return /^\s*(?:#|\/\/|\/\*|;|rem\s|::)/i.test(line);
}

/** Drop a trailing comment, so its prose is not scanned as arguments. */
function stripTrailingComment(line: string): string {
  return line.replace(/\s+#\s.*$/, "").replace(/\s+\/\/\s.*$/, "");
}

/**
 * Phrases that restrict how two options combine rather than denying either.
 *
 * Prettier's reference says "`--write` cannot be used with `--debug-check`",
 * and reading that as a denial reported a correct guide for telling people
 * to use `--write`, which is the flag's entire purpose. Found by running
 * against six public projects; two of their false findings were this shape.
 */
const RESTRICTION =
  /\b(?:cannot|can't|can not|may not|must not|should not|does not|doesn't)\s+be\s+(?:used|combined|mixed|specified|passed|set)\s+(?:with|together|alongside|at the same time|in combination)/i;

/** Markdown structure that starts a new thought: list item, heading, table row. */
const STRUCTURAL = /^[-*#>|]|^\d+[.)]/;

/** Is there a segment break immediately before index `i`? */
function isBreakBefore(text: string, i: number): boolean {
  if (i <= 0) return true;
  if (text[i - 1] !== "\n") return false;
  if (text[i] === "\n") return true; // blank line
  return STRUCTURAL.test(text.slice(i, i + 4));
}

/**
 * The sentence containing `index`.
 *
 * Bounded by sentence punctuation, a blank line, or the start of a list item,
 * heading or table row — but *not* by a plain line break, because markdown
 * prose wraps mid-sentence and the quilldeck reference wraps exactly across
 * the "There is no `--auth` flag" warning.
 */
export function sentenceAround(text: string, index: number, limit = 400): string {
  let start = 0;
  for (let i = index; i > 0; i--) {
    if (isBreakBefore(text, i)) {
      start = i;
      break;
    }
    if (/[.!?]/.test(text[i - 1]) && /\s/.test(text[i])) {
      start = i;
      break;
    }
    if (index - i >= limit) {
      start = i;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i++) {
    if (i > index && isBreakBefore(text, i)) {
      end = i;
      break;
    }
    if (/[.!?]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      end = i + 1;
      break;
    }
    if (i - index >= limit) {
      end = i;
      break;
    }
  }
  return text.slice(start, end).trim();
}

/** Blank a region out while preserving every offset and line break. */
const blankOut = (s: string) => s.replace(/[^\n]/g, " ");

/** The maximum uses of one kind recorded, so a pathological document cannot blow up. */
const MAX_USES = 400;

/**
 * Pull every flag use out of a document, attributed to a command.
 *
 * Command-shaped text — fenced blocks, indented lines and inline code spans —
 * is scanned for `<command> ... --flag ...`, carrying the command forward
 * across the flags that follow it and resetting at a pipe or separator. A
 * flag mentioned in prose with no command gets attributed to the documented
 * tool, because that is what a reader would assume.
 */
export function extractFlagUses(
  text: string,
  toolCommand: string,
  knownCommands: readonly string[] = [],
): FeatureUse[] {
  const known = new Set([toolCommand.toLowerCase(), ...knownCommands.map((c) => c.toLowerCase())]);

  /**
   * Who owns a flag that appears in prose.
   *
   * The documented tool, unless the sentence names a command the
   * specification knows about — "run systemctl enable --now hexwell" is a
   * claim about systemctl, and reporting it as a hexwell flag would reject a
   * correct document.
   *
   * The leftmost known command in the sentence wins, matching how a command
   * line reads: in `journalctl -u slatequeue --since ...` the tool's own name
   * is an argument, not the command. A sentence that names two commands
   * before the flag is read as being about the first, which is a limitation
   * rather than a rule.
   */
  const owner = (sentence: string, flag: string): string => {
    const prefix = sentence.slice(0, Math.max(0, sentence.indexOf(flag)));
    for (const raw of prefix.split(/[\s,(]+/)) {
      const bare = raw.replace(/^.*\//, "").replace(/[^A-Za-z0-9_.-]/g, "").toLowerCase();
      if (bare && known.has(bare)) return bare;
    }
    return toolCommand;
  };

  const uses: FeatureUse[] = [];
  const seen = new Set<string>();

  const push = (token: string, attributedTo: string | undefined, context: string) => {
    if (uses.length >= MAX_USES) return;
    const ctx = context.trim().slice(0, 200);
    // Keyed on the context too: a document that correctly says a flag does
    // not exist and then uses it anyway must yield both uses, or the
    // harmless one masks the failure.
    const k = `${token.toLowerCase()}|${attributedTo ?? ""}|${ctx}`;
    if (seen.has(k)) return;
    seen.add(k);
    uses.push({ token, kind: "flag", attributedTo, context: ctx });
  };

  /** Scan one command-shaped line, attributing flags to the active command. */
  const scanCommandLine = (line: string, context: string) => {
    if (isCommentLine(line)) return;
    let currentCommand: string | undefined;
    const all = stripTrailingComment(line).trim().split(/\s+/).filter(Boolean);
    for (const token of all.slice(commandIndex(all))) {
      if (/^[|&;]+$/.test(token)) {
        currentCommand = undefined;
        continue;
      }
      if (/^--[a-z][a-z0-9-]*$/i.test(token)) {
        push(token, currentCommand, context);
        continue;
      }
      if (token.startsWith("-")) continue; // short options and their values
      if (token.includes("=")) continue; // VAR=value prefixes are not commands
      // An absolute path is still a command: /usr/local/bin/quilldeck is
      // quilldeck. Strip the path first, then ask whether it looks like one.
      const bare = token.replace(/^.*\//, "");
      if (currentCommand === undefined && /^[a-z][a-z0-9_.-]*$/i.test(bare)) {
        currentCommand = bare;
      }
    }
  };

  // 1. Fenced blocks and indented lines: the context is the line, because a
  //    line in a paste-able block stands on its own.
  // The info string may carry more than a language: "```bash npm2yarn" is
  // real, and an opener of ```[a-z]*\n does not match it. The opener was then
  // skipped and the CLOSING fence paired with the next opener, so a paragraph
  // of prose became a code block and its sentences were scanned as commands.
  // Found on Jest's own documentation.
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of m[1].split("\n")) scanCommandLine(line, line);
  }
  for (const m of text.matchAll(/^ {4,}(\S.*)$/gm)) scanCommandLine(m[1], m[1]);

  // 2. Inline code spans: scanned for commands, but the context is the
  //    enclosing prose sentence, which is where a negation lives.
  for (const m of text.matchAll(/`([^`\n]{2,200})`/g)) {
    scanCommandLine(m[1], sentenceAround(text, m.index));
  }

  // 3. Flags in prose, outside any code. Code is blanked at equal length so
  //    offsets still point into a text the sentence finder can read.
  const codeStripped = text
    .replace(/```[\s\S]*?```/g, blankOut)
    .replace(/`[^`\n]*`/g, blankOut)
    .replace(/^ {4,}.*$/gm, blankOut);
  for (const m of codeStripped.matchAll(/--[a-z][a-z0-9-]*/gi)) {
    const sentence = sentenceAround(codeStripped, m.index);
    push(m[0], owner(sentence, m[0]), sentence);
  }

  return uses;
}

/** Environment variables used, restricted to the spec's own namespaces. */
export function extractEnvUses(text: string, namespaces: string[]): FeatureUse[] {
  if (namespaces.length === 0) return [];
  const prefixes = [...new Set(namespaces.map((n) => n.split("_")[0]).filter(Boolean))];
  const pattern = new RegExp(`\\b(?:${prefixes.join("|")})_[A-Z0-9_]{2,40}\\b`, "g");
  const seen = new Set<string>();
  const uses: FeatureUse[] = [];
  for (const m of text.matchAll(pattern)) {
    const context = sentenceAround(text, m.index);
    const k = `${m[0]}|${context}`;
    if (seen.has(k) || uses.length >= MAX_USES) continue;
    seen.add(k);
    uses.push({ token: m[0], kind: "env", context: context.slice(0, 200) });
  }
  return uses;
}

/**
 * The markdown heading a position sits under, or "" above the first one.
 *
 * Used to decide whether a bare number in a table is an exit code or a value
 * of something else entirely.
 */
export function nearestHeading(text: string, index: number): string {
  let heading = "";
  for (const m of text.matchAll(/^#{1,6}[ \t]*(.+)$/gm)) {
    if (m.index > index) break;
    heading = m[1].trim();
  }
  return heading;
}

/** Exit codes asserted as exit codes, not every number in the text. */
export function extractExitCodeUses(text: string): FeatureUse[] {
  const seen = new Set<string>();
  const uses: FeatureUse[] = [];
  const add = (code: string, index: number) => {
    const context = sentenceAround(text, index);
    const k = `${code}|${context}`;
    if (seen.has(k) || uses.length >= MAX_USES) return;
    seen.add(k);
    uses.push({ token: code, kind: "exit_code", context: context.slice(0, 200) });
  };

  // Stated outright, anywhere in the document.
  for (const m of text.matchAll(/\bexits?\s+(?:with\s+)?(?:code\s+)?`?(\d{1,3})`?\b/gi)) {
    add(m[1], m.index);
  }
  for (const m of text.matchAll(/\bexit\s+code\s+`?(\d{1,3})`?\b/gi)) add(m[1], m.index);

  // A bare number in a table row or list item is only an exit code when the
  // section says so. Without this, a table of accepted values for a flag
  // ("| 3 | index version 3 |") reads as an undocumented exit code and
  // rejects a correct document — a false fabrication report is as damaging
  // as a missed one.
  const heading = (index: number) => nearestHeading(text, index);
  const codeSection = (index: number) => /exit|status|return|code/i.test(heading(index));

  /**
   * Is this number plausibly a code here?
   *
   * A process exit code is 0–255, and capping at 255 was right for that and
   * wrong for everything else: it made **every 5xx HTTP status invisible**.
   * A negative control planted `503` in an API reference's own status-code
   * section and the gate passed the document, which is the permissive
   * direction — a fabricated 503 would have shipped.
   *
   * So the range follows the section. Under a heading about statuses, HTTP's
   * 100–599 applies; otherwise the exit-code range does.
   */
  const inRange = (value: number, index: number) =>
    /status/i.test(heading(index)) ? value >= 100 && value <= 599 : value <= 255;

  for (const m of text.matchAll(/^\s*\|?\s*`?(\d{1,3})`?\s*\|/gm)) {
    if (codeSection(m.index) && inRange(Number(m[1]), m.index)) add(m[1], m.index);
  }
  for (const m of text.matchAll(/^\s*[-*]\s*`?(\d{1,3})`?\s*[:—-]/gm)) {
    if (codeSection(m.index) && inRange(Number(m[1]), m.index)) add(m[1], m.index);
  }
  // An indented two-column block, which is how a plain-text reference lists
  // them: "    20   The config file is unreadable". Scoped to a code section
  // like the other layout heuristics, so an indented table of something else
  // is not read as codes.
  for (const m of text.matchAll(/^[ \t]{2,}`?(\d{1,3})`?[ \t]{2,}\S/gm)) {
    if (codeSection(m.index) && inRange(Number(m[1]), m.index)) add(m[1], m.index);
  }
  return uses;
}

/** HTTP endpoints referenced, as method + path. */
export function extractEndpointUses(text: string): FeatureUse[] {
  const seen = new Set<string>();
  const uses: FeatureUse[] = [];
  for (const m of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-/{}]*)/g)) {
    const token = `${m[1]} ${m[2].replace(/\/$/, "")}`;
    const context = sentenceAround(text, m.index);
    const k = `${token}|${context}`;
    if (seen.has(k) || uses.length >= MAX_USES) continue;
    seen.add(k);
    uses.push({ token, kind: "endpoint", context: context.slice(0, 200) });
  }
  return uses;
}

/** Words that follow a tool name in prose without naming a subcommand. */
const NOT_A_SUBCOMMAND = new Set([
  "is", "was", "will", "would", "does", "do", "can", "cannot", "may", "must",
  "should", "and", "or", "to", "the", "a", "an", "in", "on", "at", "by", "for",
  "with", "from", "exits", "exited", "returns", "writes", "reads", "has",
  "have", "supports", "requires", "uses", "needs", "also", "only", "never",
  "always", "version", "itself", "then", "so", "but", "if", "when", "while",
]);

/**
 * Subcommands the document attributes to the tool.
 *
 * A fabricated subcommand is as wrong as a fabricated flag — "run `slatequeue
 * reset`" sends an operator to a command that does not exist — and the A9
 * detector had no concept of one.
 *
 * Prose is read conservatively: only "run/use/execute <tool> <sub>" and
 * "<tool> <sub> command" count, because `tool exits 0` is a sentence and not
 * an invocation, and a false fabrication report rejects a correct document.
 */
export function extractCommandUses(text: string, toolCommand: string): FeatureUse[] {
  const uses: FeatureUse[] = [];
  const seen = new Set<string>();
  const tool = toolCommand.toLowerCase();

  const push = (sub: string, context: string, fromProse = false) => {
    const token = `${tool} ${sub.toLowerCase()}`;
    const ctx = context.trim().slice(0, 200);
    const k = `${token}|${ctx}`;
    if (seen.has(k) || uses.length >= MAX_USES) return;
    seen.add(k);
    uses.push({ token, kind: "command", attributedTo: tool, context: ctx, fromProse });
  };

  // The stopword list applies inside command-shaped regions too, because a
  // four-space-indented paragraph is indistinguishable from an indented
  // command block. "forgeline never provides stdin" is a sentence, and
  // reporting `forgeline never` as a fabricated command would reject a
  // correct document.
  const isSubcommand = (t: string | undefined): t is string =>
    t !== undefined &&
    /^[a-z][a-z0-9-]{1,30}$/i.test(t) &&
    !t.includes("=") &&
    !NOT_A_SUBCOMMAND.has(t.toLowerCase());

  const scanLine = (line: string, context: string) => {
    if (isCommentLine(line)) return;
    const all = stripTrailingComment(line).trim().split(/\s+/).filter(Boolean);
    const tokens = all.slice(commandIndex(all));
    for (let i = 0; i < tokens.length; i++) {
      const bare = tokens[i].replace(/^.*\//, "").toLowerCase();
      if (bare !== tool) continue;
      const next = tokens[i + 1];
      if (isSubcommand(next)) push(next, context);
    }
  };

  // Same info-string fix as in extractFlagUses.
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of m[1].split("\n")) scanLine(line, line);
  }
  for (const m of text.matchAll(/^ {4,}(\S.*)$/gm)) scanLine(m[1], m[1]);
  for (const m of text.matchAll(/`([^`\n]{2,200})`/g)) {
    scanLine(m[1], sentenceAround(text, m.index));
  }

  const codeStripped = text
    .replace(/```[\s\S]*?```/g, blankOut)
    .replace(/`[^`\n]*`/g, blankOut)
    .replace(/^ {4,}.*$/gm, blankOut);
  const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prose = new RegExp(
    `(?:run|runs|running|use|using|execute|executing|invoke|invoking|call|calling)\\s+` +
      // Quotes and backticks around the subcommand are tolerated. A
      // reference writes: There is no "beacondb reset" command. The closing
      // quote sat between the word and "command", so the pattern never
      // matched and the one command the reference explicitly denies was the
      // one feature missing from the inferred list.
      `${escaped}\\s+[\`"']?([a-z][a-z0-9-]{1,30})[\`"']?\\b` +
      `|${escaped}\\s+[\`"']?([a-z][a-z0-9-]{1,30})[\`"']?\\s+command\\b`,
    "gi",
  );
  for (const m of codeStripped.matchAll(prose)) {
    const sub = (m[1] ?? m[2] ?? "").toLowerCase();
    if (!sub || NOT_A_SUBCOMMAND.has(sub)) continue;
    // Marked as prose, because English will not be filtered by a word list.
    // Six public projects produced "jest directly", "jest globals", "ruff
    // again", "prettier as" and "uv which" from sentences like "run Jest
    // directly". The caller uses these only to recognise a command the
    // reference has something to say about, never to call one invented.
    push(sub, sentenceAround(codeStripped, m.index), true);
  }

  return uses;
}

/**
 * Does a use of a deprecated feature acknowledge the deprecation?
 *
 * Looked for near the use rather than anywhere in the document: a
 * deprecation notice three sections away does not help a reader following the
 * command in front of them.
 */
export function acknowledgesDeprecation(text: string, token: string): boolean {
  // "superseded" needs its "by". Inferring statuses from a reference turned
  // up "beacondb compact   Reclaim space from superseded events", where the
  // word describes the events and not the command, and the command read as
  // deprecated. A bare mention of a near-synonym is not an annotation.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const signals =
    "deprecat|legacy|obsolete|superseded by|no longer recommended|will be removed";
  // The window spans sentences but stops at a blank line. `[^.]` was the
  // first version and it failed on the most ordinary phrasing there is: "The
  // --legacy-index flag writes the 2.x index as well. It is deprecated and
  // will be removed in 4.0." The acknowledgement is in the next sentence,
  // which is where a writer naturally puts it, and the tool reported a
  // correct document for not saying what it had just said.
  const near = "(?:(?!\\n\\n)[\\s\\S]){0,240}?";
  const pattern = new RegExp(
    `(?:${signals})${near}${escaped}|${escaped}${near}(?:${signals})`,
    "i",
  );
  return pattern.test(text);
}

/**
 * Does this use present an unsupported feature as usable?
 *
 * Saying that `--auth` does not exist is correct and useful. Telling the
 * reader to pass it is the failure. The test is whether the use carries a
 * negation — which is why `context` must be the sentence (see the note at the
 * top of this file).
 */
export function presentsAsUsable(context: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // A restriction on combining two options denies neither of them.
  if (RESTRICTION.test(context)) return true;

  const negated = new RegExp(
    `\\b(?:${DENIAL_BEFORE.join("|")})\\b${WINDOW}${escaped}` +
      `|${escaped}${WINDOW}\\b(?:${DENIAL_AFTER.join("|")})`,
    "i",
  );
  return !negated.test(context);
}

/**
 * How far a denial may sit from the feature it denies.
 *
 * `[^.]` was the first version, and the live run showed what it costs: the
 * hexwell document's exit-code table said "a removed command (e.g., `hexwell
 * make`) was used", and `e.g.` ended the window before it reached the token.
 * `4.0` did the same. Since `context` is already one sentence or one command
 * line, the period restriction added nothing except that failure mode, so the
 * window now spans the context and relies on sentence scoping for its bounds.
 */
const WINDOW = "[\\s\\S]{0,160}?";

/** A denial standing before the feature: "there is no --auth flag". */
const DENIAL_BEFORE = [
  "no",
  "not",
  "never",
  // "without" was here and is gone. It governs whatever immediately
  // follows it, not a token later in the sentence: Ruff's reference says
  // "without force-exclude enabled, ruff check /path/to/excluded/file.py",
  // which denies nothing and was read as denying the command. And "run
  // without --verbose" never meant the flag did not exist.
  "cannot",
  "can't",
  "don't",
  "do not",
  "avoid",
  "unsupported",
  "unavailable",
  "removed",
  "reserved",
  "ignored",
];

/**
 * A denial standing after it: "`--flatten` has been removed".
 *
 * The live run found this list too narrow in the most ordinary way possible:
 * it held "was removed" and not "has been removed", which is how a competent
 * writer would put it. A correct document was rejected for good English.
 *
 * `deprecated` is deliberately absent. A deprecated feature still works, and
 * reading it as a denial would let a document present a genuinely removed
 * feature as usable by calling it deprecated.
 */
const DENIAL_AFTER = [
  "does not exist",
  "doesn't exist",
  "no longer exists",
  "no longer available",
  "no longer supported",
  "no longer",
  "is ignored",
  "are ignored",
  "is not supported",
  "not supported",
  "unsupported",
  "has no effect",
  "is reserved",
  "reserved",
  "was removed",
  "were removed",
  "has been removed",
  "have been removed",
  "been removed",
  "is removed",
  "are removed",
  "removed in",
  "removed from",
  "not available",
  "does not work",
  "doesn't work",
  "never returned",
  "is gone",
  "cannot be used",
  "must not be used",
  "is an error",
];
