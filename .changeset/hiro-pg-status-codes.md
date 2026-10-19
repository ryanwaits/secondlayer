---
"@secondlayer/shared": patch
---

`HiroPgClient` labels Hiro status -1 as `abort_by_response` (it was `abort_by_post_condition`) and throws on codes that are not a mined result instead of guessing.
