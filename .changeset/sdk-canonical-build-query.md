---
"@secondlayer/sdk": patch
---

Datasets, Index, and Streams clients build query strings through one canonical `buildQuery` helper instead of copy-pasted append helpers; fixes a dangling `?` on `/v1/index/events` when called with no filters.
