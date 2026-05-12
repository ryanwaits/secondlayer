---
"@secondlayer/api": patch
---

surface deploy SHA on `/health` so drift is detectable without shelling in

`GET /health` now returns `{ status: "ok", image_sha }` where `image_sha` is the git SHA the Deploy workflow built this container from. Companion change to `docker/scripts/deploy.sh` persists `DEPLOY_IMAGE_OWNER` / `DEPLOY_IMAGE_TAG` into `/opt/secondlayer/docker/.env` after a successful deploy so subsequent manual `docker compose up -d <service>` no longer falls back to compose-file defaults and silently rolls a service back to a different image.
