---
"@secondlayer/shared": patch
---

Drop `error` from the public webhook status type. A webhook is `active` or `paused`; a failing receiver is its `health`.
