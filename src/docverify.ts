#!/usr/bin/env node
// DocFacts — Copyright (c) 2026 Antwon Randolph. MIT licensed; see LICENSE.
/**
 * docverify — check a draft document against the reference it was written from.
 *
 *   docverify --reference ./upgrade-notes.md --draft ./guide.md
 *   docverify -r notes.md -d guide.md --tool hexwell --json
 *
 * Exit codes
 *   0  no findings
 *   1  findings
 *   2  usage or input error
 *
 * Two properties this file must keep, and which tests assert rather than
 * trust:
 *
 *  - **It never executes anything.** Commands in either document are text.
 *    No process-spawning module is imported and no subprocess is started.
 *    (Deliberately worded without naming the module: PRIVACY.md invites
 *    users to grep the published files for it, and a comment mentioning it
 *    would make a clean package look dirty.)
 *  - **It never transmits anything.** There is no network code anywhere in
 *    this module or in what it imports. Both documents stay on the machine
 *    that runs it. A verifier for other people's unreleased specifications
 *    has no business opening a socket, and "it only sends a hash" is the
 *    sort of thing that turns out to be untrue later.
 */

import fs from "node:fs";
import path from "node:path";
import { check, renderReport } from "./check.js";

const USAGE = `docverify — check a draft document against its reference

Usage
  docverify --reference <file> --draft <file> [options]

Options
  -r, --reference <file>   the source of truth the draft was written from
  -d, --draft <file>       the document to check
      --tool <name>        the command the reference documents, if the guess is wrong
      --json               machine-readable output instead of a report
  -h, --help               this text
  -V, --version            print the version and exit

Exit codes
  0  no findings      1  findings      2  usage or input error

It reports claims in the draft that the reference does not support: invented
commands, flags, variables, exit codes and endpoints, options attributed to the
wrong command, features the reference says do not exist, and defaults that
disagree with it.

It does not check whether anything is missing, whether the instructions work,
or whether the document is any good. A clean result is not a guarantee of
correctness. Nothing is executed and nothing leaves this machine.`;

/** Kept in step with the package version by a release-checklist step. */
export const VERSION = "0.1.0";

interface Args {
  reference?: string;
  draft?: string;
  tool?: string;
  json: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) {
        throw new Error(`${a} needs a value`);
      }
      i += 1;
      return v;
    };
    switch (a) {
      case "-r":
      case "--reference":
        args.reference = next();
        break;
      case "-d":
      case "--draft":
        args.draft = next();
        break;
      case "--tool":
        args.tool = next();
        break;
      case "--json":
        args.json = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-V":
      case "--version":
        args.version = true;
        break;
      default:
        throw new Error(`unknown option ${a}`);
    }
  }
  return args;
}

/** A multi-megabyte input is a mistake, not a document. */
export const MAX_INPUT_BYTES = 2_000_000;

/**
 * Normalise text so the same document gives the same answer everywhere.
 *
 * A report that differs between a file checked out on Windows and the same
 * file on Linux is a report nobody can rely on, and the differences are all
 * invisible characters:
 *
 *  - a UTF-8 byte-order mark becomes part of the first heading otherwise
 *  - CRLF endings break every `^`-anchored pattern and every indentation
 *    measurement
 *  - lone surrogates and NUL bytes can arrive from a mis-decoded file and
 *    make regular expressions behave differently between engines
 */
export function normaliseText(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    // Lone surrogates: replaced rather than dropped, so offsets stay sane.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�")
    .replace(/\u0000/g, "�");
}

/**
 * Read a file the user named, with the failures spelled out.
 *
 * Only a regular file is accepted. A directory, a device, a FIFO or a socket
 * is refused by name: reading `/dev/zero` or a named pipe would hang
 * forever, and "it hung" is a much worse error message than "that is not a
 * regular file". The size is checked before the read rather than after, so a
 * huge file is refused instead of loaded.
 *
 * Paths are used exactly as the user gave them, resolved against the working
 * directory. There is no base directory to escape and nothing is written, so
 * traversal is not a privilege question here — `../../etc/passwd` reads a
 * file the user running the command could already read with `cat`. What
 * matters is that the path is never taken from a *document*, only from the
 * command line.
 */
function readInput(label: string, file: string): string {
  const resolved = path.resolve(file);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES") throw new Error(`cannot read the ${label}: permission denied: ${file}`);
    if (code === "ELOOP") throw new Error(`cannot read the ${label}: too many symlinks: ${file}`);
    throw new Error(`cannot read the ${label}: ${file} does not exist`);
  }
  if (stat.isDirectory()) throw new Error(`the ${label} is a directory, not a file: ${file}`);
  if (!stat.isFile()) {
    throw new Error(
      `the ${label} is not a regular file: ${file}. Devices, pipes and sockets are refused ` +
        `because reading one would hang rather than finish`,
    );
  }
  if (stat.size === 0) throw new Error(`the ${label} is empty: ${file}`);
  if (stat.size > MAX_INPUT_BYTES) {
    throw new Error(
      `the ${label} is ${(stat.size / 1_000_000).toFixed(1)}MB, above the ` +
        `${MAX_INPUT_BYTES / 1_000_000}MB limit: ${file}`,
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    throw new Error(
      `cannot read the ${label}: ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = normaliseText(raw);
  if (!text.trim()) throw new Error(`the ${label} has no text in it: ${file}`);
  return text;
}

export function run(argv: readonly string[], write: (s: string) => void): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    write(`docverify: ${(err as Error).message}\n\n${USAGE}\n`);
    return 2;
  }

  if (args.version) {
    write(`docverify ${VERSION}
`);
    return 0;
  }

  if (args.help || argv.length === 0) {
    write(`${USAGE}\n`);
    return args.help ? 0 : 2;
  }
  if (!args.reference || !args.draft) {
    write(`docverify: both --reference and --draft are required\n\n${USAGE}\n`);
    return 2;
  }

  let referenceText: string;
  let draftText: string;
  try {
    referenceText = readInput("reference", args.reference);
    draftText = readInput("draft", args.draft);
  } catch (err) {
    write(`docverify: ${(err as Error).message}\n`);
    return 2;
  }

  const result = check(referenceText, draftText, { toolCommand: args.tool });
  const problems = result.findings.filter((f) => f.level === "finding");

  if (args.json) {
    write(
      `${JSON.stringify(
        {
          reference: args.reference,
          draft: args.draft,
          tool: result.reference.toolCommand || null,
          findings: result.findings,
          declared: result.declared,
          confirmedClaims: result.confirmed,
          // Carried in the output so a machine consumer cannot present a
          // clean result as a correctness guarantee either.
          limitations: result.limitations,
          inferenceNotes: result.reference.notes,
          version: VERSION,
          cleanResultIsNotAGuaranteeOfCorrectness: true,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    write(renderReport(result, { reference: args.reference, draft: args.draft }));
  }

  return problems.length > 0 ? 1 : 0;
}

// Only when run as a program, so the module can be imported by tests.
const invokedDirectly =
  process.argv[1] !== undefined &&
  /docverify(\.[cm]?[jt]s)?$/.test(path.basename(process.argv[1]));

if (invokedDirectly) {
  process.exitCode = run(process.argv.slice(2), (s) => process.stdout.write(s));
}
