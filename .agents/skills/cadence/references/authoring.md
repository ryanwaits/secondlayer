# Authoring reference — the full vocabulary

Practical companion to `SKILL.md`. The engine validates every beats file against a
strict schema (shipped in the `cadence` package); this explains how to *choose* and
*fill* each piece. A bad field fails fast with a clear error — render a `--frame`
still to check.

## Contents
- [The beats file](#the-beats-file)
- [Beat fields](#beat-fields)
- [Panel kinds (exact fields + examples)](#panel-kinds)
- [Motion vocabulary](#motion-vocabulary)
- [Formats](#formats)
- [Backgrounds](#backgrounds)
- [Sequencing model](#sequencing-model)
- [Title typography](#title-typography)

## The beats file

A `<slug>.beats.json` is a `ChangelogInput` — render it with `cadence create <slug>.beats.json`:

```json
{
  "format": "16x9",
  "beats": [ /* 3-6 beats */ ]
}
```

`format` is `"16x9" | "1x1" | "9x16"`. Everything is plain JSON-serializable data:
no functions, no JSX. Motion, panel kind, and background are string keys the engine
resolves at render time. (Inside the engine repo you can instead author a
`<slug>.beats.ts` that `export default`s a typed `ChangelogInput` — the field shapes
below are identical; this reference uses TS snippets to show the types.)

## Beat fields

```ts
{
  id: "slug",                  // unique within the video
  durationInFrames: 235,       // 30fps. ~150 title, ~235 code+panel, ~170 stat
  background: { src: "backgrounds/mount-bonnell.png", treatment: "kenburns" },
  eyebrow: "new in streams",   // optional; lowercase → renders gold UPPERCASE
  headline: "Stream every event.",
  caption: "subscribe · verify · resume",  // optional bottom-center tagline
  badge: "v6.3",               // optional gold version pill (with caption)
  layout: "split",             // "split" (default) | "center" (for closers)
  code: { /* see below */ },   // optional
  panel: { /* see below */ },  // optional
}
```

**Duration guidance.** Code+panel beats need room because the panel waits for the
code to finish typing (see Sequencing). ~235 frames fits ~12 lines of code plus a
panel reveal. Title/stat/closer beats: ~150-170.

**Code spec:**
```ts
code: {
  filename: "events.ts",       // shown centered in the title bar
  lang: "ts",                  // "ts" | "tsx" | "bash" | "json"
  source: `const { events } = await sl.index.events({ limit: 50 });`,
  // do NOT add `tokens` — shiki tokenizes at render time
}
```

## Panel kinds

Pick the kind that visualizes the *result* of the code. Exact shapes:

**feed** — live rows streaming in.
```ts
{ kind: "feed", title: "index.events", subtitle: "ft_transfer", status: "streaming…",
  rows: [{ badge: "sBTC", label: "SP2J6…WVEF", value: "1,200.00" }] }
```

**data-table** — a queried result set.
```ts
{ kind: "data-table", title: "sbtc · transfers", columns: ["block", "amount", "to"],
  rows: [["951475", "1,200.00", "SP2J6…"], ["951474", "48.50", "SP3K9…"]] }
```

**browser** — a Finder-style file/folder listing (the result of a `list({ prefix, delimiter })`-style call). `sections` group rows (e.g. prefixes vs items); folder rows get a chevron, file rows a right-aligned `meta` (size).
```ts
{ kind: "browser", title: "photos/", meta: "delimiter: /", sections: [
  { label: "prefixes", rows: [{ type: "folder", name: "2024/" }, { type: "folder", name: "raw/" }] },
  { label: "items", rows: [{ type: "file", name: "cover.jpg", meta: "2.1 MB" }] } ] }
```

**stat** — one big number (counts up if numeric like "10,000,000"; shown as-is if not like "live").
```ts
{ kind: "stat", value: "10,000,000", label: "events decoded", sub: "block 0 → chain tip" }
```

**proof** — ed25519 signature as the hero + a drawn ✓ verified.
```ts
{ kind: "proof", eventLine: "ft_transfer · 1,200 sBTC", cursor: "951475:3",
  signature: "3a9f8c217b14…2e9d", keyId: "f3a9…2b1c" }
```

**stream-resume** — a resume cursor + events flowing past it.
```ts
{ kind: "stream-resume", fromCursor: "951475:3",
  rows: [{ cursor: "951475:4", label: "print · swap" }, { cursor: "951476:0", label: "ft_transfer" }] }
```

**fork** — a chain fork; orphan archived, new tip lit. Use states canonical/orphaned/new.
```ts
{ kind: "fork", rewindTo: "951472:0", blocks: [
  { height: 951472, hash: "a3f9", state: "canonical" },
  { height: 951474, hash: "7e2d", state: "orphaned" },
  { height: 951474, hash: "c8a1", state: "new" } ] }
```

**upload-progress** — a progress bar + pause/resume.
```ts
{ kind: "upload-progress", file: "datasets/sbtc.parquet", sizeMB: 210, parts: 14 }
```

**status** — service health rows. state ∈ ok | syncing | error | idle.
```ts
{ kind: "status", title: "status",
  services: [{ name: "api", state: "ok" }, { name: "indexer", state: "syncing", detail: "−2 blocks" }] }
```

**diagram** — a small pipeline; exactly one `api` node (the product surface).
```ts
{ kind: "diagram", note: "decoded once — query forever",
  nodes: [{ id: "node", label: "Stacks node", type: "default" },
          { id: "idx", label: "Indexer", type: "data" },
          { id: "api", label: "Index API", type: "api" }],
  edges: [{ from: "node", to: "idx", label: "events" }, { from: "idx", to: "api", label: "decoded" }] }
```

Adding a brand-new panel kind is a code change (a component in
`src/components/panels/` + the registry + the schema), not something to author in
a beats file. If a request needs a visual none of these cover, say so and design
it with `/frontend-design` first (see the playground at `mocks/playground.html`).

## Motion vocabulary

You rarely set motion — the engine applies a sensible default per element. Override
only with a reason, using one of these names:

- enter: `rise settle bloom type stagger draw count`
- exit: `sink dissolve lift cut`

```ts
headlineMotion: { enter: "rise", delay: 8 }
code: { ..., motion: { enter: "settle", delay: 12 } }
panel: { ..., motion: { enter: "settle" } }
```

The full content→motion taxonomy (which element speaks which transition) is
documented in the engine package's `MOTION.md`. Easing is fixed by the brand:
ease-out only, `smooth` for entrances, `snappy` only for small state pops.

## Formats

| format | dimensions | use |
|--------|-----------|-----|
| `16x9` | 1920×1080 | site hero, YouTube, the default |
| `1x1`  | 1080×1080 | X / LinkedIn in-feed |
| `9x16` | 1080×1920 | Stories / Shorts / Reels |

The same beats render in all three; 16:9 lays code+panel side-by-side, the others
stack them. Set `format` in the file or override with `--format` at render time.

## Backgrounds

**Default: omit `background`** on every beat. You then get a procedural,
theme-colored backdrop (soft gradient arcs) — no asset, no API key, and it stays
consistent across the video. This is the right choice for almost everything.

Use one background per video for continuity. The options, set per beat:

```jsonc
// (default) omit `background` entirely → procedural theme-colored shapes
{ "shapes": true }                                   // the same, explicit
{ "gradient": ["#312e81", "#0b1120"], "angle": 155 }  // AI-free gradient
{ "solid": "#0b1120" }                                // AI-free solid
{ "src": "backgrounds/pennybacker.png" }              // optional painterly pack
```

The **painterly pack** (19th-century landscape paintings) is optional and ships with
the engine: `backgrounds/pennybacker.png`, `congress.png`, `mount-bonnell.png`,
`barton-springs.png`, plus `capitol`, `ut-tower`, `enchanted-rock`, `hamilton-pool`.
Generating new ones needs `cadence art …` and an `OPENAI_API_KEY` (the only part of
the toolchain that calls an API). The procedural default is preferred for an
on-brand, key-free look.

## Sequencing model

Within a code+panel beat the engine runs things one at a time, like a demo:

```
beat starts → code window types out (panel absent)
            → typing finishes (caret disappears)
            → short pause ("running…")
            → output panel settles in and runs its reveal
```

This is automatic — `ChangelogScene` computes when typing ends and delays the
panel. That's why code+panel beats need ~235 frames: the panel's clock doesn't
start until the code is done. Tuning knobs live in code, not in beats:
`CHARS_PER_FRAME` (typing speed, `CodeWindow.tsx`) and `OUTPUT_GAP` (the pause,
`ChangelogScene.tsx`).

## Title typography

Handled by the engine — you only supply the strings. For reference, it matches the
cadence look: a gold (`#c08a2e`) uppercase tracked **eyebrow** (Fira Code),
a heavy tight white **headline** (Sora 700, −0.025em) with a soft shadow, and an
optional gold **version pill** + dotted **caption** on closers. Keep eyebrows
lowercase in the data; the engine uppercases them.
