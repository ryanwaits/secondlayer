---
name: Secondlayer
description: Self-hosted Stacks data platform — Grok Build-school shell on the house type stack (Sora + Public Sans + Fira Code); one alpha-ramp ink, one accent, terminal as the product stage.
register: brand
colors:
  paper: "#ffffff"
  card: "#f8f6f2"
  ink: "#0a0a0a"
  ink-hover: "#1f2228"
  ink-demoted: "#7d8187"
  fog: "#7d8288"
  pewter: "#aab0ba"
  dove: "#d5d9e2"
  accent: "#ff5c0a"
  accent-hover: "#ffc285"
  terminal-bg: "#151515"
  terminal-raise: "#202020"
  terminal-fg: "#d7d1c9"
  terminal-muted: "#8d867e"
  terminal-bright: "#f2ede5"
  terminal-teal: "#29c6be"
  error: "#ef4444"
  success: "#22c55e"
  warning: "#eab308"
typography:
  display:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 3.75rem)"
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: "-0.025em"
  section:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  subhead:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "0"
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  list:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "0"
  caption:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: "0"
  mono:
    fontFamily: "Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "0"
  terminal:
    fontFamily: "Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "0"
rounded:
  sm: "4px"
  md: "8px"
  xl: "12px"
  full: "999px"
spacing:
  xxs: "0.5rem"
  xs: "1rem"
  sm: "1.5rem"
  md: "2rem"
  lg: "3rem"
  xl: "4rem"
  section: "3rem"
  block: "50vh"
components:
  button-solid:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.full}"
    padding: "0 22px"
    height: "44px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    border: "1px solid rgba(10,10,10,0.1)"
    rounded: "{rounded.full}"
    padding: "0 22px"
    height: "44px"
  announce-pill:
    backgroundColor: "transparent"
    border: "1px solid rgba(10,10,10,0.08)"
    rounded: "{rounded.full}"
    padding: "6px 6px 6px 10px"
  command-pill:
    backgroundColor: "transparent"
    border: "1px solid rgba(10,10,10,0.1)"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  terminal-window:
    backgroundColor: "{colors.terminal-bg}"
    border: "1px solid rgba(255,255,255,0.08)"
    rounded: "{rounded.xl}"
  terminal-inner:
    backgroundColor: "{colors.terminal-raise}"
    border: "1px solid rgba(255,255,255,0.08)"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
---

# Design System: Secondlayer

## 0. Token names ≠ CSS variable names

The `colors:` block above is the brand palette. **Most of those names do not exist
as CSS custom properties.** `globals.css` was written with its own vocabulary, so
`var(--pewter)` resolves to nothing, silently voiding the whole declaration with
no error in the console. Writing CSS from this document without checking has cost
real time more than once.

Map before you write. Grep `apps/web/src/app/globals.css` for the real name.

| This doc | Actual CSS variable | Note |
| --- | --- | --- |
| `paper` | `--bg`, `--bg-elevated` | |
| `card` | `--bg-chrome`, `--term-raise` | |
| `ink` | `--text-main`, `--text-prose` | |
| `ink-hover` | `--term-fg` (light theme) | |
| `ink-demoted` | `--ink-demoted` | matches |
| `pewter` | `--ink-demoted` **in dark theme** | same variable as `ink-demoted`, different theme |
| `accent` | `--accent` | matches |
| `accent-hover` | `--accent-hover` | matches |
| `terminal-*` | `--term-*` | the `--term-*` set **in dark theme**; in light, `--term-bg` is `#ffffff` |
| `error` / `success` / `warning` | `--red` / `--green` / `--yellow` | |
| `fog`, `dove` | **no variable exists** | use the hex as a literal, and say why in a comment |

Two of these are outright traps: `pewter` and `ink-demoted` are the *same*
variable in different themes, and the `terminal-*` palette describes how
`--term-*` renders in **dark** — a light-theme editor surface is white, not
`#151515`.

## 1. Overview

**Creative North Star: "The Quiet Install Page"**

