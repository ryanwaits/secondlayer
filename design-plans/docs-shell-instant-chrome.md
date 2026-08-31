# Docs shell chrome is instant

Written against: `0c1c2252`

## Evidence chain

- Surface: docs shell on every `/docs*` route (`DocsTopNav`, `DocsSidebar` groups, mobile bar)
- Problem: chrome plays an entrance animation with translation on mount
- Design evidence: `DESIGN.md` §5 One-Motion Rule — only scroll-opacity, hover color, or header retract on brand surfaces; “Everything else is instant”; scroll fade is “Opacity only — no translate, no scale.” Brand register includes docs shells (`DESIGN.md` §7)
- Owner: `apps/web/src/app/globals.css`. Mounted by `apps/web/src/app/(www)/docs/layout.tsx` (`docs-shell` → `DocsSidebar` + `DocsTopNav`)
- Scope and affected surfaces: `.docs-topnav`, `.docs-nav-group` (and `:nth-child(2|3|4)` delays), `.docs-mobilebar` at `max-width: 768px`, plus the `@keyframes docs-chrome-in` / `docs-rail-in` they reference
- Uncertainty: none

## Design decision

Remove the docs chrome entrance animation entirely. Do not replace it with an opacity-only fade. Instant is the documented default.

## Reuse

- Instant chrome: `.marketing-nav` has no mount animation
- `--duration-snappy` / hover color transitions elsewhere stay; they are allowed hover motion
- No new primitive

## Changes

1. `apps/web/src/app/globals.css` (~5595–5638)
   - Change: delete the comment “Subtle entrance when arriving at docs…”, both `@keyframes` (`docs-chrome-in`, `docs-rail-in`), the `.docs-topnav { animation: … }` rule, the `.docs-nav-group { animation: … }` rule, the three `.docs-nav-group:nth-child(2|3|4) { animation-delay: … }` rules, and the `@media (prefers-reduced-motion: reduce)` block that only sets `animation: none` on those two selectors
   - Preserve: the earlier `.docs-topnav` layout rule (~5548–5564). The later `.docs-nav-group { margin-bottom: 22px }` rule (~5666). Sidebar/topnav geometry, blur, borders, hover color
   - Verify: `docs-chrome-in` and `docs-rail-in` do not appear in the file. `.docs-topnav` and `.docs-nav-group` have no `animation` property

2. `apps/web/src/app/globals.css` — `.docs-mobilebar` inside `@media (max-width: 768px)` (~6135)
   - Change: delete `animation: docs-chrome-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;`
   - Preserve: 48px bar, blur, `border-bottom`, layout
   - Verify: the mobile docs bar does not animate on first paint

Do not edit `docs/layout.tsx`, `docs-sidebar.tsx`, or `docs-top-nav.tsx`.

## Scope

- Inherit: every `/docs*` route, desktop topnav + sidebar groups, ≤768px mobile bar
- Verify: first load of `/docs` and a nested page (e.g. `/docs/index`); client navigations already skipped the animation per the old comment — they must stay instant; dark theme; `prefers-reduced-motion` (now a no-op because there is no animation)
- Exclude: hover color transitions on `.docs-topnav-link` / `.docs-nav-item`. Header 200ms background transition on `.marketing-nav`. Scroll-opacity if any remains on marketing. Docs topnav/mobilebar `border-bottom` (not this change). Finding 1 weights

## Validation

- Product: land on `/docs` — sidebar and topnav are in their final positions on first frame; no stagger
- Interface: desktop; ≤768px (mobile bar, no topnav); light/dark; `prefers-reduced-motion: reduce`; follow an in-docs link
- System: no leftover `@keyframes docs-chrome-in` / `docs-rail-in`. No parallel entrance animation on docs chrome
- Repository: `rg -n "docs-chrome-in|docs-rail-in" apps/web/src/app/globals.css` → no matches

## Stop conditions

- Stop if `DESIGN.md` One-Motion Rule is amended to allow mount fades
- Do not strip hover color/border transitions or the marketing header’s 200ms background transition
- Do not restyle docs chrome while removing the animation

## Design documentation

- After acceptance and validation: none. One-Motion is already in `DESIGN.md` §5
