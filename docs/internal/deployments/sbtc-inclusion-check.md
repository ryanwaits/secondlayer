# Deployment: sBTC inclusion check

First instance of the deployments checklist. Status: not built and unfunded.
The Q3 2026 Stacks Endowment Builder application was declined, and the smaller
Getting Started follow-up was dropped unfiled on 2026-09-21. No repo, subgraph,
webhook or page exists; `apps/web` has no page for it. Any future build plan is
written from this checklist.

Intended surfaces: a subgraph table, webhook alerts, a public status page, an
open-source verifier. Continuously running attestation loop over sBTC mints and
pox-5 L1 lockups.

## Checklist

- **repo URL**: TBD. Standalone public repo (e.g. `sbtc-inclusion-check`);
  depends only on published `@secondlayer/*` packages.
- **published-package pins**: TBD. Pin `@secondlayer/sdk`,
  `@secondlayer/subgraphs`, `@secondlayer/stacks`, `@secondlayer/cli` to a
  range; weekly CI against `latest`.
- **account**: TBD. Dedicated shared deployments account (e.g.
  `deployments@…`), never a personal inbox. Secret name
  `DEPLOYMENTS_ACCOUNT_KEY` only.
- **subgraph name**: TBD. Hosted subgraph under the deployments account.
  Tables: sBTC mints `{mint, txid, vout, amount, mined, script_match,
  amount_match}`; second table for pox-5 L1 lockups (same loop over decoded
  `pox5_events` lockup txids). Collateral-mix reporting (L1 vs sBTC) on the
  public page. Index join keys already exist (`/v1/index/sbtc/deposits`,
  `/v1/index/sbtc/events`, `/v1/index/pox5/events`, …). Adapter:
  `SP2M1DE95TS0QBM4K893X6ST49FFJ53CCX9CYWNVY.spv-adapter`.
- **webhook names**: TBD. Chain Webhooks owned by the deployments account.
  Requirement: alert on any mint or lockup miss (mined / script_match /
  amount_match), with a synthetic fail exercising the path. **Open decision:**
  webhooks fire on chain events, not subgraph rows, and a miss is a computed
  row, so what turns a miss into an alert is undecided.
- **status page path**: `/sbtc-inclusion` under `secondlayer.tools`. Same
  visual world; mono tag "public good · grant-funded"; line "built on
  Subgraphs and Webhooks". Shows outstanding sBTC vs independently proven P2TR
  outputs; bond collateral split (L1 vs sBTC).
- **public page read path**: **Open decision.** Subgraphs have no public
  visibility and hosted `/v1` without a key returns 401, so the page cannot
  read the table anonymously.
- **open-source verifier runbook link**: TBD. Tagged verifier + runbook so a
  signer or Labs engineer can run it on their own instance.
- **ops owner**: TBD. Ongoing integrity labor: node upgrades, index health,
  proof source, signer P2TR rotations, incident response.
- **funding source and end date**: None.
- **sunset rule**: TBD with funding. Default: with no funding and no paying
  customer, the public page sunsets with notice and the repo stays up for
  anyone who wants to run it. Paid edges (webhook SLA, private destinations,
  dedicated proof source) are a per-deployment conversation, never a SKU.

## Design notes

- Success is coverage and a fail-closed check, not TVL or users.
- Lag target ≤ 2 Bitcoin blocks behind Index for new mints.
- Does not stop threshold FROST signers spending the peg UTXO. Does not
  parse deposit tapleafs. States those limits on the page.
- Self-host path is first-class: operator pays their own box.