Secondlayer's brand surface follows the Grok Build school (x.ai/build, studied 2026-08-14): a
near-silent white page, the house type doing all the talking at restrained weights, and the
product itself — a dark terminal — as the only image on the page. The page whispers; the
terminal demonstrates. Nothing decorates.

This replaces the previous "Field Notebook" editorial surface (hairline-rule chunking, Caveat
hand-annotations). **The type stack is retained** — Sora display, Public Sans body, Fira Code
mono — dressed in the new shell. The hand-annotation layer is **retired** (Caveat stays
installed, opt-in only, never default). Reference captures of the
source shell (stills + scroll-animation frame video) live in `design/reference/xai-build/`.
The reference mockup implementing this system end-to-end is the "Beside Your Node" artifact.

**Key characteristics:**
- House pairing, restrained weights: Sora (display, 400/500) over Public Sans (body, 400/500),
  Fira Code for data. Hierarchy is size + one weight step + alpha demotion, never 600+.
- Ink is an alpha ramp, not a gray ramp. Muted text is `ink` at 50/45/40/25% alpha, so it stays
  optically tinted by whatever sits behind it.
- Hairlines are alpha too: `ink/8` and `ink/10` on light, `white/8` on dark.
- The terminal is the imagery. No illustrations, no screenshots-in-browser-frames, no photos.
  The dark TUI window carries every feature demonstration.
- Motion is one idea: scroll-position opacity. Everything else is instant.

## 2. Colors

Extracted verbatim from the source's `:root` (HSL triplets) and re-tokened for Secondlayer.

### Ground
- **Paper** `#ffffff` (`0 0% 100%`): the page. Pure white, deliberately — the terminal supplies
  all the darkness the page needs.
- **Card / Ivory** `#f8f6f2` (`40 18% 97%`): the only raised-surface tint, warm not cool.
- **Ink / Jet** `#0a0a0a` (`0 0% 4%`): all primary text and solid buttons. Hover state is
  **Umbra** `#1f2228` (`221 12% 14%`).

### The alpha ramp (signature)
Muted text is never a picked gray. It is `ink` at fixed alphas:
- `ink/50` — subheads
- `ink/45` — checklists, feature pitches
- `ink/40` — captions, `$` prompts, placeholder
- `ink/25` — ghost chrome (theme toggle, "built with" pill)
- Demoted headline line: solid `#7d8187` (the one picked gray — used only for the second line
  of a two-line hero headline)

### Structural neutrals (borders, scrollbars, dark-mode ramp)
`dove #d5d9e2` (222 19% 86%) · `pewter #aab0ba` (213 12% 70%) · `fog #7d8288` (216 4% 51%) ·
`steel` (216 4% 22%) · `evenfall` (214 16% 28%) · `midnight` (214 58% 9%). Borders on light
surfaces prefer `ink/8`–`ink/10` alpha over `dove`; `dove` is for scrollbar thumbs and inputs.

### Accent
- **Sunset** `#ff5c0a` (`22 100% 51.6%`), hover **Dawn** `#ffc285` (`37 100% 76%`): the single
  chromatic voice — the NEW chip outline and the rare inline highlight (never the logo,
  which stays neutral ink).
  Footprint ≤5% of any screen. This replaces Signal Blue as the brand accent. If a future
  re-brand swaps the accent hue, only this slot moves; everything else is ink-on-paper.

### Terminal palette (dark, warm-tinted — never reused on the light page)
- Window `#151515`, inner raised surfaces `#202020`, borders `rgba(255,255,255,0.08)`.
- Text ramp: base `#d7d1c9` (warm off-white), muted `#8d867e`, bright `#f2ede5`.
- One accent inside the terminal: teal `#29c6be` (prompt arrows, links). Semantic greens/reds
  only as state.
- Traffic dots, exact: red `#ff5f57`, yellow `#febc2e`, green `#28c840`, 9px circles.

### Semantic (console + states only)
success `#22c55e` · warning `#eab308` · error `#ef4444`. Paired with 8%-alpha backgrounds;
never decorative.

