/**
 * The landing page's promises, asserted rather than trusted.
 *
 * A marketing page is the easiest artefact in a project to quietly degrade.
 * Analytics get added "just to see how it's doing". A testimonial appears
 * because someone said something nice in an email. An accuracy guarantee
 * creeps into a sentence because it reads better. A payment button gets
 * wired before the refund policy is real.
 *
 * Every one of those would be a small edit to one HTML file that no other
 * test in this repository would notice. So the page's claims are tested like
 * any other behaviour.
 *
 * These assertions are deliberately about *absence*. Design can change
 * freely; the promises cannot.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";

const html = fs.readFileSync("site/index.html", "utf-8");
const statusHtml = fs.readFileSync("site/status.html", "utf-8");
const css = fs.readFileSync("site/styles.css", "utf-8");

/** The page with HTML comments removed — what a visitor actually gets. */
const strip = (page: string) => page.replace(/<!--[\s\S]*?-->/g, "");
const visible = strip(html);
const statusVisible = strip(statusHtml);
/** Both pages together: a disclosure may live on either one. */
const site = `${visible}
${statusVisible}`;

/**
 * References that make the browser fetch something while rendering.
 *
 * Distinguished from `<a href>`, which is somewhere a visitor may choose to
 * go. The privacy promise is about requests the page makes on its own, not
 * about whether it is allowed to link anywhere — and since the site now
 * links to the repository and the package, conflating the two would force
 * the promise to be weakened to accommodate an ordinary hyperlink.
 */
const RESOURCE_TAG =
  /<(link|script|img|iframe|source|video|audio|embed|object|track)\b([^>]*)>/gi;
const REF_ATTR = /\b(?:src|href|data|srcset|poster)=["']([^"']+)["']/i;

