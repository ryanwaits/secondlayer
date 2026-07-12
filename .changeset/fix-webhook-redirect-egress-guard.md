---
"@secondlayer/subgraphs": patch
---

fix(subgraphs): re-validate webhook redirect targets against the egress guard — deliveries now use `redirect: "manual"` and re-run the SSRF guard on every hop (bounded to 3), so a webhook target can no longer redirect to a private/metadata address to have its response captured and read back via the delivery log.
