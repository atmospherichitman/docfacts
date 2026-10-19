/**
 * The website's deployment guard.
 *
 *   node scripts/check-site.mjs site
 *
 * Exits non-zero, naming file and line, if the directory holds anything that
 * should not be served: a way to collect information, a script, a tracker, a
 * payment path, or a file that is not a static asset.
 *
 * ── Why this exists as a module rather than a grep ──────────────────────
 *
 * The first version lived in the deploy workflow as a line of
 * `grep -E '<form|<input|...'`. It rejected the site the day a worked
 * example gained two radio buttons — which collect nothing, submit nowhere
 * and exist only to drive a CSS `:checked` selector. Meanwhile the test
 * suite had already been taught the narrower rule, so the tests passed and
 * the deployment failed. Two statements of the same policy had drifted
 * apart, which is the predictable result of writing it twice.
 *
 * So it is written once, here, and both the workflow and the tests call it.
 * A rule can still be wrong, but it can no longer be wrong in only one of
 * the two places.
 *
 * It is also structural rather than textual. `grep '<input'` cannot tell a
 * radio button from a password field, cannot tell whether either sits inside
 * a form, and matches the string in a comment or a code sample just as
 * happily. This tokenises the markup, reads attributes, and tracks form
 * nesting, so the rules can be about what the page actually does.
 *
 * No dependencies: the deploy workflow runs it straight after checkout,
 * before anything is installed.
 */

import fs from "node:fs";
import path from "node:path";

/** Files a static site may consist of. Anything else is a decision. */
const ALLOWED_EXTENSIONS =
  /\.(html|css|svg|png|jpg|jpeg|webp|gif|ico|woff2|woff|yml|yaml|txt|json|xml)$/i;

/** Elements that must not appear at all. */
const FORBIDDEN_ELEMENTS = {
  form: "a form can submit information somewhere",
  script: "a script can do anything, including send data",
  textarea: "a place for a visitor to type",
  select: "a control whose value could be collected",
  iframe: "embeds a third party, which sees the visitor",
  object: "embeds external content",
  embed: "embeds external content",
};

/** Input types that cannot carry typed or chosen-from-disk data. */
const SAFE_INPUT_TYPES = new Set(["radio", "checkbox"]);

/** Hosts that would mean money, tracking, or both. */
const FORBIDDEN_HOSTS = [
  // payment
  "buy.stripe.com",
  "checkout.stripe.com",
  "js.stripe.com",
  "paypal.com",
  "gumroad.com",
  "lemonsqueezy.com",
  "polar.sh",
  "paddle.com",
  // analytics
  "googletagmanager.com",
  "google-analytics.com",
  "plausible.io",
  "usefathom.com",
  "posthog.com",
  "mixpanel.com",
  "hotjar.com",
  "fullstory.com",
  "clarity.ms",
  "segment.io",
  "segment.com",
  "matomo.cloud",
  "amplitude.com",
  "doubleclick.net",
  "connect.facebook.net",
];

