---
"@secondlayer/provisioner": patch
---

Pivot tenant public routing from Traefik to Caddy wildcard + on-demand TLS. Provisioner drops the `traefik.*` container labels (dead code after pivot) and adds an unauth `GET /internal/caddy/ask?domain=<host>` endpoint — called in-cluster by Caddy before issuing a Let's Encrypt cert for `{slug}.{base}`. Returns 200 iff `sl-api-{slug}` exists.