const externalResources = (page: string): string[] => {
  const found: string[] = [];
  for (const [, tag, attrs] of page.matchAll(RESOURCE_TAG)) {
    // `<link rel="canonical">` states this page's own address. It is
    // metadata and fetches nothing, unlike `rel="stylesheet"` or
    // `rel="preconnect"`, which stay covered.
    if (tag.toLowerCase() === "link" && /\brel=["']canonical["']/i.test(attrs)) continue;
    const ref = REF_ATTR.exec(attrs);
    if (ref && /^(?:https?:)?\/\//i.test(ref[1])) found.push(ref[1]);
  }
  return found;
};

/** Hosts a visitor may be sent to, and nowhere else. */
const ALLOWED_LINK_HOSTS = ["github.com", "www.npmjs.com"];

const outboundLinks = (page: string): string[] =>
  [...page.matchAll(/<a\b[^>]*?\bhref=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);

describe("nothing third-party", () => {
  it("loads no external resource on the status page either", () => {
    expect(externalResources(statusVisible)).toEqual([]);
    expect(statusVisible).not.toMatch(/<script/i);
  });

  it("loads no external resource", () => {
    // No webfont, no CDN, no analytics, no stock photo. A page whose selling
    // point is that the tool sends nothing should not phone four hosts to
    // render a heading. The favicon is a data: URI for the same reason.
    expect(externalResources(visible)).toEqual([]);
  });

  it("sends visitors only to the repository and the package", () => {
    for (const page of [visible, statusVisible]) {
      for (const link of outboundLinks(page)) {
        const host = new URL(link).host;
        expect(ALLOWED_LINK_HOSTS, `outbound link to ${host}`).toContain(host);
      }
    }
  });

  it("links to the repository and the package, now that both are live", () => {
    expect(visible).toContain("https://github.com/atmospherichitman/docfacts");
    expect(visible).toContain("https://www.npmjs.com/package/docfacts");
  });

  it("runs no script", () => {
    expect(visible).not.toMatch(/<script/i);
    expect(visible).not.toMatch(/\son\w+\s*=/i); // no inline handlers either
  });

  it("imports nothing in the stylesheet", () => {
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
  });

  it("has no analytics or tracking identifiers", () => {
    for (const tracker of [
      "google-analytics",
      "googletagmanager",
      "gtag(",
      "plausible",
      "fathom",
      "segment",
      "mixpanel",
      "hotjar",
      "posthog",
      "clarity.ms",
      "facebook.net",
      "doubleclick",
    ]) {
      expect(html.toLowerCase(), tracker).not.toContain(tracker);
    }
  });

  it("submits no form and embeds no image or iframe", () => {
    expect(visible).not.toMatch(/<form/i);
    expect(visible).not.toMatch(/<iframe/i);
    expect(visible).not.toMatch(/<img/i);
  });
});

describe("no payment path is live", () => {
  it("carries no payment-processor URL at all, commented or not", () => {
    // Stricter than before. The integration-point comment used to carry the
    // placeholder URL as an example, which forced this check to be fuzzy
    // about what counted. With the URL gone, any occurrence is a real one.
    for (const host of ["buy.stripe.com", "checkout.stripe.com", "paypal.com", "gumroad.com", "lemonsqueezy.com", "polar.sh"]) {
      expect(html, `payment host in index.html: ${host}`).not.toContain(host);
      expect(statusHtml, `payment host in status.html: ${host}`).not.toContain(host);
    }
  });

  it("carries no Stripe keys or scripts", () => {
    expect(html).not.toMatch(/pk_(live|test)_/);
    expect(html).not.toMatch(/js\.stripe\.com/);
    expect(html).not.toMatch(/whsec_/);
  });

  it("keeps the integration point marked so it can be found", () => {
    expect(html).toContain("STRIPE PAYMENT LINK INTEGRATION POINT");
  });

  it("leaves the order button inert", () => {
    expect(visible).toMatch(/aria-disabled="true"/);
    expect(css).toMatch(/\.payslot .btn\s*\{[^}]*pointer-events:\s*none/);
  });
});

describe("claims that must not appear", () => {
  it("promises no accuracy guarantee", () => {
    const forbidden = [
      /guarantee[sd]?\s+(?:that\s+)?(?:the\s+)?(?:document|draft|accuracy|correctness)/i,
      /100%\s+accurate/i,
      /never\s+miss(?:es)?\s+a/i,
      /catches?\s+every/i,
      /fully\s+automat(?:ed|ic)\s+accuracy/i,
    ];
    for (const pattern of forbidden) {
      expect(visible, String(pattern)).not.toMatch(pattern);
    }
  });

  it("states the opposite, plainly", () => {
    expect(visible).toMatch(/clean report does not mean/i);
    expect(visible).toMatch(/no accuracy guarantee/i);
  });

  it("claims no customers, counts or endorsements", () => {
    for (const pattern of [
      /trusted by/i,
      /loved by/i,
      /\bjoin \d/i,
      /\d+[,\d]*\+?\s+(?:developers|teams|companies|users)\s+(?:use|trust|love)/i,
      // Not a bare /testimonial/: the status table honestly says
      // "Testimonials — None", and forbidding the word would forbid the
      // disclosure along with the thing.
      /"[^"]{20,}"\s*—\s*\w+/, // a quote attributed to a person
      /says?\s+(?:our|the)\s+(?:customer|user|client)/i,
    ]) {
      expect(visible, String(pattern)).not.toMatch(pattern);
    }
  });

  it("says outright that there are no customers", () => {
    // Moved to status.html in A14, with the homepage linking to it. The
    // disclosure has to exist somewhere a visitor can reach, not
    // necessarily on the first screen.
    expect(site).toMatch(/Nobody has bought anything/i);
    expect(site).toMatch(/no customers to quote/i);
  });

  it("links to the status page from the homepage", () => {
    // A disclosure moved to a page nothing links to has been deleted with
    // extra steps.
    expect(visible).toMatch(/href="status\.html"/);
  });
});

describe("the honest disclosures stay put", () => {
  it("is indexable, now that it is a published site rather than a preview", () => {
    // The noindex that belonged on an undeployed preview would now quietly
    // defeat the only acquisition channel the plan has. Removing it was a
    // deliberate launch decision; restoring it should be one too.
    expect(html).not.toMatch(/<meta\s+name="robots"[^>]*noindex/i);
    expect(statusHtml).not.toMatch(/<meta\s+name="robots"[^>]*noindex/i);
  });

  it("names its own canonical URL under the project subdirectory", () => {
    expect(html).toContain('rel="canonical" href="https://atmospherichitman.github.io/docfacts/"');
  });

  it("labels the service a proposal and the refund policy proposed", () => {
    expect(visible).toMatch(/A proposal, not an offer/i);
    expect(visible).toMatch(/Proposed refund policy/i);
  });

  it("says the price is not validated", () => {
    expect(visible).toMatch(/not validated by any sale|no validated price/i);
  });

  it("discloses AI assistance in the service", () => {
    expect(visible).toMatch(/AI assistance/i);
  });

  it("keeps the limitations section and names the largest gap", () => {
    expect(visible).toMatch(/Missing content isn't checked|Missing content is not checked/i);
    expect(visible).toMatch(/Nothing is executed/i);
    expect(visible).toMatch(/reference is taken as true/i);
  });

  it("admits the tool's own defects found in real-world testing", () => {
    expect(visible).toMatch(/seven defects in DocFacts itself/i);
  });

  it("no longer describes itself as an unpublished local preview", () => {
    for (const stale of [/Local preview/i, /not deployed/i, /not yet published/i, /release candidate/i, /unpublished/i]) {
      expect(site, `stale pre-launch claim: ${stale}`).not.toMatch(stale);
    }
  });

  it("says plainly that the tool is published and the service is not", () => {
    expect(visible).toMatch(/free and published/i);
    expect(site).toMatch(/no payment path/i);
  });

  it("keeps the release-status disclosure on the homepage itself", () => {
    // Summarised there even though the table moved: a visitor who never
    // clicks through still learns the tool is unpublished and unguaranteed.
    expect(visible).toMatch(/Release status/i);
    expect(visible).toMatch(/No accuracy guarantee is offered/i);
    expect(visible).toMatch(/does not exist yet and has no customers/i);
  });

  it("marks the paid service coming soon and keeps payment off", () => {
    expect(visible).toMatch(/Coming soon/i);
    expect(visible).toMatch(/no orders are accepted/i);
  });

  it("keeps the full report reachable without a script", () => {
    // Shortened on the page, with the complete report behind a native
    // <details>. If it had become a button, the page would need JavaScript.
    expect(visible).toMatch(/<details class="full-report">/);
    expect(visible).toMatch(/View the complete report/);
    expect(visible).toMatch(/A clean result does NOT mean/);
  });
});

describe("the demonstration is real output", () => {
  it("shows the finding the tool actually produces for those documents", () => {
    // Produced by running the built CLI against the two documents shown, not
    // written by hand. If the tool's wording changes, this fails and the
    // page gets updated rather than drifting into fiction.
    expect(visible).toContain("unsupported_used");
    expect(visible).toMatch(/the draft presents the flag/);
    expect(visible).toContain("--unsafe-fsync");
    expect(visible).toMatch(/was removed in version 3\.2/);
  });

  it("shows both sides of the contradiction", () => {
    expect(visible).toMatch(/in the draft:/);
    expect(visible).toMatch(/in the reference:/);
  });

  it("keeps the two confidence tiers distinct, as the tool reports them", () => {
    expect(visible).toMatch(/Contradicted by the reference/);
    expect(visible).toMatch(/Not supported by the reference/);
  });
});

describe("structure and accessibility", () => {
  it("has exactly one h1", () => {
    expect([...visible.matchAll(/<h1[\s>]/gi)]).toHaveLength(1);
  });

  it("gives the page a language and a viewport", () => {
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/name="viewport"[^>]*width=device-width/);
  });

  it("marks every decorative svg aria-hidden", () => {
    // Icons that repeat a nearby label are noise to a screen reader.
    //
    // The favicon is an inline data URI containing its own <svg>, which is
    // never reached by a screen reader and cannot carry the attribute.
    const markup = visible.replace(/<link[^>]+data:image\/svg\+xml[^>]*>/gi, "");
    const svgs = [...markup.matchAll(/<svg\b[^>]*>/gi)].map((m) => m[0]);
    expect(svgs.length).toBeGreaterThan(5);
    expect(svgs.filter((s) => !s.includes("aria-hidden"))).toEqual([]);
  });

  it("respects a reduced-motion preference", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("gives interactive elements a visible focus style", () => {
    expect(css).toMatch(/:focus-visible/);
  });

  it("declares its colour scheme so form controls and scrollbars match", () => {
    expect(html).toMatch(/name="color-scheme"/);
  });
});

/**
 * Deployment invariants that travel with the published repository.
 *
 * A companion suite in the development tree additionally asserts that no
 * private term or credential-shaped string reaches the site. That one stays
 * there deliberately: it has to name the terms it looks for, which is
 * exactly what the publication scan refuses to copy.
 */
describe("the site is deployable, and only the site is deployed", () => {
  const siteFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else out.push(full.replace(/^site\//, ""));
      }
    };
    walk("site");
    return out.sort();
  };

  it("publishes exactly the expected files", () => {
    // An allowlist, not a pattern. A new file in a published directory
    // should be a visible decision in a diff.
    expect(siteFiles()).toEqual([
      "assets/example-workflow.yml",
      "index.html",
      "status.html",
      "styles.css",
    ]);
  });

  it("publishes no archive, key, database, environment or backup file", () => {
    const forbidden =
      /\.(zip|tar|tgz|gz|7z|rar|pem|key|p12|pfx|crt|env|sqlite|db|bak|swp|log|map)$/i;
    for (const file of siteFiles()) {
      expect(forbidden.test(file), `must not be published: ${file}`).toBe(false);
    }
  });

  it("uses no root-absolute path", () => {
    // Pages serves this from /docfacts/, not from a domain root. An href of
    // "/styles.css" would resolve to the wrong place and 404 — the one
    // mistake that breaks every page at once.
    for (const [name, page] of [
      ["index.html", html],
      ["status.html", statusHtml],
    ] as const) {
      const absolute = [...page.matchAll(/\b(?:href|src)=["'](\/[^/][^"']*)["']/gi)].map((m) => m[1]);
      expect(absolute, `root-absolute paths in ${name}`).toEqual([]);
    }
  });

  it("links only to files it actually publishes", () => {
    const published = new Set(siteFiles());
    for (const [name, page] of [
      ["index.html", html],
      ["status.html", statusHtml],
    ] as const) {
      for (const [, href] of page.matchAll(/\b(?:href|src)=["']([^"'#][^"']*)["']/gi)) {
        if (/^(?:https?:|data:|mailto:|#)/i.test(href)) continue;
        const target = href.split("#")[0];
        if (target === "") continue;
        expect(published.has(target), `${name} links to ${target}, which is not published`).toBe(true);
      }
    }
  });

  it("sets no cookie and stores nothing in the browser", () => {
    for (const [name, page] of [
      ["index.html", html],
      ["status.html", statusHtml],
      ["styles.css", css],
    ] as const) {
      for (const api of ["document.cookie", "localstorage", "sessionstorage", "indexeddb"]) {
        expect(page.toLowerCase().includes(api), `${api} in ${name}`).toBe(false);
      }
    }
  });
});

describe("the Pages deployment workflow", () => {
  const workflow = ".github/workflows/pages.yml";
  // Present only in the published repository; the development tree keeps its
  // workflows elsewhere.
  const deployed = fs.existsSync(workflow);

  it.runIf(deployed)("grants no write access to the repository", () => {
    const text = fs.readFileSync(workflow, "utf-8");
    // Comments stripped: the file documents why it does *not* take the
    // branch-deployment route, which needs `contents: write`, and that
    // explanation should not read as the thing it rules out.
    const yaml = text
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

    expect(yaml).not.toMatch(/contents:\s*write/);
    expect(yaml).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(yaml).toMatch(/pages:\s*write/);
    expect(yaml).toMatch(/id-token:\s*write/);
  });

  it.runIf(deployed)("uploads only the site directory", () => {
    expect(fs.readFileSync(workflow, "utf-8")).toMatch(
      /upload-pages-artifact@v3[\s\S]*?path:\s*site\s*$/m,
    );
  });

  it.runIf(deployed)("never deploys from a pull request", () => {
    // A deployment triggered by a pull request would publish unreviewed
    // content to the live site.
    expect(fs.readFileSync(workflow, "utf-8")).not.toMatch(/pull_request/);
  });
});
