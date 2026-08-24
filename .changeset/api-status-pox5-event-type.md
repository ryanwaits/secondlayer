---
"@secondlayer/api": patch
---

Label the default-on pox5 decoder as `pox5_event` on `/public/status`.

Without the map entry, `eventType` fell back to the checkpoint name
(`decode.pox5.v1`) while pox4 showed `pox4_call`.
