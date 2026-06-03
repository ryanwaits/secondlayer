---
"@secondlayer/shared": minor
---

Add `@secondlayer/shared/index-http` — a minimal cursor-paginated transport for the public Index (`/v1/index`) + Streams clock (`/v1/streams`) APIs, plus the Index wire-row types. Lives in `shared` (a leaf both the SDK and the subgraph runtime depend on) so the wire format has a single home and no package cycle.
