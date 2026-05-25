# Product

## Register

product

> Default register is **product** (the `/platform` console, `/admin`, auth, key
> management, data browser, sandbox). The public marketing + docs site
> (`(www)`: `/`, `/datasets`, `/docs`, `/streams`, `/subgraphs`, `/pricing`) is a
> **brand** surface and should be treated as `brand` per-task. Both share one
> token system; the visual references differ by surface (see Design Principles).

## Users

Stacks application developers and the agents acting on their behalf. They are
technical: they run nodes, write decoders, handle reorgs, and design schemas
today, and they want to stop. Their context when using the product is a working
session, mid-build: deploying a subgraph, inspecting decoded events, wiring a
webhook, checking usage, managing an API key. They reach for the CLI, SDK, MCP,
or REST first; the platform UI is where they verify state, browse data, and
manage the account behind those surfaces.

The job to be done: go from "I have an idea" to "I have an indexed dataset and a
working query" without rebuilding indexing infrastructure. On any given platform
screen the primary task is operational, confirm a deploy, read a payload, copy a
key, watch a stream, not exploratory.

## Product Purpose

Second Layer is the data plane for Stacks: dedicated indexing, real-time
subgraphs, and a viem-style chain SDK, exposed through one API, one auth model,
and interchangeable front-ends (CLI, SDK, MCP, REST). The chain produces events;
Second Layer shapes, decodes, joins, and delivers them as independently useful
layers (raw events, decoded transactions, app-specific views).

It exists because that indexing work is undifferentiated infrastructure that
every team rebuilds. Second Layer runs it as a utility. Success: every serious
Stacks app reads from Second Layer for at least one workload, the Foundation
Datasets become the canonical reference for ecosystem analytics, and a new
developer ships an indexed query in under thirty minutes without a node.

## Brand Personality

**Calm, precise, candid.** Confidence without hype.

The product voice is "calm infrastructure": boring, observable, dependable, and
proud of it. Reputation is the moat, so the interface should read as
trustworthy rather than clever. It is developer-first and documentation-grade,
opinionated about the right shape of data, and candid, it shows the real
architecture and credits its lineage (Project Kourier) directly. Generous, not
guarded: SDKs and datasets are open public goods; the tone is good-citizen, not
land-grab.

Emotional goal on the platform: quiet competence. The user should feel the
system is in control and legible, never overstimulated, never sold to.

## Anti-references

Match-and-refuse all four. If output drifts toward any of these, rework it.

- **Crypto / web3 neon.** No neon-on-black, glows, 3D coins, gradient-mesh
  heroes, "degen" energy. This is the first reflex for a chain product; avoid it.
- **Generic SaaS template.** No hero-metric template, identical feature-card
  grids, gradient-text headings, Inter-on-cream sameness.
- **Heavy enterprise.** No navy-and-gold corporate, legalese, stock photography,
  bloated marketing chrome.
- **Playful / consumer.** No rounded blobs, mascots, cartoon palettes, oversized
  friendly emoji.

## Design Principles

1. **Calm infrastructure.** Boring, observable, dependable beats clever.
   Legibility and trust over novelty; the UI should disappear into the work.
2. **Practice what you preach.** A data-plane product proves itself by showing
   real, accurate data, pipeline-accurate diagrams, honest payloads, live state,
   not marketing abstractions of it.
3. **Layered and independently useful.** Mirror the product architecture: each
   surface (datasets, index, subgraphs, subscriptions, streams) is its own
   coherent thing, not a variation on one template.
4. **Show, don't tell, and credit the source.** Lead with the actual query,
   schema, or event; be candid about how it works and where the model came from.
5. **Reference split by surface.** Platform/console aesthetic follows **LiveKit**
   (dense, functional, mono-accented, clean borders, light/dark parity, calm but
   information-rich). Marketing/docs aesthetic follows **benji.org** (editorial,
   refined typography, generous whitespace, restrained motion, confident
   minimalism). Both draw from the same token system; never swap their density.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**, with motion treated as enhancement only.

- AA contrast across both light and dark themes (the system ships both; maintain
  parity, no light-only or dark-only contrast regressions).
- Full keyboard navigation; visible, deliberate focus states (the console
  suppresses native focus rings, so custom focus affordances are mandatory, not
  optional).
- `prefers-reduced-motion`: respect everywhere. Animations are decoration the
  product can do without; existing patterns (e.g. skeleton pulse) already gate on
  it, hold that line.
- Don't encode meaning in color alone; pair status hues (green/yellow/red/teal)
  with text or icon.
