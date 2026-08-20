# Auto Tab Groups

A browser extension that files every tab into a tab group named after the site
in its URL, and colors that group with the site's own color.

`https://www.youtube.com/watch?v=…` → a group called **YouTube**, colored red,
because that is what YouTube's favicon is.

Two rules drive the whole design:

- **Nothing is hardcoded.** There is no list of known sites anywhere in this
  repository. Group names are parsed out of the URL; group colors are read from
  what the site itself serves. It works the same on a site nobody has ever heard
  of as it does on YouTube.
- **No color is ever invented.** Colors come from the site's icon, or failing
  that from how the site colors its own header. If neither says anything, the
  tab is left ungrouped and the site is listed under *No color found* in the
  popup, where you can assign a color yourself. A wrong color is worse than no
  group, so the extension never guesses.

## Install

Works in Chrome, Edge and Brave — all Chromium, all the same build. Not on any
store, so load it unpacked:

1. Clone or download this repository.
2. Open `chrome://extensions`, `edge://extensions` or `brave://extensions`.
3. Turn on **Developer mode** (top right in Chrome and Brave, left sidebar in Edge).
4. Click **Load unpacked** and select this folder (the one with `manifest.json`).
5. Click the extension's toolbar icon, then **Group all tabs**.

New tabs are grouped as you browse. Needs Chromium 116 or newer, which means
Chrome/Brave 116+ or Edge 116+.

Firefox is not supported. It has the `tabGroups` API from version 139 and uses
the identical nine color names, but its MV3 background is an event page rather
than a service worker, its promise-based namespace is `browser.*` rather than
`chrome.*`, and host permissions there are opt-in — enough of a difference to
need its own manifest and a compatibility shim.

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

¹ Capitalization corrected by the site itself — see below. Sites that declare
no name for themselves keep the URL-derived spelling.

Multi-label public suffixes (`co.uk`, `com.au`, `ne.jp`, …) are handled by a
small table of *TLD grammar* in `lib/site.js`. That table lists generic
second-level labels like `co` and `gov`; it never names an actual website.

### Capitalization

A URL only ever gives you `youtube`, so plain title-casing would yield
"Youtube". After the name is parsed, the extension checks what the site calls
itself — `og:site_name`, `apple-mobile-web-app-title`, `application-name`, and
the web app manifest's `short_name`/`name` — and adopts that spelling **only if
it is the same word**:

- `youtube` + `"YouTube"` → **YouTube** ✅
- `stackoverflow` + `"Stack Overflow"` → **Stack Overflow** ✅
- `google` + `"Google Search"` → **Google** (rejected, not the same word)

So the identity always comes from the URL; the site is only allowed to fix its
own capitalization and spacing.

## How the color is chosen

1. **Collect the candidate icons.** The page is asked for every
   `<link rel="icon">`, `apple-touch-icon` and web app manifest icon it
   declares, plus `/apple-touch-icon.png` and `/favicon.ico` as a backstop for
   pages that declare nothing. They are ranked largest-first: a 180px app icon
   carries far more color information than the 16px favicon the tab strip
   shows.

   Two kinds are dropped before ranking, because both are single-color by
   specification and can only ever report a color the site does not use:
   manifest icons marked `"purpose": "monochrome"`, and Safari's `mask-icon`.

2. **Extract the dominant color.** The icon is rasterized with
   nearest-neighbor sampling (interpolation would invent colors the icon does
   not contain) and run through a weighted hue histogram. Pixels are weighted by
   alpha, saturation and distance from center; near-white and near-black are
   discounted 20× so that page-white padding and black outlines do not win. The
   heaviest hue bucket and its two neighbors are averaged — merging the
   neighbors keeps a color that straddles a bucket boundary from being split.

   Icons that are genuinely monochrome fall through to their actual grey/black
   rather than having a hue invented for them.

3. **Keep going until an icon actually has a color.** Decoding an icon is not
   the same as learning something from it — a white glyph on transparency
   decodes perfectly and reports pure white. So a colorless reading does not
   end the search; the next candidate is tried, and a neutral result is only
   accepted once nothing chromatic turns up. That last part is what still sends
   genuinely monochrome brands to grey.

4. **Fall back to how the site colors itself.** Internal tools, dashboards and
   login pages routinely ship no usable favicon while still having a clearly
   branded header bar. When no icon yields a color, the page is asked for its
   `<meta name="theme-color">` and then for the background of its masthead —
   `header`, `[role="banner"]`, `.navbar`, `nav` and similar, matched
   structurally, never by site name. An element only counts as a masthead if it
   sits at the top of the page, spans it, and is a bar rather than a full-page
   panel; a transparent one resolves to the first painted ancestor behind it.

   The body background is pointedly *not* consulted. An unstyled page computes
   to transparent and a styled white one to white, so using it would hand out
   grey based on nothing more than whether the site bothered to set a
   background. Those sites are better served by the popup's *No color found*
   list, where you can assign a color yourself.

5. **Snap to the nearest tab-group color.** Chromium offers exactly nine: grey,
   blue, red, yellow, green, pink, purple, cyan, orange. That list is a hard
   limit -- `tabGroups.update()` rejects every other name, `gray` included, and
   there is no custom-color option. Nine is all anyone gets.

