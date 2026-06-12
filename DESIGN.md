---
name: Secondlayer
description: Editorial-grade Stacks data platform — one tinted-neutral token set, two registers (essay-like marketing + a dense data console).
colors:
  ink: "#111111"
  paper: "#fafafa"
  paper-elevated: "#ffffff"
  chrome: "#f0f0f0"
  hairline: "#e5e5e5"
  hairline-hover: "#dddddd"
  text-muted: "#000000a6"
  text-dim: "#0000001f"
  signal-blue: "#2563eb"
  signal-blue-dark: "#8aa7f8"
  marker-pink: "#ff00aa"
  success-green: "#22c55e"
  warning-yellow: "#eab308"
  danger-red: "#ef4444"
  info-blue: "#3b82f6"
  accent-teal: "#1588b2"
typography:
  display:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 6vw, 4.5rem)"
    fontWeight: 520
    lineHeight: 0.95
    letterSpacing: "0"
  headline:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 560
    lineHeight: 1
    letterSpacing: "0"
  title:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 540
    lineHeight: "normal"
    letterSpacing: "-0.01875rem"
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 460
    lineHeight: "1.43"
    letterSpacing: "-0.00563rem"
  label:
    fontFamily: "Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 560
    lineHeight: 1
    letterSpacing: "0.05em"
  note:
    fontFamily: "Caveat, cursive"
    fontSize: "1.375rem"
    fontWeight: 460
    lineHeight: 1.2
    letterSpacing: "0"
rounded:
  sm: "3px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  full: "999px"
spacing:
  xxs: "0.5rem"
  xs: "1rem"
  sm: "1.5rem"
  md: "2rem"
  lg: "2.5rem"
  xl: "3rem"
  xxl: "3.5rem"
components:
  button-accent:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.paper-elevated}"
    rounded: "{rounded.md}"
    padding: "5px 14px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-accent-soft:
    backgroundColor: "#2563eb0f"
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  badge-state:
    backgroundColor: "#22c55e14"
    textColor: "{colors.success-green}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  callout:
    backgroundColor: "#2563eb0f"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "1rem"
  dataset-endpoint:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "3px 9px"
---

# Design System: Secondlayer

## 1. Overview

**Creative North Star: "The Field Notebook"**

Secondlayer reads like an engineer's annotated notebook: dense, legible, and quietly opinionated. The emotional target is **calm infrastructure** and **quiet competence** — trustworthy rather than clever, the UI disappearing into the work. Long-form pages are set as essays in Sora over Public Sans, ruled with hairlines and dashed em-dash bullets, and marked up by hand in Caveat cursive, the way you'd circle a number in a margin. The product console is the same notebook flipped to its data pages: tabular Fira Code figures, ruled rows, and small uppercase labels. One token set, two registers. The marketing surface (`app/(www)`) is where *design is the product* and follows **benji.org** (editorial, refined type, generous whitespace, restrained motion); the authed console (`app/platform`) is where *design serves the data* and follows **LiveKit** (dense, functional, mono-accented, clean borders, light/dark parity). They never look like two apps because they share a single `:root` — never swap their density.

The system is built on tinted near-neutrals (warm paper, near-black ink) carrying ~95% of every screen, with exactly one chromatic voice (Signal Blue) doing the pointing and a single Marker Pink reserved for one human flourish per page. Depth comes from hairlines and whitespace, not drop shadows. The four reflexes it refuses, by name: crypto/web3 neon, generic SaaS template, heavy enterprise, and playful/consumer (see Do's and Don'ts).

**Key Characteristics:**
- Editorial restraint: hairline rules, generous measure (65–75ch), no decorative containers.
- Hand-annotation layer: Caveat cursive labels and rough-notation circles, used sparingly.
- One accent that points (Signal Blue), one accent that delights (Marker Pink), used once each per view.
- Light by default, with a true dark theme via `prefers-color-scheme` plus explicit `.force-light` / `.force-dark` overrides.
- Monospace as a first-class voice for data, code, identifiers, and numerals.

## 2. Colors

Tinted near-neutrals do the work; chromatic color is rationed. The palette is defined twice in `:root` (light and dark) and switched by `prefers-color-scheme` or a `.force-*` class on `<html>`.

