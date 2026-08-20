# Auto Tab Groups

A Chrome/Brave extension that files every tab into a tab group named after the
site in its URL, and colours that group with the site's own icon colour.

`https://www.youtube.com/watch?v=…` → a group called **YouTube**, coloured red,
because that is what YouTube's favicon is.

Two rules drive the whole design:

- **Nothing is hardcoded.** There is no list of known sites anywhere in this
  repository. Group names are parsed out of the URL; group colours are sampled
  from the icon the site itself serves. It works the same on a site nobody has
  ever heard of as it does on YouTube.
- **There is no default colour.** If the icon cannot be read, the tab is left
  ungrouped and the site is listed under *Icon unreadable* in the popup. A
  wrong colour is worse than no group, so the extension never guesses.

## Install

Not on the Web Store — load it unpacked:

1. Clone or download this repository.
2. Open `chrome://extensions` (or `brave://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder (the one with `manifest.json`).
5. Click the extension's toolbar icon, then **Group all tabs**.

New tabs are grouped as you browse. Requires Chrome/Brave 116 or newer.

## How the group name is derived

The hostname is reduced to its registrable domain and named after that domain's
own label:

| URL | Parsed from URL | Final group |
| --- | --- | --- |
| `https://www.youtube.com/watch?v=…` | Youtube | YouTube ¹ |
| `https://music.youtube.com/…` | Youtube | YouTube ¹ |
| `https://stackoverflow.com/q/1` | Stackoverflow | Stack Overflow ¹ |
| `https://news.ycombinator.com/` | Ycombinator | Ycombinator |
| `https://www.example.co.uk/` | Example | Example |
| `https://my-cool-site.dev/` | My Cool Site | My Cool Site |
| `http://localhost:3000/` | Localhost | Localhost |
| `http://192.168.1.10:8080/` | 192.168.1.10 | 192.168.1.10 |

¹ Capitalisation corrected by the site itself — see below. Sites that declare
no name for themselves keep the URL-derived spelling.

Multi-label public suffixes (`co.uk`, `com.au`, `ne.jp`, …) are handled by a
small table of *TLD grammar* in `lib/site.js`. That table lists generic
second-level labels like `co` and `gov`; it never names an actual website.

### Capitalisation

A URL only ever gives you `youtube`, so plain title-casing would yield
"Youtube". After the name is parsed, the extension checks what the site calls
itself — `og:site_name`, `apple-mobile-web-app-title`, `application-name`, and
the web app manifest's `short_name`/`name` — and adopts that spelling **only if
it is the same word**:

- `youtube` + `"YouTube"` → **YouTube** ✅
- `stackoverflow` + `"Stack Overflow"` → **Stack Overflow** ✅
- `google` + `"Google Search"` → **Google** (rejected, not the same word)

So the identity always comes from the URL; the site is only allowed to fix its
own capitalisation and spacing.

## How the colour is chosen

1. **Collect the candidate icons.** The page is asked for every
   `<link rel="icon">`, `apple-touch-icon` and web app manifest icon it
   declares, plus `/apple-touch-icon.png` and `/favicon.ico` as a backstop for
   pages that declare nothing. They are ranked largest-first: a 180px app icon
   carries far more colour information than the 16px favicon the tab strip
   shows.

   Two kinds are dropped before ranking, because both are single-colour by
   specification and can only ever report a colour the site does not use:
   manifest icons marked `"purpose": "monochrome"`, and Safari's `mask-icon`.

2. **Extract the dominant colour.** The icon is rasterised with
   nearest-neighbour sampling (interpolation would invent colours the icon does
   not contain) and run through a weighted hue histogram. Pixels are weighted by
   alpha, saturation and distance from centre; near-white and near-black are
   discounted 20× so that page-white padding and black outlines do not win. The
   heaviest hue bucket and its two neighbours are averaged — merging the
   neighbours keeps a colour that straddles a bucket boundary from being split.

   Icons that are genuinely monochrome fall through to their actual grey/black
   rather than having a hue invented for them.

3. **Keep going until an icon actually has a colour.** Decoding an icon is not
   the same as learning something from it — a white glyph on transparency
   decodes perfectly and reports pure white. So a colourless reading does not
   end the search; the next candidate is tried, and a neutral result is only
   accepted once nothing chromatic turns up. That last part is what still sends
   genuinely monochrome brands to grey.

4. **Snap to the nearest tab-group colour.** Chrome offers exactly nine: grey,
   blue, red, yellow, green, pink, purple, cyan, orange.

The matching in step 4 is hue-first in CIELAB. Straight ΔE distance is dominated
by lightness, which is what drags dark brand purples onto "blue" and pale tints
onto "grey". Instead hue angle is the primary term and lightness breaks ties at
0.30 weight — that pairing is what separates orange from yellow, whose hues are
nearly identical but whose lightnesses are not.

Two calibration notes, both in `lib/palette.js`:

- Chroma below 12 is treated as neutral → grey. Very light and barely tinted
  (L > 88, chroma < 16) is also grey. This is what sends GitHub, Apple and
  Notion to grey instead of to an arbitrary hue.
- Chrome's `red` swatch (`#D93025`) already sits at hue 36.8°, which is
  orange-leaning. Using it directly puts the red/orange boundary at ~48° and
  swallows genuinely orange brands. The *matching anchor* for red is pulled to
  28°, where the name "red" stops reading as orange. The swatch Chrome paints is
  unchanged — only the decision boundary moves.

These weights were fitted against 63 real brand colours plus CSS edge cases
(navy, olive, beige, slate, mint, salmon, brown, indigo). 62 of 63 land on the
colour a person would pick; the lone holdout is Discord's blurple `#5865F2`,
which lands on blue rather than purple and is arguable either way.

## Settings

Open the popup from the toolbar icon.

| Setting | Default | What it does |
| --- | --- | --- |
| **On** | on | Master switch. |
| **Group by** | Domain | `Domain` puts docs.google.com and mail.google.com both in **Google**. `Subdomain` gives them **Docs · Google** and **Mail · Google**. |
| **Minimum tabs per group** | 1 | Raise to 2 or 3 to stop one-off tabs from each getting their own group. Groups that fall below the minimum are dissolved automatically. |
| **Leave tabs in groups I made by hand** | off | When on, a tab you dragged into your own group is left alone. |

The popup also lists every site learned so far. Each row shows the group colour
as a swatch with the raw sampled icon colour flagged in its corner, so you can
see both what was read and what it snapped to. Hover for the hex value. Press
**×** on a row to forget one site, or **Re-sample icons** to forget all of them
and read every icon again — useful after a site rebrands.

Pinned tabs are never touched.

## If a group is the wrong colour

Colours are learned once per site and cached, so a bad reading sticks until you
clear it. Press **×** on that site in the popup, or **Re-sample icons** to redo
all of them.

The popup row shows both the raw hex that was sampled and the group colour it
snapped to, which tells you which half is wrong: if the hex does not look like
the site's brand, the wrong icon was picked; if the hex looks right but the
group colour does not, the matching thresholds in `lib/palette.js` are at fault.

Upgrading the extension clears the cache automatically — `CACHE_VERSION` in
`lib/store.js` is bumped whenever sampling changes, so you never have to know to
re-sample after an update.

## Layout

```
manifest.json        MV3 manifest
background.js        service worker: events, grouping, the serial work queue
lib/site.js          URL → group identity (no site list, TLD grammar only)
lib/palette.js       CIELAB hue matching onto Chrome's nine group colours
lib/icon.js          icon discovery + dominant-colour extraction
lib/store.js         settings and the learned-colour cache
popup/               toolbar UI
test/                browser-run test pages
```

Group mutations all funnel through one serial promise chain in `background.js`.
Without it, two tabs of the same site arriving together each create their own
group and you end up with duplicates.

## Tests

The tests are plain pages that import the real modules, so they need to be
served over HTTP (ES modules will not load over `file://`):

```bash
python -m http.server 8731
```

Then open:

- <http://127.0.0.1:8731/test/units.html> — URL parsing, title refinement and
  colour matching (58 checks).
- <http://127.0.0.1:8731/test/icons.html> — the full icon pipeline against
  synthetic favicons: brand-on-white, glyph-on-transparent, monochrome,
  antialiased edges, and the two failure cases that must stay ungrouped.
- <http://127.0.0.1:8731/test/selection.html> — which icon gets picked out of a
  candidate list, including the regression for a large monochrome icon
  outranking the branded one.

Both print `ALL PASS` when green. Regenerate the fixtures with
`python test/make-fixtures.py` (standard library only).

To run them headless:

```bash
chrome --headless=new --dump-dom --virtual-time-budget=30000 \
  http://127.0.0.1:8731/test/units.html
```

## Permissions

| Permission | Why |
| --- | --- |
| `tabs`, `tabGroups` | Read tab URLs and create/update groups. |
| `storage` | Remember learned colours so icons are not re-fetched constantly. |
| `scripting` | Read `<link rel="icon">` and the site's own name from the page. |
| `http://*/*`, `https://*/*` | Fetch icon files and web app manifests. |

Everything stays on your machine. Nothing is sent anywhere, and no analytics are
collected. Icon fetches go to the sites you are already visiting, with
`credentials: "omit"` so no cookies ride along.

## Licence

MIT — see [LICENSE](LICENSE).
