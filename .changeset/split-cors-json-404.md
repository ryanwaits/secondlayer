---
"@secondlayer/api": minor
---

Split CORS: public read surfaces (`/v1/*`, `/health`, `/public/*`) now use `Access-Control-Allow-Origin: *` (no credentials) so browsers from any third-party origin can fetch datasets, index, and streams. `/api/*` keeps the dashboard allowlist + credentials for session-cookie / Bearer-mutation routes. Exposes rate-limit headers (`X-RateLimit-*`, `Retry-After`, `ETag`) on public responses. Unmatched routes now always return JSON `{error, code:"NOT_FOUND", path}` instead of text/plain 404.
