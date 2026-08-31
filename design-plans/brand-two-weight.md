# Brand register uses only weights 400 and 500

Written against: `0c1c2252`

## Evidence chain

- Surface: `apps/web` brand register in `app/(www)` — `/` and `/archive` heroes, docs sidebar/mobile wordmark, footer column headings on non-docs `(www)` routes
- Problem: Those roles still ship retired or out-of-vocab weights (520, 560, 600)
- Design evidence: `DESIGN.md` Two-Weight Rule (§3 Named rules): 400 and 500 only on brand surfaces; “the old 520–560 weights are retired”; “never 600+”. Hero display is weight 500. Logo wordmark is 16px/500 (`DESIGN.md` §6 Logo). Footer column headings are 16px/400 (`DESIGN.md` §6 Footer link column). Brand register includes `app/(www)` and docs shells (`DESIGN.md` §7)
- Owner: `apps/web/src/app/globals.css`
- Scope and affected surfaces: `.home-hero h1` (`/` + `/archive`), `.docs-nav-brand` + mobile sibling `.docs-mobilebar-brand` (`/docs*`), `.docs-nav-grouplabel` (`/docs*`), `.site-footer-col h5` (`/`, `/archive`, `/writing`)
- Uncertainty: none. `.docs-mobilebar-brand` was not named in the finding table; it is the ≤768px wordmark for the same `DocsSidebar` brand link and takes the same 500 as `.docs-nav-brand`

## Design decision

Set each named role to the documented Two-Weight value. Do not restyle size, family, tracking, or color.

| Selector | Now | Set to | Why |
| --- | --- | --- | --- |
| `.home-hero h1` | 520 | 500 | Hero display |
| `.docs-nav-brand` | 600 | 500 | Wordmark |
| `.docs-mobilebar-brand` | 600 | 500 | Same wordmark, mobile |
| `.site-footer-col h5` | 560 | 400 | Footer column heading |
| `.docs-nav-grouplabel` | 600 | 400 | Non-hero heading / label |

## Reuse

- `--w-heading: 500` and `--w-ui: 400` in `apps/web/src/app/globals.css` `:root` (optional; literals 500/400 are equally valid)
- Exemplar wordmark: `.marketing-nav-brand` and `.site-footer-brand .b` already use `font-weight: 500`
- Exemplar non-hero heading: `.home-final h2` already uses `font-weight: 400`
- No new primitive

## Changes

1. `apps/web/src/app/globals.css` — `.home-hero h1` (~9206)
   - Change: `font-weight: 520` → `font-weight: 500`
   - Preserve: family, size clamp, line-height, letter-spacing, `.home-h1-dim` at 500 / `#7d8187`
   - Verify: computed weight of the `/` and `/archive` `h1` is 500

2. `apps/web/src/app/globals.css` — `.docs-nav-brand` (~5661) and `.docs-mobilebar-brand` (~6142)
   - Change: `font-weight: 600` → `font-weight: 500` on both
   - Preserve: 48px band, 0.9375rem size, Sora, layout
   - Verify: “secondlayer” in the docs sidebar and in the ≤768px docs bar is weight 500

3. `apps/web/src/app/globals.css` — `.site-footer-col h5` (~9534)
   - Change: `font-weight: 560` → `font-weight: 400`
   - Preserve: Fira Code, 0.625rem, uppercase, tracking, muted color
   - Verify: footer column titles (Surfaces, Developers, Resources) are weight 400 on `/`, `/archive`, `/writing`

4. `apps/web/src/app/globals.css` — `.docs-nav-grouplabel` (~5672)
   - Change: `font-weight: 600` → `font-weight: 400`
   - Preserve: 10px mono, uppercase, tracking, color
   - Verify: docs sidebar group labels (Site, and each docs group) are weight 400

## Scope

- Inherit: `/`, `/archive` (hero); every `/docs*` route (sidebar + mobile bar); footer on `/`, `/archive`, `/writing` and writing posts
- Verify: `/docs` desktop and ≤768px; `/` + `/archive` hero two-line display (dim line stays 500)
- Exclude: other 520/560/600 in `globals.css` (not on this path). `.docs-article strong` at 600. Unused `.home-announce-tag` at 600. Hero size/tracking. Footer/docs label size/family restyle. `DESIGN.md` edits

## Validation

- Product: open `/`, `/archive`, `/docs`, `/docs` at ≤768px, `/writing` — type looks like the 400/500 pair, not heavier
- Interface: light and dark; hero two-line; docs sidebar + mobile bar; footer columns
- System: wordmarks match `.marketing-nav-brand` (500). No new weight token
- Repository: `rg -n "^\.home-hero h1|^\.docs-nav-brand|^\.docs-mobilebar-brand|^\.site-footer-col h5|^\.docs-nav-grouplabel" -A6 apps/web/src/app/globals.css` → those blocks show 500, 500, 500, 400, 400. Then `bun test apps/web/src/app/\(www\)/www.smoke.test.tsx` → pass

## Stop conditions

- Stop if `DESIGN.md` Two-Weight Rule is amended
- Stop if a listed selector is no longer on the brand path
- Do not sweep other 520/560/600 in `globals.css`

## Design documentation

- After acceptance and validation: none. Two-Weight, hero 500, wordmark 500, and footer heading 400 are already in `DESIGN.md`
