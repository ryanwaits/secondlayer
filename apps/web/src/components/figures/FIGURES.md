# Writings figure library — scope

Component inventory for the writings platform. Every figure ships as an MDX
React component on the site tokens, follows the dataviz house method
(validated palettes, direct labels, hover layer, reduced-motion fallback), and
uses one shared chrome: `Fig. N` eyebrow, title, body, caption.

Shared identity system: series/role colors are semantic and constant across a
post (e.g. blue = receipt/delivered, amber = bookmark/scanned) — never cycled.
Palette pairs validated per theme with `dataviz/scripts/validate_palette.js`
(light `#2563eb`/`#d97706`, dark `#5e81ea`/`#bd8412` are the first approved
pair).

## A — Text-first (subtle or no interactivity)

| id | component | use when | notes |
| --- | --- | --- | --- |
| A1 | `<StatTile>` | one number IS the point | value + label + optional delta/spark; tabular-nums |
| A2 | `<TermPair>` | two concepts to hold apart | side-by-side hairline cards; role carried by a dot marker + colored term, never an accent stripe (impeccable ban) |
| A3 | `<Matrix>` | 2×2 tradeoff / asymmetry | cells carry cost chips (cheap/dear semantic colors) |
| A4 | `<AnnotatedPayload>` | explaining a JSON/wire shape | hover/tap a field → its annotation highlights; keyboard focusable |
| A5 | `<Sidenote>` | tangents, sources, precision hedges | numbered margin notes ≥1100px, inline-expandable below; tap target ≥44px |

## B — Diagrams (medium interactivity)

| id | component | use when | notes |
| --- | --- | --- | --- |
| B1 | `<PositionTrack>` | positions on one axis (heights, offsets) | COLLISION RULE: markers within 8% merge flags into one combined label; values stagger on two tiers; leader lines when displaced |
| B2 | `<FlowLoop>` | request/response, polling, handshakes | shuttle dot (CSS keyframes), counters; static arrows under reduced-motion |
| B3 | `<Timeline>` | ordered events, before/after | mono tick labels, event flags with the B1 collision rule |
| B4 | `<Lifecycle>` | state machines (cursor states, tx states) | SVG nodes+edges; active-state stepping via D3 controls |
| B5 | `<PipelineFlow>` | multi-stage systems (decode → index → serve) | svg-animation skill: dashoffset draw-in on scroll, flow pulses |

## C — Charts (dataviz method, full hover layer)

| id | component | use when | notes |
| --- | --- | --- | --- |
| C1 | `<LineChart>` | change over time, 1–4 series | crosshair + clamped tooltip; end labels with vertical collision resolution (nudge ≥14px apart); threshold lines use status colors |
| C2 | `<BarChart>` | magnitude comparison | thin marks, 4px rounded data-end only, 2px gaps |
| C3 | `<SmallMultiples>` | same measure, many entities | shared scales, one legend |
| C4 | `<CellStrip>` | density/occupancy along an axis | the Fig-4 strip generalized; 2px gaps, hit cells in role color |

## D — Explorers (high interactivity, one per post max)

| id | component | use when | notes |
| --- | --- | --- | --- |
| D1 | `<ParamExplorer>` | a parameter changes the regime | slider → live re-render; merged-pointer labels when gap < 10%; readout sentence updates |
| D2 | `<ScenarioToggle>` | two named worlds to compare | segmented buttons drive any child figure's state |
| D3 | `<StepThrough>` | an algorithm's phases | prev/next steps a diagram; step captions; keyboard arrows |

## Expansion scope (round 2)

### A — text-first additions

| id | component | use when | interaction |
| --- | --- | --- | --- |
| A6 | `<AnnotatedCode>` | explaining LOGIC line by line (A4 is for data shapes) | hover/tap a line → margin note lights; numbered line callouts |
| A7 | `<CodeDiff>` | migrations, before/after refactors | toggle old/new or unified view; changed lines tinted (ok/alarm at 8%) |
| A8 | `<InvariantList>` | numbered contracts (the 13 sink invariants) | each row anchor-linkable, click expands the failure story |
| A9 | `<Term>` | first use of a coined term (receipt, bookmark, sink) | dotted underline; hover/tap shows the definition; one shared glossary per post |
| A10 | `<SpecSheet>` | key-value facts about one thing (an endpoint, a table) | static; mono rows, house data-table voice |
| A11 | `<SourceQuote>` | quoting an RFC/spec/paper (story-mining layer) | static; citation line links out |

