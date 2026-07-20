---
"@secondlayer/shared": patch
---

Route the reorg cursor timestamp through `::text` before the `timestamptz` cast. A bare `::timestamptz` made the driver infer the param as a timestamp and convert it client-side at millisecond precision, silently discarding the microseconds the cursor exists to preserve.
