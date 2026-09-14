# Deployment: sBTC inclusion check

First instance of the deployments checklist. Source of truth for grant text:
`/Users/ryan/grants/GRANT.md` (do not edit that file). Build plan, when the
grant is awarded, is written from this checklist, not from GRANT.md.

Surfaces promised by the grant: a subgraph table behind `/v1`, webhook
alerts, a public status page, open-source verifier. Continuously running
attestation loop over sBTC mints and pox-5 L1 lockups.

## Checklist

- **repo URL**: TBD (grant decision ~2026-10-01). Proposed
  `secondlayer-labs/sbtc-inclusion-check`. Standalone public repo; depends
  only on published `@secondlayer/*` packages.
- **published-package pins**: TBD (grant decision ~2026-10-01). Pin
  `@secondlayer/sdk`, `@secondlayer/subgraphs`, `@secondlayer/stacks`,
  `@secondlayer/cli` to a range; weekly CI against `latest`.
- **account**: TBD (grant decision ~2026-10-01). Dedicated shared
  deployments account (e.g. `deployments@…`), never a personal inbox.
  Secret name `DEPLOYMENTS_ACCOUNT_KEY` only.
- **subgraph name + visibility**: TBD (grant decision ~2026-10-01) for the
  exact name. Visibility `public` under the deployments account. Tables:
  sBTC mints `{mint, txid, vout, amount, mined, script_match, amount_match}`;
  second table for pox-5 L1 lockups (same loop over decoded `pox5_events`
  lockup txids). Collateral-mix reporting (L1 vs sBTC) on the public page.
  Index join keys already exist (`/sbtc/deposits`, `/sbtc/events`,
  `/pox5/events`, …). Adapter:
  `SP2M1DE95TS0QBM4K893X6ST49FFJ53CCX9CYWNVY.spv-adapter`.
- **webhook names**: TBD (grant decision ~2026-10-01). Alerts as chain /
  subgraph Webhooks owned by the deployments account. Alert on any mint or
  lockup miss (mined / script_match / amount_match). Staging path exercises
  a synthetic fail.
- **status page path**: `/sbtc-inclusion` under `secondlayer.tools`. Same
  visual world; mono tag "public good · grant-funded"; line "built on
  Subgraphs and Webhooks". Renders from the public `/v1/subgraphs/<name>/<table>`
  read. Outstanding sBTC vs independently proven P2TR outputs; bond
  collateral split (L1 vs sBTC).
- **open-source verifier runbook link**: TBD (grant decision ~2026-10-01).
  M3 deliverable: tagged verifier + runbook so a signer or Labs engineer can
  run it against their own node. Optional Clarity 6 `sbtc-deposit` sketch is
  not a grant-blocking milestone.
- **ops owner**: TBD (grant decision ~2026-10-01). Year-1 integrity labor is
  in the grant ask ($4,000): node upgrades, index health, proof source,
  signer P2TR rotations, incident response.
- **funding source and end date**: Q3 2026 Stacks Endowment Builder track,
  $32,000 ($22,000 ship + $10,000 year-1 ops). Milestones assume decision
  ~2026-10-01: M1 2026-10-15 (spec + 30d replay), M2 2026-10-29 (production
  loop + subgraph + webhook), M3 2026-11-12 (public page + verifier; year-1
  ops line starts). Year-1 ops covers twelve months after ship (~$833/month:
  $500 box + ~$333 integrity).
- **sunset rule**: quote from GRANT.md: "If there is no renewal and no SLA
  customer, the public page sunsets with notice, and the repo remains for
  anyone who wants to run it." Public page stays free; paid edges
  (webhook SLA, private destinations, dedicated proof source) go through
  the Enterprise door, never a SKU.

## Notes from the grant (not checklist fields)

- Success is coverage and a fail-closed check, not TVL or users.
- Lag target ≤ 2 Bitcoin blocks behind Index for new mints.
- Does not stop threshold FROST signers spending the peg UTXO. Does not
  parse deposit tapleafs. States those limits on the page.
- Self-host path is first-class: operator pays their own box.
