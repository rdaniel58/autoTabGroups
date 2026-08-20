// Finds the best available icon for a page and extracts its dominant color.

import { isNeutral } from "./palette.js";

const ANALYSIS_MAX = 64;      // longest edge we rasterize to
const CENTER_BIAS = 0.45;     // how much edge pixels are discounted
const HUE_BUCKETS = 24;       // 15 degrees each
const CHROMATIC_SAT = 0.18;   // saturation at which a pixel counts as colored
const CHROMATIC_FLOOR = 0.06; // below this share of colored pixels, call it neutral
const MAX_ICON_ATTEMPTS = 6;  // bound the fetches when a site has many icons

/**
 * Runs in the page. Reports every icon the document declares plus the names the
 * site uses for itself. Must be self-contained -- it is injected, not imported.
 */
function scrapeIdentity() {
  const icons = [];
  let manifest = null;

  for (const link of document.querySelectorAll("link[rel]")) {
    const rels = (link.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    if (rels.includes("manifest")) {
      manifest = link.href || null;
      continue;
    }
    // mask-icon is deliberately absent: Safari pinned-tab icons are monochrome
    // by specification, so they can only ever report a color the site does
    // not actually use.
    const isIcon = rels.some((r) => r === "icon" || r === "shortcut"
      || r === "apple-touch-icon" || r === "apple-touch-icon-precomposed"
      || r === "fluid-icon");
    if (!isIcon || !link.href) continue;

    let size = 0;
    const sizes = (link.getAttribute("sizes") || "").toLowerCase();
    if (sizes === "any") {
      size = 1024;
    } else {
      for (const m of sizes.matchAll(/(\d+)x(\d+)/g)) size = Math.max(size, Number(m[1]));
    }
    if (!size) {
      const m = link.href.match(/(\d{2,4})x\1/); // .../icon-192x192.png
      if (m) size = Number(m[1]);
    }
    icons.push({ url: link.href, size, type: (link.getAttribute("type") || "").toLowerCase() });
  }

  const meta = (n) => {
    const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    const v = el && el.getAttribute("content");
    return v ? v.trim() : null;
  };
  const names = [
    meta("og:site_name"),
    meta("apple-mobile-web-app-title"),
    meta("application-name"),
  ].filter(Boolean);

  return { icons, manifest, names };
}

async function scrapeTab(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeIdentity,
    });
    return result?.result ?? null;
  } catch {
    // Restricted page, still loading, or no host permission -- fall back to
    // whatever the tab itself already told us.
    return null;
  }
}

async function readManifest(manifestUrl) {
  try {
    const res = await fetch(manifestUrl, { credentials: "omit" });
    if (!res.ok) return null;
    const json = await res.json();
    const icons = (Array.isArray(json.icons) ? json.icons : [])
      // A "monochrome" icon is a single-color glyph on transparency by
      // specification -- it says nothing about the brand color. These are
      // often the largest icons a manifest offers (YouTube ships a 512px one),
      // so left in they outrank every real icon and sample as pure white.
      .filter((icon) => {
        const purposes = String(icon.purpose || "any").toLowerCase().split(/\s+/);
        return !purposes.includes("monochrome") || purposes.includes("any");
      })
      .map((icon) => {
        let size = 0;
        for (const m of String(icon.sizes || "").matchAll(/(\d+)x(\d+)/g)) {
          size = Math.max(size, Number(m[1]));
        }
        return {
          url: new URL(icon.src, manifestUrl).href,
          size,
          type: String(icon.type || "").toLowerCase(),
        };
      });
    const names = [json.short_name, json.name].filter((n) => typeof n === "string");
    return { icons, names };
  } catch {
    return null;
  }
}