The matching in step 5 is hue-first in CIELAB. Straight ΔE distance is dominated
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

These weights were fitted against 63 real brand colors plus CSS edge cases
(navy, olive, beige, slate, mint, salmon, brown, indigo). 62 of 63 land on the
color a person would pick; the lone holdout is Discord's blurple `#5865F2`,
which lands on blue rather than purple and is arguable either way.

The nine RGB values are the swatches Chrome paints. Edge paints slightly
different shades for the same nine names, which changes nothing functionally —
only a name is ever sent to the browser — but the calibration above was fitted
against Chrome's numbers.

## The popup

Open it from the toolbar icon. **Group all tabs** files everything open right
now; **Re-sample icons** starts the colors over from scratch.

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| **On** | on | Master switch. |
| **Group by** | Domain | `Domain` puts docs.google.com and mail.google.com both in **Google**. `Subdomain` gives them **Docs · Google** and **Mail · Google**. |
| **Minimum tabs per group** | 1 | Raise to 2 or 3 to stop one-off tabs from each getting their own group. Groups that fall below the minimum are dissolved automatically. |
| **Leave tabs in groups I made by hand** | off | When on, a tab you dragged into your own group is left alone. |

### Learned sites

The popup lists every site learned so far. Each row shows the group color as a
swatch with the raw sampled icon color flagged in its corner, so you can see
both what was read and what it snapped to. Hover for the hex value.

Each row has two buttons:

- **Eyedropper** — pick the group color by hand. It opens the nine tab-group
  colors with the current one ringed; choosing one applies it immediately and
  the row is labeled *custom*. **Reset to icon** hands the site back to its
  favicon. A hand-picked color always beats the sampled one.
- **×** — forget the site entirely, dropping both what was learned and any
  color you picked, so its icon is read fresh.

Rows say where their color came from: nothing extra when it came from the icon,
`from theme-color` or `from header` when the icon had nothing to offer, and
`custom` when you picked it.

### No color found

Sites whose icon *and* page both came up empty. They are deliberately left
ungrouped rather than handed an invented color. Each row has an eyedropper:
assign a color and the site moves up into **Learned sites** and is grouped from
then on. Clearing that color sends it back down here to be retried.

**Re-sample icons** re-reads every icon from scratch and clears all hand-picked
colors with it — it is the "start over from what the icons say" button. That is
the only thing that discards an override: short of pressing it, one lasts
indefinitely and survives closing the browser and upgrading the extension.

Pinned tabs are never touched.

## If a group is the wrong color

Colors are learned once per site and cached, so a bad reading sticks until you
clear it. Set it yourself with the row's eyedropper, press **×** to re-read that
one site, or **Re-sample icons** to redo all of them.

The popup row shows both the raw hex that was read and the group color it
snapped to, which tells you which half is wrong: if the hex does not look like
the site's brand, the wrong icon was picked; if the hex looks right but the
group color does not, the matching thresholds in `lib/palette.js` are at fault.
The `from …` label says which source supplied it.

Upgrading the extension discards the sampled cache on its own — `CACHE_VERSION`
in `lib/store.js` is bumped whenever sampling changes, so you never have to know
to re-sample after an update. Your own overrides are left alone.

## Layout

```
manifest.json        MV3 manifest
background.js        service worker: events, grouping, the serial work queue
lib/site.js          URL → group identity (no site list, TLD grammar only)
lib/palette.js       per-browser palettes + CIELAB hue matching onto the nine names
lib/icon.js          icon discovery, dominant-color extraction, page-color fallback
lib/store.js         settings, the learned-color cache, and color overrides
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
  color matching for both the Chrome and Edge palettes (74 checks).
- <http://127.0.0.1:8731/test/icons.html> — the full icon pipeline against
  synthetic favicons: brand-on-white, glyph-on-transparent, monochrome,
  antialiased edges, and the two failure cases that must stay ungrouped.
- <http://127.0.0.1:8731/test/selection.html> — which icon gets picked out of a
  candidate list, including the regression for a large monochrome icon
  outranking the branded one.
- <http://127.0.0.1:8731/test/page-color.html> — the header/theme-color
  fallback, run against real iframes so layout and computed styles are genuine.
- <http://127.0.0.1:8731/test/popup-preview.html> — the real popup rendered
  against a stubbed `chrome` API, so the UI can be worked on outside the
  browser. Add `#test` to drive it and assert the color picker's behavior, or
  `#open` for a screenshot with a picker expanded.

Each page prints `ALL PASS` when green. Regenerate the fixtures with
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
| `storage` | Remember learned colors so icons are not re-fetched constantly. |
| `scripting` | Read `<link rel="icon">` and the site's own name from the page. |
| `http://*/*`, `https://*/*` | Fetch icon files and web app manifests. |

Everything stays on your machine. Nothing is sent anywhere, and no analytics are
collected. Icon fetches go to the sites you are already visiting, with
`credentials: "omit"` so no cookies ride along.

## License

MIT — see [LICENSE](LICENSE).
