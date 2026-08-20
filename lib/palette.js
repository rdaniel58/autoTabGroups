// Maps an arbitrary RGB color onto one of Chrome/Brave's nine tab-group colors.
//
// The approach is hue-first in CIELAB. Straight Lab/ΔE distance is dominated by
// lightness, which drags dark brand colors (e.g. a deep purple) onto "blue" and
// pale ones onto "grey". So we compare hue angle as the primary term and let
// lightness break ties with a small weight -- that pairing is what separates
// orange from yellow (near-identical hues, very different L).
//
// Weights and thresholds below were fitted against 63 real brand colors plus
// CSS edge cases (navy, olive, beige, slate, mint, salmon...). See README.

// Every Chromium browser accepts the same nine color NAMES -- verified by
// calling tabGroups.update() with each; anything else (gray, teal, magenta...)
// is rejected outright. What differs is the color each name gets PAINTED.
//
// Edge does not merely paint softer versions of Chrome's hues: it paints "red"
// as an orchid and "green" as a steel blue. Matching against Chrome's values
// there would name a red icon "red" and hand the user a purple tab group, so
// the palette has to follow the browser.
export const PALETTES = {
  // Chromium's GM2 values, as painted by Chrome and Brave.
  chrome: {
    grey:   [0x5f, 0x63, 0x68],
    blue:   [0x1a, 0x73, 0xe8],
    red:    [0xd9, 0x30, 0x25],
    yellow: [0xf9, 0xab, 0x00],
    green:  [0x1e, 0x8e, 0x3e],
    pink:   [0xd0, 0x18, 0x84],
    purple: [0x93, 0x34, 0xe6],
    cyan:   [0x00, 0x7b, 0x83],
    orange: [0xfa, 0x90, 0x3e],
  },
  // Sampled from Edge 151 in dark mode by creating one group per name and
  // reading the pixels back. See README -- a themed Edge may differ.
  edge: {
    grey:   [0x84, 0x81, 0x7e],
    blue:   [0x75, 0x9f, 0xf8],
    red:    [0xcc, 0x88, 0xd9],
    yellow: [0xbd, 0xa3, 0x5a],
    green:  [0x56, 0x88, 0xb9],
    pink:   [0xe7, 0x64, 0xb7],
    purple: [0xb7, 0x96, 0xfd],
    cyan:   [0x5d, 0xb3, 0xb6],
    orange: [0xd9, 0x90, 0x67],
  },
};

// Chrome's "red" swatch (#D93025) sits at hue 36.8 deg, which is already
// orange-leaning; using it directly puts the red/orange decision boundary at
// ~48 deg and swallows genuinely orange brands (Reddit's #FF4500, terracottas).
// The matching anchor is pulled to where the *name* red stops reading as orange.
// Edge needs no such nudge -- its palette is measured, not designed around names.
const MATCH_HUE_OVERRIDES = {
  chrome: { red: 28.0 },
  edge: {},
};

/** Which browser is painting our tab groups. */
export function detectPalette() {
  try {
    const brands = globalThis.navigator?.userAgentData?.brands;
    if (Array.isArray(brands) && brands.some((b) => b.brand === "Microsoft Edge")) {
      return "edge";
    }
    if (/\bEdg\//.test(globalThis.navigator?.userAgent ?? "")) return "edge";
  } catch {
    // Nothing to detect with; Chrome's palette is the safe default.
  }
  return "chrome"; // Chrome, Brave, and any other Chromium using stock colors
}

export const ACTIVE_PALETTE = detectPalette();

/** The nine colors as this browser paints them. */
export function groupSwatches(palette = ACTIVE_PALETTE) {
  return PALETTES[palette] ?? PALETTES.chrome;
}

// Below this chroma nothing reads as a color -- black, white and grey icons.
const NEUTRAL_CHROMA = 12;
// Very light and only faintly tinted (beige, cream, off-white) is also grey.
const PALE_LIGHTNESS = 88;
const PALE_CHROMA = 16;
// Relative weight of the lightness term against the hue term.
const LIGHTNESS_WEIGHT = 0.30;

function srgbToLab([r, g, b]) {
  const lin = (v) => {
    v /= 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  // D65 white point.
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** @returns {{L: number, C: number, h: number}} lightness, chroma, hue in degrees. */
export function toLch(rgb) {
  const [L, a, b] = srgbToLab(rgb);
  return { L, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
}

const anchorCache = new Map();

function anchorsFor(palette) {
  if (!anchorCache.has(palette)) {
    const overrides = MATCH_HUE_OVERRIDES[palette] ?? {};
    anchorCache.set(palette, Object.entries(groupSwatches(palette))
      .filter(([name]) => name !== "grey") // grey is only reachable via the neutral tests
      .map(([name, rgb]) => {
        const { L, h } = toLch(rgb);
        return { name, L, h: overrides[name] ?? h };
      }));
  }
  return anchorCache.get(palette);
}

function hueDistance(a, b) {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}

/**
 * True when a color carries no usable hue -- black, white, grey, or a tint so
 * faint it would be dishonest to call it a color. Icon sampling uses this to
 * tell "this icon has a brand color" from "this icon is a white glyph", so the
 * two must stay in agreement; keep this the single definition of neutral.
 * @param {[number, number, number]} rgb
 */
export function isNeutral(rgb) {
  const { L, C } = toLch(rgb);
  return C < NEUTRAL_CHROMA || (L > PALE_LIGHTNESS && C < PALE_CHROMA);
}

/**
 * Pick the tab-group color name whose *painted* result best represents `rgb`
 * in the browser we are running in.
 * @param {[number, number, number]} rgb
 * @param {string} [palette] override for tests
 * @returns {"grey"|"blue"|"red"|"yellow"|"green"|"pink"|"purple"|"cyan"|"orange"}
 */
export function nearestGroupColor(rgb, palette = ACTIVE_PALETTE) {
  if (isNeutral(rgb)) return "grey";
  const { L, h } = toLch(rgb);

  let best = "grey";
  let bestScore = Infinity;
  for (const anchor of anchorsFor(palette)) {
    const score = hueDistance(h, anchor.h) / 180
      + LIGHTNESS_WEIGHT * (Math.abs(L - anchor.L) / 100);
    if (score < bestScore) {
      bestScore = score;
      best = anchor.name;
    }
  }
  return best;
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, "0")).join("");
}
