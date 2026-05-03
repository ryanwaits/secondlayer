# Vision

Second Layer is the data plane for Stacks.

The chain produces events. Applications need those events shaped, decoded, joined, and delivered in ways no single API can anticipate. Today, every team building on Stacks rebuilds the same indexing infrastructure — running their own nodes, writing their own decoders, handling their own reorgs, designing their own schemas. That work is undifferentiated. It should be a utility.

We run that utility.

---

## What we believe

**The right shape is layered, not monolithic.** Raw events should be queryable. Decoded transactions should be queryable. App-specific views should be definable on top of both. Each layer is independently useful, independently priced, and independently versioned. Teams pick the layer that matches their problem and ignore the rest.

**Read APIs are the contract; storage is implementation.** What we expose is data, not a database. Customers don't inherit our Postgres choice or our schema decisions. The SDK works against any storage; subgraphs let teams define their own shape. We are responsible for correctness; they are responsible for taste.

**Push and pull are different products.** Cursor APIs and bulk dumps are the right shape for indexers, archivers, and backfill. Managed tails and notifications are the right shape for app event loops. Webhook delivery from raw chain events is its own animal — and Hiro Chainhooks already runs that lane. We don't rebuild it.

**Calm infrastructure beats clever infrastructure.** Hot-spare nodes. Idempotent ingest. Deterministic replay. Public status page. Boring, observable, dependable. Reputation is the moat.

**Generous to the ecosystem.** SDKs, CLIs, and subgraph templates are open source. The five Foundation Datasets are public goods. We monetize hosted, supported infrastructure — not access to public chain data. The Stacks ecosystem is small enough that being a good citizen is also the strategy.

---

## Where we sit in the stack

Hiro is the developer platform — wallets, contracts, deploys, the dashboard most builders interact with daily. We sit underneath: the data plane that powers app-specific indexing, custom subgraphs, public datasets, and AI-agent access to chain state.

Most teams will use both. Many will use Second Layer without realizing it — through a Hiro-branded surface, a wallet integration, or a community-maintained dataset. That is fine and intended. Infrastructure becomes invisible when it works.

We are not "Hiro for power users" and we are not a Hiro competitor. We are a layer. Hiro can run on top of us; community projects can run on top of us; foundation work can run on top of us. The platform's value compounds with every consumer it earns.

---

## Lineage

The architectural model behind Second Layer is not new. In 2022, Thomas Osmonson (aulneau) at Fundamental Systems published *Project Kourier* — a written and recorded walkthrough of exactly this layered, "stacked indexers" approach to Stacks data infrastructure. The full reference transcript is preserved at [`docs/references/project-kourier-transcript.md`](docs/references/project-kourier-transcript.md).

We credit that work directly. Kourier identified the right decomposition: a raw-events layer that anyone can mirror, a canonical-state layer that handles reorgs once on behalf of every downstream consumer, and a per-app indexing layer where teams shape data however they need. It also predicted, in the author's own words, that this same architecture could power the Hiro API itself — Hiro as a consumer of the data plane rather than the sole producer.

Second Layer ships that vision. The product names are ours; the layered model is the ecosystem's. Where Kourier was a proposal, Second Layer is the running system.

---

## What success looks like

- Every serious Stacks app reads from Second Layer for at least one workload.
- The five Foundation Datasets become the canonical reference for ecosystem analytics.
- Hiro runs at least one production workload on the Partner Platform.
- The Stacks Foundation funds the Datasets shelf as ongoing public-good infrastructure.
- A new Stacks developer can go from "I have an idea" to "I have an indexed dataset and a working query" in under thirty minutes, without running a node.

---

## What we are not

- Not a wallet platform. Wallets consume Hiro; we partner with that flow.
- Not a webhook delivery service for raw events. That is Hiro Chainhooks' lane.
- Not a multi-chain platform — yet. EVM and other L2s come only after Stacks position is unambiguous.
- Not a marketplace. Templates yes, third-party rev-share no, until Partner Platform proves out.
- Not a node-as-a-service product. Running nodes is internal infrastructure, not a product line.

These omissions are deliberate and durable. Discipline at the edges is what makes the center sharp.

---

*This document is the strategic anchor. When the roadmap conflicts with this file, this file wins. Update it deliberately.*