### Primary
- **Signal Blue** (#2563eb light / #8aa7f8 dark): the single pointing color. Links, focus states, primary CTAs, selected rows, callout accents, the logo fill. It marks the one actionable or important thing in view. Its softer forms ship as `accent-bg` (#2563eb0f) and `accent-border` (#2563eb33) for tinted fills.

### Secondary
- **Marker Pink** (#ff00aa, both themes): the human flourish. Appears once per page at most — the "free forever" claim's dashed underline, the hand-drawn NEW badge circle, a single editorial highlight. Treated like a marker swipe, never a brand fill.

### Neutral
- **Ink** (#111111 light / #ececec dark): primary text and the fill of ink-button CTAs.
- **Paper** (#fafafa light / #111111 dark): the page. Warm, never pure white.
- **Paper Elevated** (#ffffff / #1a1a1a): cards, panels, status blocks, raised surfaces.
- **Chrome** (#f0f0f0 / #0c0c0c): inset surfaces, code chips, tab backgrounds.
- **Text Muted** (rgba black 0.65 / white 0.6): secondary copy, metadata, labels, and muted code-example tokens (JSON keys/punctuation). Tuned to ≈6–7:1 so it clears WCAG AA in both themes and reads legibly inside code examples.
- **Text Dim** (rgba 0.10–0.12): faintest support text and disabled marks.
- **Hairline** (#e5e5e5 / #2e2e2e): every border, divider, and rule. The structural backbone of the whole system.

### Tertiary (semantic, console + status only)
- **Success Green** (#22c55e), **Warning Yellow** (#eab308), **Danger Red** (#ef4444), **Info Blue** (#3b82f6), **Accent Teal** (#1588b2): each pairs with an 8%-alpha background (`*-bg`) for status badges, dots, blocks, and inline messages. Never decorative; strictly state.

### Named Rules
**The One Voice Rule.** Signal Blue covers ≤10% of any screen. If two things are blue, neither reads as the signal. Demote one to ink.

**The Pink-Once Rule.** Marker Pink appears at most once per page, and only as a hand-gesture (underline, circle, highlight). Never as a button, fill, or second accent.

**The Tinted-Neutral Rule.** No `#000`, no `#fff`. Paper is warm (#fafafa), elevated surfaces are pure white only as a deliberate lift; ink is #111, never pure black.

## 3. Typography

**Display Font:** Sora (with ui-sans-serif, system-ui fallback) — all headings `h1`–`h4`.
**Body Font:** Public Sans (with ui-sans-serif, system-ui fallback) — prose and UI text.
**Mono Font:** Fira Code (with SFMono-Regular, Consolas fallback) — code, data, identifiers, numerals, labels.
**Note Font:** Caveat (cursive) — hand annotations only.

**Character:** Sora's geometric headlines sit over Public Sans body tuned unusually tight (weight 460, letter-spacing -0.00563rem) so dense pages stay calm and even-toned. Fira Code carries anything that is data, and Caveat is the one handwritten voice that keeps the whole thing from feeling machine-made.

### Hierarchy
- **Display** (Sora 520, clamp(2.75rem→4.5rem), line-height 0.95): the status page state and the rare hero number. Big, tight, confident.
- **Headline** (Sora 560, 1.75rem, line-height 1): status states, major section openers.
- **Title** (Sora 540, 0.9375rem, letter-spacing -0.01875rem): page titles and the section-heading-over-a-rule pattern. Notably small for a "title" — hierarchy here is weight and rule, not size.
- **Body** (Public Sans 460, 0.875rem / 14px, line-height 20px): all prose. Measure capped at 65–75ch (`max-width: 70ch` on article layout). Steps up to 15px on mobile for readability.
- **Label** (Fira Code 560, 0.6875rem / 11px, letter-spacing 0.04–0.06em, uppercase): eyebrows, status text, table headers (10px), callout labels. Mono + uppercase + tracking is the signature label treatment.
- **Note** (Caveat 460, 18–22px): margin annotations and the beta bracket. Slightly rotated (-2deg to +2deg) when overlaid.

### Named Rules
**The Weight-Not-Size Rule.** Hierarchy is carried by weight (460 → 560 → 650) and hairline rules, not by dramatic size jumps. Titles can be 15px; the rule under them does the framing.

**The Mono-Is-Data Rule.** Anything that is a value, hash, endpoint, count, or identifier is set in Fira Code with `font-variant-numeric: tabular-nums`. Prose is never mono; data is never proportional.

## 4. Elevation

Flat by default. Depth is expressed through hairline borders, inset chrome backgrounds, and whitespace, not shadows. The vast majority of surfaces (cards, status blocks, tables, forms) have a 1px hairline and no shadow at all.

Shadow and `backdrop-filter: blur()` are reserved exclusively for **floating, dismissible chrome** that sits above the page: the home status panel, the expanded auth-bar notify field, and the command palette. When something casts a shadow, it is telling you it is temporary and on top.

### Shadow Vocabulary
- **Floating panel** (`box-shadow: 0 18px 44px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)`): the home status popover. Paired with `backdrop-filter: blur(16px)`.
- **Lifted badge** (`box-shadow: 0 12px 32px rgba(0,0,0,0.1)`): the status badge in its open/expanded state.
- **Soft notify** (`box-shadow: 0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)`): the auth-bar email-capture field when expanded. Dark theme deepens these to 0.2 / 0.1.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow is a statement that an element is floating and dismissible. If it does not float, it has no shadow, only a hairline.

## 5. Components

### Buttons
Four button registers share a 6px radius, ~12px mono-adjacent sans label, and snappy easing.
- **Accent (marketing CTA, `.auth-bar-cta`):** Signal Blue fill, white text, weight 560, padding 5px 14px. Hover drops opacity to 0.9. The "notify me / get a key" moment.
- **Ink (console primary, `.dash-btn.primary` / `.login-submit`):** Ink fill, paper text, weight 500. The dominant primary action inside the product. Hover → opacity 0.85.
- **Ghost (console default, `.dash-btn`):** Transparent, hairline border, ink text, weight 500. Hover lifts the border to `text-muted`. The workhorse.
- **Accent-soft (`.btn-primary`):** `accent-bg` fill, `accent-border` stroke, Signal Blue text. A quieter affirmative than the ink fill, used for in-context confirms. Danger variant swaps to red-bg / red.
- **Disabled:** opacity 0.4–0.45, `not-allowed`. No other treatment.

### Chips & Badges
- **Status badge (`.dash-badge`):** uppercase Fira-adjacent 11px, weight 560, letter-spacing 0.04em, 3px radius, 2px 6px padding. Color + 8%-alpha background by state: active=green, syncing/reindexing=sky, paused/stalled=yellow, failed/error=red, inactive=muted, free=Signal Blue. Pill, not box.
- **Dataset endpoint chip (`.dataset-endpoint`):** mono 0.72rem on Chrome background, 1px hairline, 6px radius. Wraps long parquet paths as whole units. Carries a tiny uppercase mono label.
- **Status dot (`.dot`):** 6px circle, green/yellow/red/muted. The lightest-weight state signal; pairs with text.

### Cards / Containers
- **Corner style:** 8px (`lg`) for status blocks and panels; 6px (`md`) for chips, inputs, code, callouts; 10px (`xl`) for the agent-prompt and login inputs.
- **Background:** Paper Elevated (#fff) for raised blocks, Chrome for inset/code.
- **Border:** 1px hairline, always. This is the primary container affordance.
- **Shadow strategy:** none, unless floating (see Elevation).
- **Internal padding:** the spacing scale, typically `sm` (1.5rem) for blocks, `xs` (1rem) for callouts and code.
- **Do not nest cards.** Sections are separated by hairline rules and whitespace, not by boxing things inside boxes.

### Inputs / Fields
- **Console input (`.dash-input`):** Fira Code 13px, transparent background, 1px hairline, 6px radius, 6px 10px padding. Focus removes the outline and lifts the border to `text-muted`. No glow.
- **Login input (`.login-input`):** Public Sans 14px, 10px radius, 12px 16px padding, border → `text-muted` on focus.
- **The signature focus treatment is a border-color shift, not a ring or glow.** A 2px `focus-ring` outline exists only for keyboard `:focus-visible` accessibility.

### Navigation
- **Marketing sidebar (`.nav-list`):** Public Sans 14px, `text-muted` default, lifting to ink + weight 600 on hover/active. Floating fixed sidebar on desktop; collapses into a labeled "Contents" hairline card on mobile, with active items marked by Signal Blue and a `→` glyph.
- **Auth bar (`.auth-bar`):** fixed top-right, 48px tall. Mono uppercase 11px nav links with keyboard-shortcut hints (hidden on touch), an expandable email-capture field, and the accent CTA.

### Section Heading (signature)
Text overlaid on a horizontal hairline: the rule runs full width, the heading sits on top with a Paper background masking the line behind it (`.section-heading-wrap`). Sora 560, 0.875rem. This, not boxes, is how the editorial surface chunks content.

### Hand Annotation (signature)
Caveat cursive labels (`.notation-label`, `.beta-bracket-label`) and rough-notation SVG circles (`.badge-new`), positioned in the margin and rotated -2deg to +2deg. The NEW badge animates its stroke in over 400ms. **All rough-notation SVGs are hidden below 768px** (their computed bounds break on narrow screens); the cursive labels reflow inline instead.

### Data Table (signature, console)
`.dash-data-table`: full Fira Code 12px, `border-collapse`, hairline row dividers, no outer border. Headers are 10px uppercase mono `text-muted` with 0.06em tracking. Rows tint on hover (`rgba(0,0,0,0.02)`) and on selection (`accent-bg`). Cells truncate with ellipsis at 200px and expand a `row-detail` JSON `<pre>` on click. This is the "data page" of the notebook.

### Floating Status Panel (signature)
`.home-status-shell`: a bottom-right pill badge that expands into a blurred, shadowed panel of per-service health rows (glyph + name/detail + mono value), a colored progress bar, and a footer link. The one place the system uses real elevation, blur, and orchestrated motion together.

### Agent Prompt Block (signature)
`.agent-prompt`: a copyable "hand this to your agent" card. 12px (`xl`+) radius, 1px hairline, Paper background. A Sora 16px/600 title (`agent-prompt-title`, letter-spacing -0.02em) sits in a header above a nested code block that reuses `.code-block-wrapper` (Shiki + hover copy button) but with an 8px inner radius and clipped corners. Long prompts collapse: `agent-prompt-collapsed` applies a `linear-gradient` mask fading the bottom to transparent (60% → 0), and a floating `agent-prompt-toggle` pill (mono 11px, 6px radius, one of the few shadowed elements: `0 2px 8px rgba(0,0,0,0.1)`) toggles `max-height` over 0.3s. Embodies "show, don't tell": the artifact you'd actually paste, not a description of it.

### Service Flow Diagram (signature)
`.sl-diagram-figure`: a per-product pipeline rendered as inline SVG, one per service (index, subgraphs, subscriptions, streams), never a generic graphic. The `.sl-diagram-frame` is a 14px-radius hairline card with a radial `accent-glow` wash (top-right) over a masked 30px grid (`background-size: 30px 30px`, radially masked so it fades at the edges). Inside, nodes come in three semantic classes:
- **Default node** (`.node`): Chrome fill, hairline stroke. Upstream/neutral stages.
- **Data node** (`.node.data`): `accent-bg` fill, `accent-border` stroke, Signal Blue title. A shaped/decoded data layer.
- **API node** (`.node.api`): solid Signal Blue fill, paper-contrast text. The Secondlayer surface itself, the one filled node.

Node titles are Sora 13px/600; sublabels and edge labels are Fira Code (8–8.5px). Edges are thin strokes (`.edge` muted at 0.6 opacity, `.edge.acc` Signal Blue at 0.5) with arrowhead markers. A right-aligned Caveat cursive `sl-diagram-note` in Signal Blue captions each diagram ("decoded once — query forever"). **The node coloring is meaningful, not decorative:** the single filled accent node is always the product surface in the pipeline.

### Dataset Sandbox (signature)
`.dataset-sandbox`: an inline, runnable query playground embedded in dataset, docs, and streams pages (one shared component, 7 mounts). It is the place the product register surfaces inside the editorial column, structured as a **notebook cell**: a shaded request "input" strip stacked flush above a lifted response "output", with the response as the hero.
- **Request strip (`.dataset-sandbox-req`):** Chrome-inset, hairline, radius `lg` on top only. One line carries the `GET` method (Signal Blue), the live URL path (query string in muted), and a compact accent Send button. Below a dashed divider, filters are **compact inline chips** (`.dataset-sandbox-filter`: label fused to a borderless control); a set chip lifts its label and border to Signal Blue. On write-gated endpoints, a demoted API-key line tucks under another dashed divider, with the inline create-key flow opening in place.
- **Response zone (`.dataset-sandbox-res`):** Paper-Elevated, hairline, radius `lg` on the bottom only, so it reads as one cell with the request. A quiet mono meta line leads: a state dot (`ok` green / `err` red / `idle` dim) + status + latency + row count, with an always-visible copy button. The body is the existing `CollapsibleJsonTree`.
- **States:** idle renders a **dimmed, static sample** of the response envelope (teaches the shape) plus a `Press Send` hint; loading is an animated shimmer skeleton; success is the live tree; empty (`200` + `[]`) adds a recovery nudge; error shows a red mono message and, on `401/403` write-gated endpoints, an inline "Create a key" path. The curl/fetch snippets demote to a single quiet `<details>` disclosure below.

### Named Rules
**The Idle-Teaches Rule.** An idle data surface renders a dimmed, *static* sample of what's coming, never an animated skeleton. Animation is reserved for loading; if idle animates, it reads as "already running" and teaches nothing.

**The One-Cell Rule.** Request and response are a single unit: the input strip is shaded and the output is lifted, joined by shared corners (top radius on the request, bottom radius on the response). They are never two separate cards.

## 6. Do's and Don'ts

### Do:
- **Do** ration Signal Blue to ≤10% of any screen (The One Voice Rule). It points at the one thing that matters.
- **Do** separate content with hairlines (1px `--border`) and whitespace. The section-heading-over-a-rule is the canonical chunking device.
- **Do** set all data, identifiers, hashes, endpoints, and numerals in Fira Code with `tabular-nums`.
- **Do** keep prose to a 65–75ch measure and body weight 460. Calm, even color on the page.
- **Do** express depth with borders and inset Chrome backgrounds. Reserve shadow + blur for floating, dismissible chrome only.
- **Do** use the Caveat hand-annotation layer sparingly to keep pages from feeling machine-generated.
- **Do** ease with the project curves: `--ease-snappy` (cubic-bezier(0.175,0.885,0.32,1.1)) for state feedback, `--ease-smooth` (cubic-bezier(0.19,1,0.22,1)) for transitions.
- **Do** pair every status hue (green/yellow/red/teal) with text or an icon. Never encode meaning in color alone.
- **Do** provide deliberate, visible custom focus states. The console suppresses native focus rings, so a `:focus-visible` affordance is mandatory, not optional. Maintain AA contrast in both light and dark.
- **Do** respect `prefers-reduced-motion` everywhere; motion is decoration the product can do without.

### Don't:
- **Don't** drift toward **crypto / web3 neon**: no neon-on-black, glows, 3D coins, gradient-mesh heroes, "degen" energy. This is the first reflex for a chain product; refuse it.
- **Don't** build the **generic SaaS template**: no hero-metric blocks, no identical feature-card grids, no gradient-text headings, no Inter-on-cream sameness.
- **Don't** go **heavy enterprise**: no navy-and-gold corporate, legalese, stock photography, or bloated marketing chrome.
- **Don't** go **playful / consumer**: no rounded blobs, mascots, cartoon palettes, or oversized friendly emoji.
- **Don't** use `#000` or `#fff` as text or page color. Paper is #fafafa, ink is #111.
- **Don't** make Marker Pink a second accent or a button. One human gesture per page, maximum.
- **Don't** nest cards or box content that a hairline and whitespace would separate better.
- **Don't** add focus glows or rings to inputs. Focus is a border-color shift (plus the mandatory a11y `:focus-visible` outline).
- **Don't** use bounce or elastic easing, and never animate layout properties. Ease-out only.
- **Don't** let two elements compete as "the signal." If everything is blue, nothing is.
- **Don't** swap the two registers' density: editorial whitespace stays on `(www)`, console density stays on `platform`.
