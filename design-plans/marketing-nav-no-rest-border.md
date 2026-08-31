# Marketing header has no border at rest

Written against: `0c1c2252`

## Evidence chain

- Surface: `.marketing-nav` on every route that renders `MarketingNav`
- Problem: the bar always draws a 1px bottom hairline
- Design evidence: `DESIGN.md` §4 Header — fixed 64px, background `paper/85` + `backdrop-blur 12px`, **“no border at rest”**, `transition 200ms`. Brand register includes `app/(www)` (`DESIGN.md` §7)
- Owner: `apps/web/src/app/globals.css` `.marketing-nav`. Rendered by `apps/web/src/components/marketing-nav.tsx`
- Scope and affected surfaces: `/`, `/archive`, `/writing` and writing posts via `app/(www)/layout.tsx`. Also `/login`, which mounts `MarketingNav` directly
- Uncertainty: none. There is no scrolled/not-at-rest border variant today; removing the property is the whole change

## Design decision

Delete the rest border on `.marketing-nav`. Keep height, paper/85, blur 12px, and the 200ms background transition. Separation is the blur, not a hairline.

## Reuse

- The rest of `.marketing-nav` already matches the Header spec (64px, `color-mix(in srgb, var(--bg) 85%, transparent)`, `blur(12px)`, `transition: background-color 200ms var(--ease-snappy)`)
- No new primitive

## Changes

1. `apps/web/src/app/globals.css` — `.marketing-nav` (~8203)
   - Change: delete `border-bottom: 1px solid var(--border);`
   - Preserve: `position: fixed`, `height: 64px`, padding, 85% background, 12px blur, 200ms background transition. `.marketing-nav:has(.mnav-sheet)` opaque background (needed so `backdrop-filter` does not trap the sheet). `.mnav-sheet a` row hairlines. Docs `.docs-topnav` / `.docs-mobilebar` borders (different chrome)
   - Verify: computed `border-bottom-width` of `.marketing-nav` is 0 at rest on `/`, `/archive`, `/writing`, `/login`

Do not edit `marketing-nav.tsx`.

## Scope

- Inherit: `/`, `/archive`, `/writing`, writing posts, `/login`
- Verify: light and dark; desktop; ≤640px (logo + burger, sheet open and closed). Sheet-open state must still drop blur without needing a bar hairline
- Exclude: `.docs-topnav` and `.docs-mobilebar` `border-bottom` (docs shell, not this header). `.mnav-sheet a` borders. Finding 1 weights. Finding 2 docs animation

## Validation

- Product: `/` — 64px bar, blur, no bottom rule over the hero. Same on `/archive` and `/writing`
- Interface: light/dark; desktop; mobile with sheet closed and open; `/login`
- System: no replacement box-shadow or fake rule on `.marketing-nav`. Docs bars unchanged
- Repository: `rg -n "^\.marketing-nav \{" -A16 apps/web/src/app/globals.css` → block has no `border-bottom`. `rg -n "border-bottom" apps/web/src/app/globals.css` still matches `.mnav-sheet a`, `.docs-topnav`, `.docs-mobilebar`. Then `bun test apps/web/src/app/\(www\)/www.smoke.test.tsx` → pass

## Stop conditions

- Stop if `DESIGN.md` Header is amended to require a rest border
- Do not remove docs chrome borders or mobile sheet row rules
- Do not add a scroll-triggered border unless `DESIGN.md` specifies one (it does not)

## Design documentation

- After acceptance and validation: none. “no border at rest” is already in `DESIGN.md` §4
