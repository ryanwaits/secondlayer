---
"@secondlayer/api": patch
---

fix deploy.sh silently redeploying the previous SHA. `docker/scripts/deploy.sh` now snapshots `DEPLOY_IMAGE_OWNER/TAG/SHA` from the deploy invocation BEFORE sourcing `.env`, then re-applies them on top. Without this, the `record_successful_deploy` step from the prior fix would persist these keys into `.env` and then `source .env` would override the next deploy's env vars with the previous deploy's tag — making every subsequent deploy a silent rollback. Companion change in `scripts/ci/post-deploy-smoke.sh` asserts `/health.image_sha` matches `$EXPECTED_DEPLOY_SHA` (wired from `${{ github.sha }}` in the workflow) so this failure mode fails the deploy job instead of going green.
