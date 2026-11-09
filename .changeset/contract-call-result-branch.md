---
"@secondlayer/sdk": major
---

Contract-call `result` keeps the response branch: `(ok u6009)` decodes to `{ ok: "6009" }` and `(err u6009)` to `{ err: "6009" }` (both used to be `"6009"`). Applies to `IndexContractCall.result` and `IndexTransaction.contract_call.result`; non-response results are unchanged. Breaking: code that read the bare unwrapped value must read `.ok` / `.err`.