### B — diagram additions

| id | component | use when | interaction |
| --- | --- | --- | --- |
| B6 | `<SequenceDiagram>` | 3+ parties exchanging messages over time | hover a message → both lifeline points highlight; step-through optional |
| B7 | `<LayerStack>` | layered architecture (chain → index → API → app) | hover/tap a layer → it lifts, note appears; THE on-brand diagram |
| B8 | `<TreeWalk>` | index/B-tree lookups, ancestry | click a key → path to it highlights (the "log-time seek" figure) |
| B9 | `<BeforeAfter>` | two states of the same diagram | segmented toggle or drag divider; shared geometry, only deltas move |
| B10 | `<StateRow>` | linear status progressions (pending → confirmed → finalized) | click advances; house badge colors; keyboard arrows |

### C — chart additions

| id | component | use when | interaction |
| --- | --- | --- | --- |
| C5 | `<Distribution>` | latency/size spreads | histogram, hover per-bin; percentile markers direct-labeled |
| C6 | `<DeltaBars>` | before/after magnitudes | paired thin bars per entity, delta labeled, hover detail |
| C7 | `<InlineSpark>` | a trend mentioned mid-sentence | word-scale sparkline inline with prose; no axes, endpoint dot; title attr for a11y |
| C8 | `<HeatCalendar>` | activity over days/weeks | sequential ramp (validated), hover per-cell |

### D — explorer additions + house adoptions

| id | component | use when | interaction |
| --- | --- | --- | --- |
| D4 | `<Predict>` | pedagogical beats ("what happens next?") | reader commits to a guess (buttons), then reveal; state persists per post |
| D5 | `<CrossHighlight>` | input↔output correspondence (query ↔ rows, code ↔ render) | hover either side → its counterpart highlights |
| D6 | `<MiniSandbox>` | ADOPT `dataset-sandbox` from DESIGN.md | the existing one-cell request/response playground, embedded in a post |
| D7 | `<CopyBlock>` | ADOPT `agent-prompt` from DESIGN.md | copyable hand-to-your-agent block with collapse mask |

**Adoption rule:** D6/D7 (and the mono Data Table for A10, and the Service Flow
Diagram's node classes — Chrome default / accent-bg data / filled-accent product —
for B5/B7) already exist in production. The library wraps them, never forks them:
one implementation, two mounts (product pages + writings).

## Status: SHIPPED as React components (port v1)

Every scoped type ships as a component in this directory (one file per
figure; see `index.ts` for the export list). 33 live + D7 CopyBlock
adopting the production agent-prompt block. D6 MiniSandbox stays a
reserved slot: the dataset sandbox it adopted left production, so it
returns when a post needs a live request cell.

Live catalog: `/writing/figures` (public, noindex) — the acceptance page,
rendered from these components with specimen data. Posts import figures
explicitly from `@/components/figures` (never via the global MDX map,
which would put client figures on every docs bundle). Explorer
compositions (render props) live per-post as small client files next to
the post's `page.mdx` — see the checkpoint post's `selectivity-explorer.tsx`.

## Refinement backlog

- [x] B1 label collision: merge rule + tiered values (`collide.ts`)
- [x] D1 pointer collision: merged single label under threshold
- [x] C1 end-label collision + tooltip clamped both edges
- [x] B5 pipeline (dash-march edges, service-flow node grammar) + D3 step-through built
- [x] A4/A5/A9 touch: tap-to-pin wired (`use-hover-pin.ts`)
- [x] Impeccable pass: house tokens, Flat-By-Default, no accent stripes, no em dashes, Weight-Not-Size headings
- [x] Shared `<FigShell>` chrome extracted (`fig-shell.tsx`)
- [x] D7 wraps the real production component; D6 slot reserved (component was removed from production)
- [ ] A5 Sidenote: true margin placement ≥1100px (currently inline-expand at all widths)

## Process per new figure

1. Pick the form via dataviz `choosing-a-form` (is it even a chart?)
2. Colors by role from the approved pairs (`--fig-role-a/b` in globals.css, all four theme blocks); new pairs must pass the validator in BOTH themes
3. Build against `/writing/figures`; check label collision at extreme states
4. Reduced-motion + keyboard + touch pass (emil checklist)
5. Add to the catalog page with a when-to-use line
