// Derives a group identity purely from a URL. There is no list of known sites
// anywhere in this extension -- everything below is generic URL/TLD grammar.

// A two-letter country-code TLD preceded by one of these generic labels forms a
// multi-label public suffix: co.uk, com.au, ne.jp, gov.in, com.br, co.za...
// This is TLD structure, not a site list -- it never names an actual website.
const CC_SECOND_LEVEL = new Set([
  "ac", "biz", "co", "com", "edu", "firm", "gen", "go", "gov", "govt", "gr",
  "ind", "info", "int", "mil", "ne", "net", "nic", "nom", "or", "org", "plc",
  "res", "sch", "store", "web",
]);

// Subdomains that carry no identity of their own.
const NOISE_SUBDOMAINS = new Set(["www", "www1", "www2", "m", "mobile", "en", "app"]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpLiteral(host) {
  return IPV4.test(host) || host.includes(":") || host.startsWith("[");
}

/** "stack-overflow" -> "Stack Overflow", "t3" -> "T3" */
function titleCase(label) {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** How many trailing labels make up the public suffix for this host. */
function suffixLength(labels) {
  if (labels.length >= 3
    && labels[labels.length - 1].length === 2
    && CC_SECOND_LEVEL.has(labels[labels.length - 2])) {
    return 2;
  }
  return 1;
}

/**
 * @param {string} url
 * @param {{granularity?: "domain"|"subdomain"}} [opts]
 * @returns {{key: string, title: string, host: string, origin: string, domain: string}|null}
 *   null when the URL is not a groupable web page (chrome://, about:, files...).
 */
export function siteFor(url, opts = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;

  // IPs and single-label hosts (localhost, intranet names) are their own identity.
  if (isIpLiteral(host)) {
    return { key: host, title: host, host, origin: u.origin, domain: host };
  }
  const labels = host.split(".");
  if (labels.length === 1) {
    return { key: host, title: titleCase(host), host, origin: u.origin, domain: host };
  }

  const sufLen = suffixLength(labels);
  let nameIndex = labels.length - sufLen - 1;
  // Under a multi-label suffix the identifying label can itself be noise --
  // www.gov.uk registers as "www" under the gov.uk suffix. Step outwards so the
  // group is named "Gov" rather than "Www".
  while (nameIndex >= 0 && nameIndex < labels.length - 2
    && NOISE_SUBDOMAINS.has(labels[nameIndex])) {
    nameIndex += 1;
  }
  if (nameIndex < 0) {
    // Host *is* a public suffix (rare, e.g. someone browsing "co.uk").
    return { key: host, title: titleCase(labels[0]), host, origin: u.origin, domain: host };
  }

  const name = labels[nameIndex];
  const domain = labels.slice(nameIndex).join(".");

  if (opts.granularity === "subdomain") {
    const subs = labels.slice(0, nameIndex).filter((l) => !NOISE_SUBDOMAINS.has(l));
    if (subs.length) {
      const leaf = subs[subs.length - 1];
      return {
        key: host,
        title: `${titleCase(leaf)} · ${titleCase(name)}`,
        host,
        origin: u.origin,
        domain,
      };
    }
  }

  // Default: one group per registrable domain, named after the domain's own label.
  // amazon.com and amazon.de both land on "Amazon"; that is intentional.
  return { key: name, title: titleCase(name), host, origin: u.origin, domain };
}

/** Strip everything but letters and digits, lowercased. */
function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Let a site correct the *capitalization and spacing* of the name we parsed out
 * of its URL -- "youtube" -> "YouTube", "stackoverflow" -> "Stack Overflow".
 * A candidate is only accepted when it is the same word: og:site_name of
 * "Google Search" is rejected for google.com, leaving the URL-derived "Google".
 *
 * @param {string} urlTitle title derived from the URL
 * @param {string[]} candidates names the page declares about itself
 */
export function refineTitle(urlTitle, candidates = []) {
  const target = normalize(urlTitle);
  if (!target) return urlTitle;
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const candidate = raw.trim().replace(/\s+/g, " ");
    if (!candidate || candidate.length > 32) continue;
    if (normalize(candidate) === target) return candidate;
  }
  return urlTitle;
}
