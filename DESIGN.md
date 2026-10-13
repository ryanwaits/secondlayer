---
name: Secondlayer
description: Instant data for apps on Bitcoin. Geist + Geist Mono, "Primaries" color roles (blue acts, yellow marks, red fails), neutrals everywhere else, the terminal as the product stage.
register: brand
colors:
  light:
    paper: "#ffffff"
    ink: "#111111"
    sub: "#5e5e5e"
    faint: "#9b9b96"
    line: "#e5e5e2"
    soft: "#f5f5f2"
    pri: "#1f45e0"
    on-pri: "#ffffff"
    hi: "#ffcc00"
    on-hi: "#111111"
    ok: "#128a43"
    alarm: "#e3301e"
  dark:
    paper: "#1c1b19"
    ink: "#ece9e2"
    sub: "#b0aca2"
    faint: "#7c786f"
    line: "#383631"
    soft: "#252420"
    pri: "#3a5bff"
    on-pri: "#ffffff"
    hi: "#efc54a"
    on-hi: "#141414"
    ok: "#5cc28f"
    alarm: "#ff5a47"
    fg: "#d9dbe0"
    muted: "#8b9099"
    ok: "#3ccb7f"
    accent: "#ffd21f"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 3.75rem)"
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 3rem)"
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  caption:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: "0"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "0"
  terminal:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "0"
rounded:
  sm: "4px"
  md: "8px"
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
    backgroundColor: "{colors.light.pri}"
    textColor: "{colors.light.on-pri}"
    rounded: "{rounded.full}"
    padding: "0 22px"
    height: "44px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.light.ink}"
    border: "1px solid {colors.light.line}"
    rounded: "{rounded.full}"
    padding: "0 22px"
    height: "44px"
  command-pill:
    backgroundColor: "transparent"
    border: "1px solid {colors.light.line}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  terminal-window:
    backgroundColor: "{colors.terminal.ground-light-mode}"
    border: "1px solid {colors.terminal.line-light-mode}"
    rounded: "{rounded.md}"
---

# Design System: Secondlayer

## 0. Token names and CSS variable names

The `colors:` block above is the brand palette. `globals.css` exposes the same roles
as custom properties and keeps its older names as aliases, so existing docs, account and
writing markup restyles without edits. Grep `apps/web/src/app/globals.css` for the real
name before writing CSS; an unknown `var(--x)` silently voids the whole declaration.

| This doc | CSS variable | Legacy aliases |
| --- | --- | --- |
| `paper` | `--paper` | `--bg`, `--bg-elevated` |
| `soft` | `--soft` | `--bg-chrome`, `--bg-tab-active` |
| `ink` | `--ink` | `--text-main`, `--text-prose` |
| `sub` | `--sub` | `--text-muted` (alpha ramp) |
| `faint` | `--faint` | none; code punctuation, comments, line numbers |
| `line` | `--line` | `--border` |
| `pri` / `on-pri` | `--pri` / `--on-pri` | `--accent`, `--accent-contrast`, `--blue`, `--teal` |
| `hi` / `on-hi` | `--hi` / `--on-hi` | none; yellow fills only |
| `ok` / `alarm` | `--ok` / `--alarm` | `--green` / `--red` |
| `terminal.*` | `--term`, `--term-line`, `--term-fg`, `--term-mute`, `--term-ok`, `--term-acc` | `--term-bg`, `--term-border`, `--term-muted` |

`--yellow` is a readable status TEXT color (`#a37800` light, `#ffd21f` dark). Yellow
FILLS use `--hi`. New work reads the role tokens, never literals.

## 1. Overview

**Creative North Star: "Instant data for apps on Bitcoin."**

One brand, one system. A near-silent page in ink on paper, one family of type, three
color roles that each mean exactly one thing, and the product itself, a dark terminal,
as the only imagery. The page whispers; the terminal demonstrates. Nothing decorates.

**Key characteristics:**
- Geist for everything proportional, Geist Mono for data and the terminal. Weights 400 and
  500 only. Hierarchy is size, one weight step, and tracking.
- Radii are 4 / 8 / 999px. Nothing else.
- No gradients, bevels, glows, or dot-grids. Flat SVG assets and the terminal are the only
  imagery.
