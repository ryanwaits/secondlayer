---
"@secondlayer/shared": patch
---

decoded_events drops two indexes no query uses and two dead columns; its contract/sender/recipient indexes skip rows where that column is empty.
