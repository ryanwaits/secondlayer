# @secondlayer/stacks-docs

Docs site for `@secondlayer/stacks` at [stacks.secondlayer.tools](https://stacks.secondlayer.tools).

## Framework

**Vocs 1.4.1** (not 2.x). Peers are `react` / `react-dom` `^19` only. Vocs 2.x peers `vite ^8` + `waku` and defaults to a Node SSR server; 1.4.1 static-exports to `docs/dist/` for a plain Vercel static deploy.

Pages live under `docs/pages/**/*.mdx`. Config: `vocs.config.tsx`. Footer: `docs/footer.tsx`. Top-nav version pill: `docs/layout.tsx` (reads `packages/stacks/package.json` at build). Landing hero + cards: `docs/components/Landing.tsx`, mounted from `docs/pages/index.mdx` with `layout: landing`.

## Shell

viem.sh's docs shell reproduced on Vocs 1.4.1: sidebar on the page ground, content + outline in a raised panel (hairline left/top, 8px top-left radius, fixed under the top nav), blue 2px underline on the active top-nav tab, active sidebar row in ink 500 on the panel surface, faint `§n` counters on docs H2s, and the two-layer mark (blue top layer) beside the `stacks` wordmark via `.vocs_NavLogo_title::before` using the favicon files. Type is Geist / Geist Mono. No theme toggle; the site follows the OS on first visit, then Vocs remembers the choice in localStorage `vocs.theme`. `vocs.config.tsx` maps Vocs color slots to brand roles from `docs/brand.ts` (mirrors the DESIGN.md frontmatter; `test/brand.test.ts` fails on drift): light = `soft` ground / `paper` panel, dark = `paper` ground / `soft` panel. Structure only in `docs/styles.css`.

`vite.define` in the config shims `process.platform` / `process.env`: Vocs 1.4.1 bundles picomatch into the client and it reads `process` at module init, which otherwise throws in the browser and aborts hydration (no outline, search, tabs, copy buttons).

## Icons + OG

Favicon: `docs/public/icon-{light,dark}.svg` (secondlayer mark, top layer `pri` blue, back layer 24% ink). OG card: `docs/public/og.png`, a 1200×630 capture of `docs/og-card.html` (`agent-browser open file://…/og-card.html`, viewport 1200×630, screenshot). Re-render when the tagline changes.

## Code blocks

Code blocks: elevated surface, one hairline border, 8px radius, Geist Mono 14/1.7, hover copy button (blue on hover), via `docs/styles.css`. Colors come from the brand code theme `apps/web/src/lib/syntax-theme.ts`, imported in `vocs.config.tsx`: a four-step ink ladder, no hue. Calls are bold-marked in the theme and rendered at weight 500 by `docs/styles.css`.

## Local

From the repo root:

```bash
bun install
bun run --filter @secondlayer/stacks-docs dev
bun run --filter @secondlayer/stacks-docs build
bun run --filter @secondlayer/stacks-docs preview
```

Build output: `apps/stacks-docs/docs/dist/` (confirm `docs/dist/index.html` after build).

## Vercel (operator)

Create a **second** Vercel project pointed at this monorepo. Do not change root `vercel.json` (that stays the platform web app).

| Setting | Value |
|---|---|
| Root Directory | `apps/stacks-docs` |
| Framework Preset | Other |
| Install Command | `cd ../.. && bun install` |
| Build Command | `bun run build` |
| Output Directory | `docs/dist` |

## DNS (operator)

Add a CNAME: `stacks` → Vercel (or the project's assigned domain). Target host: `stacks.secondlayer.tools`.
