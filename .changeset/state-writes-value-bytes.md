---
"@secondlayer/shared": major
---

`StateWritesTable.value_hex` is now `value` (bytea). Served `value_hex` fields are unchanged. The state_writes migration needs the live rewrite tool on a large database.
