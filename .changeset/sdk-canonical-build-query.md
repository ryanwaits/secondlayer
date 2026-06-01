---
"@secondlayer/sdk": patch
---

Index and Streams clients build query strings through one canonical `buildQuery` helper instead of three copy-pasted append helpers; fixes a dangling `?` on `/v1/index/events` when called with no filters.
