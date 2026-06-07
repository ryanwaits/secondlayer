---
"@secondlayer/stacks": minor
"@secondlayer/mcp": minor
"@secondlayer/cli": patch
---

Single-source the SIP trait vocabulary. Export `TRAIT_STANDARDS` from `@secondlayer/stacks/clarity` and derive `SipStandard` from it; the CLI `ScaffoldTrait` type and `--trait` validation now reference it instead of re-hardcoding `sip-009|sip-010|sip-013`. Add a `secondlayer://traits` MCP resource listing the standards so agents can discover the valid `contracts_find` / scaffold trait values. (The `scaffold_from_trait` tool + scaffold-generator consolidation are a separate follow-up.)
