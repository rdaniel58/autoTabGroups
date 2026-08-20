// Maps an arbitrary RGB colour onto one of Chrome/Brave's nine tab-group colours.
//
// The approach is hue-first in CIELAB. Straight Lab/ΔE distance is dominated by
// lightness, which drags dark brand colours (e.g. a deep purple) onto "blue" and
// pale ones onto "grey". So we compare hue angle as the primary term and let
// lightness break ties with a small weight -- that pairing is what separates
// orange from yellow (near-identical hues, very different L).
//
// Weights and thresholds below were fitted against 63 real brand colours plus
// CSS edge cases (navy, olive, beige, slate, mint, salmon...). See README.

// The colours Chrome/Brave actually paints in the tab strip, sRGB.
export const GROUP_SWATCHES = {
  grey:   [0x5f, 0x63, 0x68],
  blue:   [0x1a, 0x73, 0xe8],
  red:    [0xd9, 0x30, 0x25],
  yellow: [0xf9, 0xab, 0x00],
  green:  [0x1e, 0x8e, 0x3e],
  pink:   [0xd0, 0x18, 0x84],
  purple: [0x93, 0x34, 0xe6],
  cyan:   [0x00, 0x7b, 0x83],
  orange: [0xfa, 0x90, 0x3e],
};

// Chrome's "red" swatch (#D93025) sits at hue 36.8 deg, which is already
// orange-leaning; using it directly puts the red/orange decision boundary at
// ~48 deg and swallows genuinely orange brands (Reddit's #FF4500, terracottas).
// The matching anchor is pulled to where the *name* red stops reading as orange.
const MATCH_HUE_OVERRIDE = { red: 28.0 };

// Below this chroma nothing reads as a colour -- black, white and grey icons.
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

const ANCHORS = Object.entries(GROUP_SWATCHES)
  .filter(([name]) => name !== "grey") // grey is only reachable via the neutral tests
  .map(([name, rgb]) => {
    const { L, h } = toLch(rgb);
    return { name, L, h: MATCH_HUE_OVERRIDE[name] ?? h };
  });

function hueDistance(a, b) {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}

/**
 * True when a colour carries no usable hue -- black, white, grey, or a tint so
 * faint it would be dishonest to call it a colour. Icon sampling uses this to
 * tell "this icon has a brand colour" from "this icon is a white glyph", so the
 * two must stay in agreement; keep this the single definition of neutral.
 * @param {[number, number, number]} rgb
 */
export function isNeutral(rgb) {
  const { L, C } = toLch(rgb);
  return C < NEUTRAL_CHROMA || (L > PALE_LIGHTNESS && C < PALE_CHROMA);
}

/**
 * Pick the tab-group colour name that best represents `rgb`.
 * @param {[number, number, number]} rgb
 * @returns {"grey"|"blue"|"red"|"yellow"|"green"|"pink"|"purple"|"cyan"|"orange"}
 */
export function nearestGroupColor(rgb) {
  if (isNeutral(rgb)) return "grey";
  const { L, h } = toLch(rgb);

  let best = "grey";
  let bestScore = Infinity;
  for (const anchor of ANCHORS) {
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
