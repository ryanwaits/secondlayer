# @secondlayer/stacks-docs

Docs site for `@secondlayer/stacks` at [stacks.secondlayer.tools](https://stacks.secondlayer.tools).

## Framework

**Vocs 1.4.1** (not 2.x). Peers are `react` / `react-dom` `^19` only. Vocs 2.x peers `vite ^8` + `waku` and defaults to a Node SSR server; 1.4.1 static-exports to `docs/dist/` for a plain Vercel static deploy.

Pages live under `docs/pages/**/*.mdx`. Config: `vocs.config.ts`. Footer: `docs/footer.tsx`. No theme customization in this scaffold — design is a later session.

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
