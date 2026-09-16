# @secondlayer/stacks-docs

Docs site for `@secondlayer/stacks` at [stacks.secondlayer.tools](https://stacks.secondlayer.tools).

## Framework

**Vocs 1.4.1** (not 2.x). Peers are `react` / `react-dom` `^19` only. Vocs 2.x peers `vite ^8` + `waku` and defaults to a Node SSR server; 1.4.1 static-exports to `docs/dist/` for a plain Vercel static deploy.

Pages live under `docs/pages/**/*.mdx`. Config: `vocs.config.tsx`. Footer: `docs/footer.tsx`. Top-nav version pill: `docs/layout.tsx` (reads `packages/stacks/package.json` at build). Landing hero + cards: `docs/components/Landing.tsx`, mounted from `docs/pages/index.mdx` with `layout: landing`.

## Shell

viem.sh's docs shell reproduced on Vocs 1.4.1: sidebar on the page ground, content + outline in a raised panel (hairline left/top, 16px top-left radius, fixed under the top nav), gold 2px underline on the active top-nav tab, gold-on-wash active sidebar item, mono labels for `/reference/*` sidebar entries, gold `§n` counters on docs H2s. No theme toggle; the site follows the OS. Colors live in `vocs.config.tsx` (`theme.variables.color`): egg-white light (`#f0ebdd` ground / `#f9f6ee` panel), warm-dark dark (`#111010` / `#171513`), gold accent (`#b8890a` light text, `#e3b117` fill; `#f0c430` dark). Structure only in `docs/styles.css`.

`vite.define` in the config shims `process.platform` / `process.env`: Vocs 1.4.1 bundles picomatch into the client and it reads `process` at module init, which otherwise throws in the browser and aborts hydration (no outline, search, tabs, copy buttons).

## Icons + OG

Favicon: `docs/public/icon-{light,dark}.svg` (secondlayer mark in ink). OG card: `docs/public/og.png`, a 1200×630 capture of `docs/og-card.html` (`agent-browser open file://…/og-card.html`, viewport 1200×630, screenshot). Re-render when the tagline changes.

## Code blocks

Code blocks reuse the platform docs CodeBlock rules (elevated surface, hairline border, 12px radius, Fira Code 14/1.7, hover copy button) via `docs/styles.css`, and a library-specific shiki theme in `docs/syntax-theme.ts`: the platform's monotone ink ramp, warm-tinted for the egg-white / warm-dark grounds, with gold on literals only (strings, numbers, JSON values). Keywords are ink at weight 500; nothing is bold.

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
