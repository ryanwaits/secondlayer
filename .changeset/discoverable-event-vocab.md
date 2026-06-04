---
"@secondlayer/api": minor
---

Make the Index and Streams event vocabularies runtime-discoverable. `GET /v1/index` now exposes a machine-readable `event_type_filters` map — per event type its `columns`, `allowed_filters`, `equality_filters`, and `required_non_null` (generated from the event registry, so it can't drift from what the endpoint accepts) — instead of a single flattened filter list with a prose caveat. `GET /v1/streams` now lists `event_types` and a structured `filters` spec (name + type) for its events route. A test pins the Index registry to the shared decoded event-type list so discovery can't lie.
