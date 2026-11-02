# Deployments placement

Decision record for where grant-funded and one-off work lives on the
Secondlayer plane. Companion checklist for each instance lives under
`docs/internal/deployments/<slug>.md`. First instance:
`docs/internal/deployments/sbtc-inclusion-check.md`.

## What a deployment is

A deployment is something we run on the plane for a third party or as a
public good. It is a fourth tier: not a product, not a feature, not a
channel. It is built with the products (a subgraph table, webhook alerts, a
status page), so it fails the account test and inherits the brand. Named by
job. One mono tag. Never its own wordmark.

## Where the code lives

One standalone public repo per deployment (e.g. `sbtc-inclusion-check`). It
depends only on published `@secondlayer/sdk`, `@secondlayer/subgraphs`,
`@secondlayer/stacks`, and `@secondlayer/cli`. Reason: the verifier must run
on the operator's own instance, and "build for everyone" forbids a
monorepo-only special case. Cost: version drift against published packages.
Mitigate with a pinned range and a weekly CI run against `latest`.

## Where it runs

The hosted table is a subgraph under a Secondlayer-owned account, plus chain
Webhooks owned by the same account. Account convention: a dedicated shared
inbox (`deployments@` or similar), never a personal address. Secret name only
(e.g. `DEPLOYMENTS_ACCOUNT_KEY`); never a value in this doc.

Webhooks fire on chain events, not on subgraph rows. An alert that depends on
a value computed into a row needs something else to read that row, decided per
deployment.

## Where it is seen

Status page at `secondlayer.tools/<job-slug>` (e.g. `/sbtc-inclusion`). Same
visual world as the site. One mono tag ("public good", "grant-funded"). The
line "built on Subgraphs and Webhooks". Never a subdomain. Never its own
wordmark.

Subgraphs have no public visibility (dropped, migration 0136) and hosted `/v1`
without a key returns 401, so the page cannot read its table anonymously. Each
deployment's public page needs its own read path, decided per deployment.

## How it is named

By job. Naming test: a reader who has never heard of Secondlayer should be
able to say what it checks from the name alone. "sBTC inclusion check"
passes. A product noun or a Labs-branded title fails.

## What it must not become

Not a catalog. Not a sub-brand. Not a SKU. Paid follow-ons (paged alerts,
private destinations, SLA) are a per-deployment conversation. The open-source
verifier and the public page stay free; paid edges do not rename the
deployment.

## Checklist

Copy into each `docs/internal/deployments/<slug>.md` and fill before build:

- **repo URL**
- **published-package pins**
- **account**
- **subgraph name**
- **webhook names**
- **status page path**
- **public page read path** (open decision until filled)
- **open-source verifier runbook link**
- **ops owner**
- **funding source and end date**
- **sunset rule**

## Open questions

- Status page as a Next route in `apps/web` vs a static export.
- Exact shared-account email and secret store for `DEPLOYMENTS_ACCOUNT_KEY`.
- GitHub org for deployment repos.
