---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
"@secondlayer/api": patch
---

Add a prod-safe single-contract ABI source. New `GET /v1/contracts/:contractId` (registry lookup by id, `?include=abi` for the blob, 404 when absent), SDK `contracts.get(contractId, { includeAbi })`, and a `get_contract_abi` MCP tool. The MCP `scaffold_from_contract` tool now sources ABIs from this registry instead of the OSS/dedicated-only `/api/node/...` proxy (which 404s in prod), so it works in platform/prod.