function isVector(candidate) {
  return candidate.type.includes("svg") || /\.svg(\?|#|$)/i.test(candidate.url);
}

/**
 * Order icons best-first. Bigger is better up to a point -- past ~256px we are
 * just downloading more bytes for the same colors. SVGs go last because
 * createImageBitmap cannot rasterize them inside a service worker.
 */
function rankCandidates(candidates) {
  const seen = new Set();
  return candidates
    .filter((c) => {
      if (!c.url || seen.has(c.url)) return false;
      if (!/^https?:/i.test(c.url) && !c.url.startsWith("data:")) return false;
      seen.add(c.url);
      return true;
    })
    .map((c) => ({ ...c, vector: isVector(c) }))
    .sort((a, b) => {
      if (a.vector !== b.vector) return a.vector ? 1 : -1;
      return Math.min(b.size || 16, 256) - Math.min(a.size || 16, 256);
    });
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
}

/**
 * Weighted-histogram dominant color.
 *
 * Icons are mostly one brand color plus white/black/transparent scaffolding, so
 * pixels are weighted by alpha, saturation and distance from center, with near-
 * white and near-black heavily discounted. The winning hue bucket -- plus its two
 * neighbors, so a color straddling a boundary is not split -- is then averaged.
 */
function analyzePixels(data, size, lenient) {
  const center = (size - 1) / 2;
  const buckets = new Array(HUE_BUCKETS).fill(null).map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
  const neutral = { w: 0, r: 0, g: 0, b: 0 };
  let totalW = 0;
  let chromaticW = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = data[i + 3] / 255;
      if (a < 0.5) continue;

      const r = data[i], g = data[i + 1], b = data[i + 2];
      const { h, s, v } = rgbToHsv(r, g, b);

      const dx = (x - center) / (center || 1);
      const dy = (y - center) / (center || 1);
      const radial = 1 - CENTER_BIAS * Math.min(1, Math.hypot(dx, dy));

      let w = a * radial * (0.25 + 0.75 * s);
      if (!lenient) {
        if (v > 0.94 && s < 0.10) w *= 0.05; // paper white
        if (v < 0.12) w *= 0.05;             // black ink / outlines
      }
      if (w <= 0) continue;

      totalW += w;
      if (s >= CHROMATIC_SAT && v >= 0.12) {
        chromaticW += w;
        const bucket = buckets[Math.min(HUE_BUCKETS - 1, Math.floor(h / (360 / HUE_BUCKETS)))];
        bucket.w += w; bucket.r += r * w; bucket.g += g * w; bucket.b += b * w;
      } else {
        neutral.w += w; neutral.r += r * w; neutral.g += g * w; neutral.b += b * w;
      }
    }
  }

  if (totalW === 0) return null;

  const average = (acc) => [acc.r / acc.w, acc.g / acc.w, acc.b / acc.w];

  if (chromaticW / totalW < CHROMATIC_FLOOR) {
    // Monochrome icon (GitHub, Apple, Notion...). Return its actual grey/black
    // so the matcher neutral test decides, rather than guessing a hue.
    return neutral.w > 0 ? average(neutral) : null;
  }

  // Smooth across neighboring buckets before picking the winner.
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < HUE_BUCKETS; i++) {
    const prev = buckets[(i - 1 + HUE_BUCKETS) % HUE_BUCKETS].w;
    const next = buckets[(i + 1) % HUE_BUCKETS].w;
    const score = buckets[i].w + 0.5 * (prev + next);
    if (score > bestScore) { bestScore = score; bestIndex = i; }
  }

  const merged = { w: 0, r: 0, g: 0, b: 0 };
  for (const offset of [-1, 0, 1]) {
    const acc = buckets[(bestIndex + offset + HUE_BUCKETS) % HUE_BUCKETS];
    merged.w += acc.w; merged.r += acc.r; merged.g += acc.g; merged.b += acc.b;
  }
  return merged.w > 0 ? average(merged) : null;
}

/** Fetch one icon and reduce it to a single RGB triple. Throws on failure. */
export async function dominantColorOf(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("empty icon");

  const bitmap = await createImageBitmap(blob);
  try {
    const size = Math.max(8, Math.min(ANALYSIS_MAX, Math.max(bitmap.width, bitmap.height)));
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // Nearest-neighbor: interpolation would invent colors that appear in the
    // icon nowhere, which is what a dominant-color histogram must not see.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const rgb = analyzePixels(data, size, false) ?? analyzePixels(data, size, true);
    if (!rgb) throw new Error("no usable pixels");
    return rgb.map((v) => Math.round(v));
  } finally {
    bitmap.close();
  }
}

/**
 * Work down the ranked icons until one actually yields a color.
 *
 * Decoding an icon is not the same as learning a color from it. Plenty of
 * sites serve a white-glyph-on-transparent icon that decodes perfectly and
 * reports pure white; accepting the first icon that merely loads is how
 * YouTube ends up grey. So keep going until an icon has a hue, and fall back to
 * a neutral reading only if nothing chromatic turns up -- that fallback is what
 * still sends genuinely monochrome brands like GitHub to grey.
 *
 * @param {{url: string, size: number, type: string}[]} candidates
 * @returns {Promise<{rgb: number[], iconUrl: string}|null>}
 */
export async function bestColorFrom(candidates) {
  let neutralFallback = null;

  for (const candidate of rankCandidates(candidates).slice(0, MAX_ICON_ATTEMPTS)) {
    let rgb;
    try {
      rgb = await dominantColorOf(candidate.url);
    } catch {
      continue; // unreachable, undecodable, or a soft-404 HTML body
    }
    if (!isNeutral(rgb)) return { rgb, iconUrl: candidate.url };
    if (!neutralFallback) neutralFallback = { rgb, iconUrl: candidate.url };
  }

  return neutralFallback;
}

/**
 * Everything we can learn about a site from its page and its icon.
 * @returns {Promise<{rgb: number[], iconUrl: string, names: string[]}|null>}
 */
export async function resolveSiteIdentity(tab, site) {
  const scraped = await scrapeTab(tab.id);
  const names = [...(scraped?.names ?? [])];
  const candidates = [...(scraped?.icons ?? [])];

  if (scraped?.manifest) {
    const manifest = await readManifest(scraped.manifest);
    if (manifest) {
      candidates.push(...manifest.icons);
      names.push(...manifest.names);
    }
  }

  // Conventional locations, as a backstop for pages that declare nothing.
  if (tab.favIconUrl) candidates.push({ url: tab.favIconUrl, size: 0, type: "" });
  candidates.push({ url: `${site.origin}/apple-touch-icon.png`, size: 180, type: "" });
  candidates.push({ url: `${site.origin}/favicon.ico`, size: 0, type: "" });

  const best = await bestColorFrom(candidates);
  return best ? { ...best, names } : null;
}