### Named rules
**The One-Accent Rule.** Sunset appears in at most one place per viewport. The logo is
neutral ink and does not spend the accent. Two orange things = zero signals.
**The Alpha-Muted Rule.** Do not invent grays for secondary text; use the ink alphas above.
**The Warm-Terminal Rule.** Terminal text is the warm ramp (`#d7d1c9` family), never pure white
or cool gray. This warmth is what keeps the dark window from reading generic.

## 3. Typography

**Display:** Sora — retained house display face, worn lighter than before: 500 for the hero,
400 for every other heading (the old 520–560 weights are retired).
**Body:** Public Sans — 400/500 only.
**Mono:** Fira Code — retained for commands, data, and the terminal stage.
**Caveat:** installed but opt-in annotation-only; never on default surfaces.
The source's proprietary faces (`universalSans`/`universalSansDisplay`, Geist Mono) inform
sizing, tracking, and weight discipline only — the faces themselves stay ours.

### Scale (extracted @1440)
- **Hero display** — Sora 60px / 1.0, weight 500, letter-spacing −0.025em (−1.5px @60). Two lines max; line 2 optionally demoted to `#7d8187`.
  `text-wrap: balance`. Mobile floor 36px.
- **Closing headline** — 48px / 1.0, weight **400**, −0.025em. One line.
- **Section heading** — 30px / 1.2, weight **400**, −0.025em, paired with a 28px line icon at
  `gap 12px`. (Display headings at ≤48px drop to weight 400 — the weight-500 treatment is for
  the hero only.)
- **Subhead** — 18px / 29.25px (1.625), `ink/50`, max-width 576px.
- **Body** — 16px / 24px, weight 400.
- **Checklist / feature list** — 14px / 22.75px (1.625), `ink/45`, 14px check glyph `#999`,
  10px gap, 8px between rows.
- **Caption** — 12px, `ink/40` (e.g. "Free to self-host" under the command pill).
- **Mono command** — 14px / 20px Fira Code, `$` prompt at `ink/40`.
- **Terminal body** — 12px / 19.5px (1.625); terminal inner chrome 11px / 17.875px.

### Named rules
**The Two-Weight Rule.** 400 and 500 are the entire weight vocabulary on brand surfaces (Sora
and Public Sans alike). Emphasis beyond that is size or alpha, never 600+.
**The Tight-Display Rule.** Everything ≥30px carries −0.025em tracking. Body carries none.
**The Mono-Is-Data Rule** (kept from v1). Values, hashes, endpoints, heights, commands: Fira
Code with `tabular-nums`. Prose never mono; data never proportional.

## 4. Shell & Layout

### Header
Fixed, `height 64px`, full-width, background `paper/85` + `backdrop-blur 12px`, no border at
rest, `transition 200ms`. Contents: wordmark left; center nav links 16px/400 (Products,
Developers, Company, Pricing pattern); right: outline pill + solid pill pair. Solid CTA may be
a split button (label + chevron cell).

### Containers
- Hero and closing copy: `max-width 768px`, centered, text-center.
- Page content: `max-width 1200px`.
- Feature grid: `grid-cols [1fr 1.3fr]`, `gap 64px`. Copy left, terminal right.

### Hero rhythm (top → bottom, extracted)
announcement pill (38px tall, radius-full, border `ink/8`, pad `6px 6px 6px 10px`, gap 10px;
NEW chip = accent-outline pill 26px) → **44px** → display headline → **24px** (`mt-6`) →
subhead → **40px** → command pill (46px tall: mono 14px, pad `12px 16px`, radius 12px, border
`ink/10`, hover `ink/20`, copy icon behind a hairline divider) → **12px** (`mt-3`) → caption
12px `ink/40` → **28px** → hero link row (16px/400, `›` suffix in a fixed-width slot; hover =
soft `ink/5` radius-full pill behind the link and the chevron morphs to `→`; hover styles
gated behind `@media (hover: hover)`). First section starts ~64–80px below the header.

