---
"@secondlayer/subgraphs": patch
---

Print-event key camelization is single-sourced on `camelizeDataKey`. The runner (and its test double) no longer keep a private copy of the regex, so print-lint `camel_name` and handler `event.data` cannot drift. ABI `toCamelCase` is unchanged — `transfer-STX` stays hyphenated on print payloads and becomes `transferSTX` on contract-call args.
