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

One standalone public repo per deployment (e.g.
`secondlayer-labs/sbtc-inclusion-check`). It depends only on published
`@secondlayer/sdk`, `@secondlayer/subgraphs`, `@secondlayer/stacks`, and
`@secondlayer/cli`. Reason: the grant promises a signer or Labs engineer can
run it against their own node, and "build for everyone" forbids a
monorepo-only special case. Cost: version drift against published packages.
Mitigate with a pinned range and a weekly CI run against `latest`.

## Where it runs

On our hosted instance, as a subgraph under a Secondlayer-owned account with
`visibility: public`, plus Webhooks owned by the same account for alerts.
Account convention: a dedicated shared inbox (`deployments@` or similar),
never a personal address. Secret name only (e.g. `DEPLOYMENTS_ACCOUNT_KEY`);
never a value in this doc. Flipping visibility currently has no public write
API (`subgraphs_publish` / `subgraphs_unpublish` are absent). Open question
below.

Anonymous hosted reads of a `visibility: public` subgraph already work
(`platform anon` in `packages/api/src/routes/v1-subgraphs.ts`).

## Where it is seen

Status page at `secondlayer.tools/<job-slug>` (e.g. `/sbtc-inclusion`).
Rendered from the public `/v1/subgraphs/<name>/<table>` read. Same visual
world as the platform. One mono tag ("public good · grant-funded"). The line
"built on Subgraphs and Webhooks". Never a subdomain. Never its own
wordmark.

## How it is named

By job. Naming test: a reader who has never heard of Secondlayer should be
able to say what it checks from the name alone. "sBTC inclusion check"
passes. A product noun or a Labs-branded title fails.

## What it must not become

Not a catalog. Not a sub-brand. Not a SKU. Paid follow-ons (paged alerts,
private destinations, SLA) go through the Enterprise custom door. The
open-source verifier and the public page stay free; paid edges do not rename
the deployment.

## Checklist

Copy into each `docs/internal/deployments/<slug>.md` and fill before build:

- **repo URL**
- **published-package pins**
- **account**
- **subgraph name + visibility**
- **webhook names**
- **status page path**
- **open-source verifier runbook link**
- **ops owner**
- **funding source and end date**
- **sunset rule**

## Open questions

- Status page as a Next route in `apps/web` vs a static export.
- How `visibility: public` is set without `subgraphs_publish` (SQL on the
  hosted box vs restore a publish route). Recorded as an ops path, not a
  product commitment.
- Exact shared-account email and secret store for `DEPLOYMENTS_ACCOUNT_KEY`.