### Feature stack (the scroll section)
- Left column: N copy blocks, each `min-height 50vh`, flex-centered, `padding-y 48px`.
  Block = icon+heading row → pitch (`ink/45`, `mt-5`) → checklist (`space-y-2`).
- Right column: **one** sticky terminal window, `position: sticky; top: calc(50vh − H/2)` where
  H = window height (440px → `top: calc(50vh − 220px)`), so it stays optically centered while
  the copy column scrolls.
- Mobile: terminal instances render inline under each copy block (`mt-6`), sticky column hidden.

### Closing CTA
Centered 768px: headline 48/400 → subhead → command pill → **36px** → button pair (outline
"Read docs" + solid "Get started", both 44px radius-full, gap 14px).

### Footer
Top hairline. Left identity block (wordmark, © line) + **dashed** vertical rule
(`border-l border-dashed ink/10`) + link-column grid: columns ~104px wide, `gap 40px 56px`,
groups may stack two-deep (Products + Download, Company + Trust). Column headings 16px ink;
links 16px `fog`, hover ink, 4–6px row rhythm. Bottom-left ghosts at `ink/25`: theme toggle,
"built with" pill (10px/500, radius-full, border `ink/6`).

### Scrollbar
6px, thumb `dove`, track `paper`.

## 5. Motion

One mechanism owns the page: **scroll-position opacity**.

- Feature copy blocks idle at `opacity 0.2` and lift to `1` when the block enters the
  viewport-center band (IntersectionObserver, `rootMargin` ≈ −35%/−35%).
- Transition: `opacity 500ms cubic-bezier(0.4, 0, 0.2, 1)`. Opacity only — no translate, no
  scale.
- The sticky terminal swaps its content per active section **instantly** (no crossfade); the
  fading copy provides all the perceived motion. See
  `design/reference/xai-build/xai-scroll-sequence.webm` and `still-transition.png` for the
  captured behavior mid-swap.
- Header transitions at 200ms. Hovers are color/border/opacity at 150–200ms ease-out.
- Everything else is instant. `prefers-reduced-motion`: copy blocks render at full opacity,
  transitions off.

**The One-Motion Rule.** If a proposed animation is not the scroll-opacity mechanism, a hover
color shift, or the header retract, it does not ship on brand surfaces.

## 6. Components

### Logo
The layered-parallelogram mark is **neutral ink** — like the source's own mark, it never
carries the accent. Fill `#0a0a0a` on light, warm bright `#f2ede5` on dark, echo layer at 24%
opacity. In app code the fill rides `var(--text-main)` (`.logo-primary` / `.logo-echo`); the
static exports are `public/logo-light.svg` / `public/logo-dark.svg`. Wordmark beside it is
ink, 16px/500, −0.01em.

### Buttons
- **Solid** (primary): ink fill, paper text, 44px, radius-full, pad `0 22px`, 15–16px/500.
  Hover → umbra. Nav-sized variant 38px.
- **Outline**: transparent, border `ink/10`, hover border `ink/20`. Same geometry.
- **Split CTA**: solid pill with a chevron cell separated by a `paper/20` hairline.
- Focus: `:focus-visible` 2px ink outline, 3px offset — never animated, never a glow.

### Announcement pill (hero)
Radius-full container, border `ink/8`, 38px: accent-outline NEW chip (26px, 11.5px/600 caps) +
16px message (`b` 500 + `ink/50` detail) + 28px circular chevron button.

### Command pill
46px, radius 12px, border `ink/10` hover `ink/20`: `$ ` at `ink/40` + Geist Mono 14px command +
hairline divider + copy icon button (aria-labelled, 44px hit area). Click copies, icon swaps to
a check for 1.2s, no toast.

### Checklist
No bullets, no rules: 14px check glyph `#999` + 14px/1.625 text at `ink/45`, `gap 10px`,
rows `space-y-2`. Items state facts, never invented metrics.

### Terminal window (the product stage)
`#151515`, border `white/8`, radius 12px, self-contained:
- Title bar: pad `8px 12px`, 9px traffic dots (exact hexes above), 12px mono path, right-aligned
  meta.
