---
"@secondlayer/api": minor
---

`GET /public/status` reports `index.events_total`, the count of canonical chain events stored (the archive's `events` dataset), served from an in-memory counter refreshed every ~10s. The response now sends `Cache-Control: public, max-age=5, s-maxage=5`.
