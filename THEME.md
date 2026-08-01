# DEADSTOCK — Theme

Design system for the Deadstock UI. Modeled on Uber's **Base** system.
Claude Code: read this before writing any markup or CSS. Do not invent
colors, sizes, or weights that aren't in these tables.

Drop-in stylesheet: `theme.css` (plain CSS custom properties + base classes).
Tailwind v4 users: the `@theme` block is at the bottom of this file.

---

## 1. Typeface

Uber's own face is **Uber Move** — proprietary and unlicensable.
**Plus Jakarta Sans** is the closest free match: same geometric bowls,
same tall x-height, and it holds up at heavy display weights the way
Uber Move does.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| role | stack |
| --- | --- |
| UI / display | `'Plus Jakarta Sans', -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` |
| record data | `'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |

**The fallback matters.** If venue wifi drops Google Fonts mid-demo, macOS
falls back to SF Pro, which is close enough that nobody in the room notices.
Never fall back to a generic `sans-serif` alone.

**Why two faces.** Sans carries everything a person reads. Mono carries
everything a *system recorded* — recall numbers, dates, match scores,
confidence. That split is doing argumentative work: monospace makes those
fields read as case-file data rather than UI chrome, which is free credibility
on a page that makes accusations.

---

## 2. Type scale

Uber's rules, copied: display sizes are big and tight, headings are never
lighter than 700, body is grey and never black, almost nothing is uppercase.

| role | size | weight | tracking | line-height | color |
| --- | --- | --- | --- | --- | --- |
| Hero number | `clamp(88px, 12.5vw, 164px)` | 800 | `-0.045em` | `0.9` | `--negative` |
| Hero headline | `clamp(32px, 5vw, 56px)` | 800 | `-0.035em` | `1.06` | `--fg` |
| Heading L | 28px | 700 | `-0.03em` | 1.15 | `--fg` |
| Heading M | 22px | 700 | `-0.025em` | 1.2 | `--fg` |
| Card title (recall) | 17px | 700 | `-0.02em` | 1.28 | `--fg` |
| Card title (listing) | 17px | 500 | `-0.012em` | 1.28 | `#1A1A1A` |
| Price | 28px | 800 | `-0.035em` | 1.1 | `--fg` |
| Body / lead | 18px | 400 | `-0.01em` | 1.5 | `--fg-2` |
| Body | 16px | 400 | `-0.008em` | 1.5 | `--fg-2` |
| Label / nav / button | 16px | 500–600 | `-0.01em` | 1.4 | varies |
| Chip | 14px | 500 | `-0.005em` | 1.4 | `--fg-2` |
| Caption | 14px | 400 | `-0.005em` | 1.5 | `--fg-3` |
| **Record data (mono)** | 12px | 400–500 | `0.02em` | 1.6 | `--fg-3` |

**Numbers always get `font-variant-numeric: tabular-nums`.** Hero number,
prices, ratings, day counts. Without it the hero number jitters when it
animates 23 → 2 → 23, and the whole toggle moment falls apart.

---

## 3. Color — Uber Base semantic tokens

| token | hex | use |
| --- | --- | --- |
| `--bg` | `#FFFFFF` | page |
| `--bg-2` | `#F6F6F6` | inset panels, chips, the recall side of a card |
| `--bg-3` | `#EEEEEE` | hover on `--bg-2` |
| `--fg` | `#000000` | headings, prices, active states |
| `--fg-2` | `#545454` | body copy — **body is never pure black** |
| `--fg-3` | `#757575` | captions, metadata, mono |
| `--border` | `#E2E2E2` | hairlines |
| `--negative` | `#E11900` | hero number, hazard badges, "keyword: not found" |
| `--positive` | `#048848` | live dot, "still for sale", high confidence |
| `--warning` | `#FFC043` | reserve — too light for text on white |

`#E11900` on white is 5.2:1 — passes AA for body text and reads as a stamp.
Do not lighten it. On dark backgrounds red gets absorbed; on white it alarms.

### Hazard badge colors

Badge = color at 8% alpha for background (`${c}14`), solid color for text.