- Body: pad 14px, Fira Code 12/19.5, warm ramp text, teal prompt `❯`.
- Inner prompt/input rows: `#202020`, border `white/8`, radius 4px, pad `8px 16px`, 11px.
- Diff/success highlight: green text on 8–14% green wash, full-bleed line.
This is a **product depiction** (the sl CLI), not decorative chrome — it must always show
plausible real output (real heights, real commands). Never wrap it in a fake browser frame.

### Nav
Wordmark + dropdown labels (16px/400, chevron 12px) + text links + button pair. Dropdowns open
instantly, close on `Esc` and outside-click, items 16px with 8px pad rows.

### Footer link column
Heading 16px ink 400 (not bold — column position does the work), links 16px `fog` hover ink.

### OG share cards
1200×630, generated by `apps/web/scripts/generate-og.tsx` (`bun run og`): white paper, ink
logo + wordmark over an `ink/10` header rule, Sora headline (line 2 demoted to
`#7d8187`), Fira Code for all code/data artifacts in the ink alpha ramp, a faint sunset
radial wash top-right. Same tokens as the site — an OG card is a page in miniature.

## 7. Registers

- **Brand register** (`app/(www)`, landing, docs shells): everything above.
- **Product register** (`app/platform`, console): keeps its density and data-table DNA, adopts
  the new palette (paper/ink/alpha ramp) and the two-weight rule. Console tables:
  12px Fira Code rows, 10px caps headers at `ink/40` with 0.06em tracking, hairline `ink/8`
  dividers, hover wash `ink/2`. Density never leaks into brand; whitespace never leaks into
  console.

## 8. Do's and Don'ts

### Do
- Set every muted text via the ink alpha ramp (50/45/40/25).
- Use radius-full for every pill-shaped interactive; 12px for cards/terminal/command; 4px inside
  terminals.
- Keep the terminal warm (`#d7d1c9` ramp) with a single teal accent.
- Put real CLI output in every terminal (heights, commands, verify results). Honest copy only —
  no invented metrics, counts, or logos.
- Ship the scroll-opacity mechanism exactly: 0.2 ↔ 1, 500ms, opacity only, reduced-motion safe.
- Keep hero headlines ≤2 lines, ≤50 chars, weight 500; demote line 2 to `#7d8187` when two-toned.

### Don't
- **No new families.** The stack is Sora + Public Sans + Fira Code, full stop. No serif
  display, no Caveat on default surfaces, no font additions.
- **No hand-annotation layer.** Marker Pink, rough-notation circles, cursive notes: retired.
- **No crypto/web3 neon**, no gradient text, no glassmorphism (the 12px header blur is the one
  sanctioned blur), no card grids of identical feature tiles, no hero-metric blocks.
- **No solid-gray muted text** where an ink alpha should be; no cool grays inside the terminal.
- **No motion beyond the mechanism** — no fade-up-on-scroll for every element, no parallax, no
  bouncy hovers, no `transition: all`.
- **No borders heavier than 1px**; no shadows on static surfaces (terminal and dropdowns may
  carry one soft shadow; nothing else).

## 9. Provenance

Extracted live from https://x.ai/build on 2026-08-14 via agent-browser (computed styles +
stylesheet tokens), supplemented by 4 user-supplied captures. Source fonts are proprietary
(`universalSans`, `universalSansDisplay`, Geist Mono); the house stack (Sora + Public Sans +
Fira Code) is retained by decision — the extraction contributes sizing, tracking, weight
discipline, spacing, color, and motion only. Structural
facts (grid `1fr/1.3fr` gap 64, sticky `top: calc(50vh − 220px)`, fade `opacity .2 → 1 @ 500ms
cubic-bezier(0.4,0,0.2,1)`, header `64px + blur 12px @ 85% paper`) are measured, not eyeballed.
Reference captures: `design/reference/xai-build/` (hero, skills-active, transition, close,
footer stills + assembled scroll-sequence webm). The DNA is structural; copy, content, and
product voice remain Secondlayer's.
