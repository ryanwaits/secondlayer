---
"@secondlayer/api": patch
---

`/internal/sentinel/tokens/resolve` returns the account's email (lowercased, omitted when the account has none) and `linked` for a session, so Sentinel can create its user on first sign-in. Key resolves are unchanged.