- One dark terminal ground in both modes. The page changes theme; the terminal does not.
- Motion is one idea: scroll-position opacity. Everything else is instant.

## 2. Colors

### Roles
| Role | Light | Dark | Means |
|---|---|---|---|
| paper | `#ffffff` | `#1c1b19` | the page |
| ink | `#111111` | `#ece9e2` | text, solid structure |
| sub | `#5e5e5e` | `#b0aca2` | muted text |
| faint | `#9b9b96` | `#7c786f` | code punctuation, comments, line numbers |
| line | `#e5e5e2` | `#383631` | hairlines |
| soft | `#f5f5f2` | `#252420` | raised surface |
| pri / on-pri | `#1f45e0` / `#ffffff` | `#3a5bff` / `#ffffff` | action: links, primary buttons, focus; one part of a product glyph |
| hi / on-hi | `#ffcc00` / `#111111` | `#efc54a` / `#141414` | highlight: new, finalized, signed |
| ok | `#128a43` | `#5cc28f` | success state |
| alarm | `#e3301e` | `#ff5a47` | failures and reorgs only |

### Code surfaces (terminals and code windows)
Follow the theme on the docs code style. The surface inverts its ground so it never
sits white on white: `soft` over `paper` sections, `paper` over `soft` bands. One `line`
hairline, no tinted rows. Code uses the docs Shiki theme: keywords and punctuation
muted, identifiers plain, strings and numbers in the syntax yellow (`#a37800` light,
`#e6c15c` dark); shell command names take the same yellow. Checks are `ok` text. No
blue or red in code.

Dark mode is warm charcoal ("Stone"), mirroring light mode's warm off-white; it lifts
the ground off black so long copy reads at 7.6:1 for `sub`.

### Named rules
**Blue acts.** Blue never decorates data. It marks what you can click or do. One
exception, carried by the brand mark: a product glyph may draw one part in blue, the
part its claim is about, the way the logo's top layer is blue (see Product glyphs).
**Yellow marks.** Yellow never signals status. It marks new, finalized, signed.
**Red fails.** Red appears only for failures and reorgs.
**Neutrals carry the rest.** If it is not an action, a mark, or a failure, it is ink, sub,
line, or soft. Muted text uses the `sub` role or the ink alpha ramp, never an invented gray.

## 3. Typography

**Sans:** Geist, 400/500 only. **Mono:** Geist Mono, 400/500, `tabular-nums` for values.
**Caveat:** installed for opt-in rough-notation only (writing); never on default surfaces.
Headings and body are one family; headings differ by weight 500 and tracking.

### Scale
- **Hero display** — 60px / 1.0, 500, −0.025em. Two lines max. `text-wrap: balance`. Mobile floor 36px.
- **Closing headline** — 48px / 1.0, 500, −0.025em. One line.
- **Section heading** — 30px / 1.2, 500, −0.025em.
- **Subhead** — 18px / 1.625, `sub`, max-width 576px.
- **Body** — 16px / 24px, 400.
- **Checklist / feature list** — 14px / 1.625, `sub`.
- **Caption** — 12px, `sub`.
- **Mono command** — 14px / 20px Geist Mono.
- **Terminal body** — 12px / 1.625; inner chrome 11px.

### Named rules
**The Two-Weight Rule.** 400 and 500 are the entire weight vocabulary. Emphasis beyond that
is size or color role, never 600+.
**The Tight-Display Rule.** Everything ≥30px carries −0.025em tracking. Body carries none.
**The Mono-Is-Data Rule.** Values, hashes, endpoints, heights, commands: Geist Mono with
`tabular-nums`. Prose never mono; data never proportional.

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
One mark, one component: `<Logo />` (`components/logo.tsx`), layered parallelograms, one
geometry (`viewBox="6 9 36 24"`). The top layer is primary blue (`.logo-primary` fills
`var(--pri)`); the back layer is ink at 24% (`.logo-echo`). Static exports: `app/icon.svg`
(adapts to dark tabs), `public/logo-light.svg`, `public/logo-dark.svg`. Wordmark beside it
is ink, 16px/500, −0.01em.

