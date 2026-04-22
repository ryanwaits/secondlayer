---
"@secondlayer/cli": patch
---

Pricing Sprint B — introduce the Hobby (free) plan + Nano compute.

- New `hobby` PlanId in the provisioner + API routes + CLI. Nano spec: 0.5 vCPU / 512 MB RAM / 5 GB storage.
- Biased container allocation (60/25/15, PG-heavy) for sub-1GB plans so Postgres's default `shared_buffers` isn't starved.
- `sl instance create` defaults to `--plan hobby` (zero-friction entry). `sl instance resize` interactive prompt lists Hobby as the first option.
- Dashboard `ProvisionStart` adds a Hobby card pre-selected by default.
- Auto-resume on mint-ephemeral: every tenant-scoped CLI command that mints a 5-min JWT now transparently resumes a Hobby tenant that was auto-paused for idleness. Paid-tier manual suspensions (`sl instance suspend`) are never auto-resumed.
- Dashboard banner copy differentiates Hobby auto-pause ("next CLI command auto-resumes") from paid-tier manual suspension.