| type | hex | | type | hex |
| --- | --- | --- | --- | --- |
| `tip_over` | `#E11900` | | `laceration` | `#C2410C` |
| `choking` | `#E11900` | | `fall` | `#C2410C` |
| `suffocation` | `#E11900` | | `impact` | `#C2410C` |
| `drowning` | `#E11900` | | `chemical` | `#6D28D9` |
| `fire_burn` | `#C2410C` | | `battery` | `#8A6400` |
| `electrical` | `#8A6400` | | `other` | `#545454` |

Amber was darkened from `#FFB224` to `#8A6400` — the original fails contrast
on white. Same for orange.

---

## 4. Shape and space

| token | value | use |
| --- | --- | --- |
| `--r-sm` | `8px` | images, inputs |
| `--r-md` | `12px` | cards |
| `--r-pill` | `999px` | buttons, chips, toggles |

Page gutter `40px` desktop / `20px` mobile. Max width `1320px`.
Card padding `20px`. Grid gap `20px`, `minmax(440px, 1fr)`.

**No shadows.** Uber uses borders, not elevation. A `1px solid #E2E2E2`
hairline does every job a shadow would, and shadows on white read as
Material Design, which is the wrong century.

---

## 5. Component recipes

**Primary button** — black pill, white text
`background:#000; color:#fff; font:600 15px; padding:11px 20px; border-radius:999px`
hover → `background:#333`

**Chip / filter** — grey pill, black when active
`background:#F6F6F6; color:#545454; font:500 14px; padding:9px 16px; border-radius:999px`
active → `background:#000; color:#fff`

**Segmented toggle** — not a bordered group; three separate pills, `gap:8px`.
Active pill goes solid black. This is the demo's money shot — keep it big
(`16px/600`, `13px 22px` padding) so it's legible from the back of the room.

**Card** — `1px solid #E2E2E2`, `12px` radius, no shadow. Split into two panes:
recall side on `#F6F6F6` with the image at `grayscale(.3)`, listing side on
white at full color. The desaturation is the whole visual argument — dead
record on the left, live product on the right.

**Badge** — pill, `13px/600`, tinted background at 8% alpha.

**Live dot** — `8px` circle, `--positive`, 2s pulse with an expanding
`box-shadow` ring. Used in the nav and on the "still for sale" label.

---

## 6. Rules

- Body copy is `--fg-2`, never `--fg`. Only headings, prices, and active
  states get pure black. This is the single biggest thing that makes a page
  look Uber-clean instead of amateur.
- Every heading is 700 or 800. There is no 600 heading and no 400 heading.
- Uppercase is reserved for mono metadata under 12px. Never uppercase a heading.
- Negative tracking scales with size: `-0.045em` at 164px, `-0.005em` at 14px.
  Large type set at `0` tracking looks loose and unfinished.
- One accent color. Red is the only non-neutral on the page apart from hazard
  badges and the live dot. Adding a second accent kills the argument.
- Images `object-fit: contain` on white, never `cover` — cropping a recalled
  product is a factual error, not a style choice.

---

## 7. Tailwind v4

```css
@import "tailwindcss";

@theme {
  --font-sans: 'Plus Jakarta Sans', -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  --color-bg:        #FFFFFF;
  --color-bg-2:      #F6F6F6;
  --color-bg-3:      #EEEEEE;
  --color-fg:        #000000;
  --color-fg-2:      #545454;
  --color-fg-3:      #757575;
  --color-line:      #E2E2E2;
  --color-negative:  #E11900;
  --color-positive:  #048848;
  --color-warning:   #FFC043;

  --color-haz-tipover:    #E11900;
  --color-haz-fire:       #C2410C;
  --color-haz-battery:    #8A6400;
  --color-haz-chemical:   #6D28D9;

  --radius-sm:   8px;
  --radius-md:   12px;
  --radius-pill: 999px;

  --text-hero:      clamp(88px, 12.5vw, 164px);
  --text-hero--line-height: 0.9;
  --text-hero--letter-spacing: -0.045em;
  --text-display:   clamp(32px, 5vw, 56px);
  --text-display--line-height: 1.06;
  --text-display--letter-spacing: -0.035em;
}
```

Usage: `class="text-hero font-extrabold text-negative tabular-nums"`,
`class="bg-bg-2 rounded-pill text-fg-2"`.

---

## 8. Plain CSS

Everything above is already implemented in `theme.css` — `@import` it or paste
the `:root` block. `index.html` at the repo root is a working reference
implementation of every component in §5.