### Product glyphs
One set, `components/site/icons.tsx`, for the props rows on the product pages. Common
shapes (lock, terminal, branch, shield), never invented ones, each used once across the
pages. 20-unit grid with 2 of padding, rendered at 20px; 1.2 stroke, round caps and
joins, 2-unit corners, currentColor, no fills except the play mark. At most one accent
part per glyph: `glyph-pri` (blue) for what the claim is about, `glyph-alarm` (red) for
a failure. Some glyphs carry none. Only the layers glyph uses the logo's slant.

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
Ground `--term` (dark in both modes), border `--term-line`, radius 8px, self-contained:
- Title bar: pad `8px 12px`, 9px traffic dots (exact hexes above), 12px mono path, right-aligned
  meta.
- Body: pad 14px, Geist Mono 12/19.5, terminal fg/muted tokens, prompt `❯` in the terminal accent.
- Inner prompt/input rows: raised terminal surface, border `--term-line`, radius 4px, pad `8px 16px`, 11px.
- Diff/success highlight: green text on 8–14% green wash, full-bleed line.
This is a **product depiction** (the sl CLI), not decorative chrome — it must always show
plausible real output (real heights, real commands). Never wrap it in a fake browser frame.

### Nav
Wordmark + dropdown labels (16px/400, chevron 12px) + text links + button pair. Dropdowns open
instantly, close on `Esc` and outside-click, items 16px with 8px pad rows.

### Footer link column
Heading 16px ink 400 (not bold — column position does the work), links 16px `fog` hover ink.

### OG share cards
1200×630, Geist, Primaries, per-page cards from `apps/web/scripts/generate-og.tsx`
(`bun run og`). Same tokens as the site; an OG card is a page in miniature.

## 7. Registers

- **Brand register** (`app/(www)`, landing, docs shells): everything above.
- **Product register** (data tables): keeps its density and data-table DNA, adopts
  the new palette (paper/ink/alpha ramp) and the two-weight rule. Tables:
  12px Geist Mono rows, 10px caps headers at `ink/40` with 0.06em tracking, hairline `ink/8`
  dividers, hover wash `ink/2`. Density never leaks into brand; whitespace never leaks into
  tables.

## 8. Do's and Don'ts

### Do
- Use the color roles for what they mean: blue acts, yellow marks, red fails.
- Set muted text with `sub` or the ink alpha ramp.
- Use radius-full for pill-shaped interactives; 8px for cards, terminal, command; 4px inside
  terminals.
- Keep the terminal dark in both modes with the terminal tokens.
- Put real CLI output in every terminal (heights, commands, verify results). Honest copy only,
  no invented metrics, counts, or logos.
- Ship the scroll-opacity mechanism exactly: 0.2 to 1, 500ms, opacity only, reduced-motion safe.
- Keep hero headlines at most 2 lines, 50 characters, both lines ink.

### Don't
- **No new families.** Geist + Geist Mono, full stop. Caveat only for opt-in notation.
- **Blue never decorates data. Yellow never signals status. Red only for failures and reorgs.**
- **No gradients, bevels, glows, dot-grids**, no gradient text, no glassmorphism (the 12px
  header blur is the one sanctioned blur), no card grids of identical feature tiles, no
  hero-metric blocks.
- **No motion beyond the mechanism** — no fade-up-on-scroll for every element, no parallax, no
  bouncy hovers, no `transition: all`.
- **No borders heavier than 1px**; no shadows on static surfaces (terminal and dropdowns may
  carry one soft shadow; nothing else).

## 9. Provenance

Shell structure was extracted from https://x.ai/build on 2026-08-14 via agent-browser
(sizing, tracking, weight discipline, spacing, motion). Palette, type and logo were replaced
by the founder-locked Primaries brand on 2026-10-12; the house stack is Geist + Geist Mono.
Structural facts (grid `1fr/1.3fr` gap 64, sticky `top: calc(50vh − 220px)`, fade
`opacity .2 → 1 @ 500ms cubic-bezier(0.4,0,0.2,1)`, header `64px + blur 12px @ 85% paper`)
are measured, not eyeballed. Reference captures: `design/reference/xai-build/`. The DNA is
structural; copy, content, and product voice remain Secondlayer's.