/** Key shapes that should never be in a published page. */
const FORBIDDEN_PATTERNS = [
  [/\bpk_(?:live|test)_[A-Za-z0-9]+/, "a Stripe publishable key"],
  [/\bsk_(?:live|test)_[A-Za-z0-9]+/, "a Stripe secret key"],
  [/\bwhsec_[A-Za-z0-9]+/, "a Stripe webhook secret"],
  [/\bgtag\s*\(/, "a Google Analytics call"],
  [/\bga\s*\(\s*['"](?:create|send)['"]/, "a Google Analytics call"],
  [/\bdocument\.cookie\b/, "cookie access"],
  [/\b(?:local|session)Storage\b/, "browser storage access"],
];

/** Tags whose reference attribute causes a fetch while the page renders. */
const RESOURCE_TAGS = new Set([
  "link",
  "script",
  "img",
  "iframe",
  "source",
  "video",
  "audio",
  "embed",
  "object",
  "track",
  "input",
]);
const RESOURCE_ATTRS = ["src", "href", "data", "srcset", "poster"];

/**
 * Split markup into tags, with attributes parsed.
 *
 * Comments are blanked first, preserving length so reported line numbers
 * stay honest. Anything inside a comment is not served behaviour, and a
 * guard that fires on an explanatory comment gets edited until it stops
 * firing at all.
 */
export function tokenize(html) {
  const source = html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  const tags = [];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

  for (const match of source.matchAll(tagPattern)) {
    const [raw, slash, name, attrText = ""] = match;
    const attrs = {};
    const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    for (const a of attrText.matchAll(attrPattern)) {
      const key = a[1].toLowerCase();
      attrs[key] = a[3] ?? a[4] ?? a[5] ?? "";
    }
    tags.push({
      name: name.toLowerCase(),
      closing: slash === "/",
      attrs,
      raw,
      index: match.index,
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return tags;
}

/** True when a reference points off this site. */
function isExternal(value) {
  return /^(?:https?:)?\/\//i.test(value.trim());
}

/** Check one HTML document. Returns a list of problem strings. */
export function checkHtml(file, html) {
  const problems = [];
  const at = (tag) => `${file}:${tag.line}`;
  const tags = tokenize(html);

  /** How deeply we are nested inside a form, if at all. */
  let formDepth = 0;

  for (const tag of tags) {
    if (tag.name === "form") {
      if (!tag.closing) formDepth += 1;
      else formDepth = Math.max(0, formDepth - 1);
    }

    if (tag.closing) continue;

    // ── elements that must not exist ─────────────────────────────
    if (tag.name in FORBIDDEN_ELEMENTS) {
      problems.push(`${at(tag)}: <${tag.name}> — ${FORBIDDEN_ELEMENTS[tag.name]}`);
      continue;
    }

    // ── event handlers, anywhere ─────────────────────────────────
    for (const attr of Object.keys(tag.attrs)) {
      if (/^on[a-z]+$/.test(attr)) {
        problems.push(`${at(tag)}: <${tag.name} ${attr}=…> — an inline event handler is script`);
      }
    }

    // ── inputs: the narrow permission ────────────────────────────
    if (tag.name === "input") {
      const type = (tag.attrs.type ?? "").toLowerCase();

      if (type === "") {
        problems.push(`${at(tag)}: <input> with no type defaults to a text field`);
      } else if (!SAFE_INPUT_TYPES.has(type)) {
        problems.push(
          `${at(tag)}: <input type="${type}"> — only ${[...SAFE_INPUT_TYPES].join(" and ")} are allowed`,
        );
      }

      if (formDepth > 0) {
        problems.push(`${at(tag)}: <input type="${type}"> is inside a form, so it can be submitted`);
      }
      for (const attr of ["formaction", "formmethod", "formtarget"]) {
        if (attr in tag.attrs) {
          problems.push(`${at(tag)}: <input ${attr}=…> — points at a submission target`);
        }
      }
    }

    // ── submit controls ──────────────────────────────────────────
    if (tag.name === "button") {
      const type = (tag.attrs.type ?? "submit").toLowerCase();
      if (type === "submit") {
        problems.push(`${at(tag)}: <button type="submit"> — a submit control`);
      }
    }

    // ── anything fetched while rendering ─────────────────────────
    if (RESOURCE_TAGS.has(tag.name)) {
      const isCanonical = tag.name === "link" && (tag.attrs.rel ?? "").toLowerCase() === "canonical";
      for (const attr of RESOURCE_ATTRS) {
        const value = tag.attrs[attr];
        if (value === undefined || value === "") continue;
        if (isCanonical) continue;
        if (isExternal(value)) {
          problems.push(
            `${at(tag)}: <${tag.name} ${attr}="${value}"> — fetches from another host while rendering`,
          );
        }
      }
    }

    // ── javascript: URLs ─────────────────────────────────────────
    for (const attr of ["href", "src", "action"]) {
      const value = tag.attrs[attr];
      if (value && /^\s*javascript:/i.test(value)) {
        problems.push(`${at(tag)}: <${tag.name} ${attr}="javascript:…"> — script in a URL`);
      }
    }

    // ── where a link may send someone ────────────────────────────
    if (tag.name === "a") {
      const href = tag.attrs.href ?? "";
      for (const host of FORBIDDEN_HOSTS) {
        if (href.toLowerCase().includes(host)) {
          problems.push(`${at(tag)}: links to ${host}`);
        }
      }
    }
  }

  return problems;
}

/** Check any text file for strings that should not be published. */
export function checkText(file, text) {
  const problems = [];
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const lower = text.toLowerCase();

  for (const host of FORBIDDEN_HOSTS) {
    const at = lower.indexOf(host);
    if (at !== -1) problems.push(`${file}:${lineOf(at)}: mentions ${host}`);
  }
  for (const [pattern, what] of FORBIDDEN_PATTERNS) {
    const match = pattern.exec(text);
    if (match) problems.push(`${file}:${lineOf(match.index)}: ${what}`);
  }
  return problems;
}

/** Walk a directory and return every file, relative to it. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Check a whole site directory.
 *
 * Returns `{ files, problems }`. An empty `problems` means it is fit to
 * deploy as far as these rules go, which is not the same as correct.
 */
export function checkSite(dir) {
  const problems = [];
  const files = listFiles(dir);

  if (files.length === 0) problems.push(`${dir}: there is nothing to deploy`);

  for (const file of files) {
    if (!ALLOWED_EXTENSIONS.test(file)) {
      problems.push(`${file}: not a static site asset`);
      continue;
    }
    if (!/\.(html|css|svg|yml|yaml|txt|json|xml)$/i.test(file)) continue;

    const text = fs.readFileSync(path.join(dir, file), "utf-8");
    problems.push(...checkText(file, text));
    if (/\.html$/i.test(file)) problems.push(...checkHtml(file, text));
  }

  return { files, problems };
}

// ── run as a program ──────────────────────────────────────────────
const invokedDirectly =
  process.argv[1] !== undefined && /check-site\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));

if (invokedDirectly) {
  const dir = process.argv[2] ?? "site";
  if (!fs.existsSync(dir)) {
    console.error(`check-site: ${dir} does not exist`);
    process.exit(2);
  }

  const { files, problems } = checkSite(dir);

  console.log(`Files to be deployed from ${dir}/:`);
  for (const file of files) console.log(`  ${file}`);
  console.log();

  if (problems.length > 0) {
    console.error(`Refusing to deploy. ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "\nRadio and checkbox inputs outside a form are allowed, because they\n" +
        "collect nothing and submit nowhere. Everything else that could carry\n" +
        "information off the page is not.\n",
    );
    process.exit(1);
  }

  console.log(`Checked ${files.length} file(s). Nothing that collects, tracks, or charges.`);
}
