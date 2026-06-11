const LLMS_TXT = `# Secondlayer — the indexing layer for Stacks

> Raw chain events (Streams), decoded events (Index), your own indexed views
> (Subgraphs), webhooks (Subscriptions), and curated parquet (Datasets).
> One REST surface at https://api.secondlayer.tools. Public reads need no key.

## Start here
- OpenAPI: https://api.secondlayer.tools/v1/openapi.json
- Public subgraph directory (no key): https://api.secondlayer.tools/v1/subgraphs
- Per-subgraph agent docs: https://api.secondlayer.tools/v1/subgraphs/{name}/docs.md
- MCP server (40+ tools): npx -y @secondlayer/mcp  (reads need zero setup)
- Mint a free API key, no signup: POST https://api.secondlayer.tools/v1/keys

## Pay per call (x402, for agents without accounts)
- Capability advertisement: https://api.secondlayer.tools/v1/x402/supported
- Paid surfaces: /v1/index/* and /v1/streams/* (x402 v2, network stacks:1,
  sponsored transfers — you hold sBTC/STX/USDCx, never gas; $0.001/call floor)
- SDK: withX402(fetch, { account }) from @secondlayer/sdk auto-pays 402s.

## Auth model
- Anonymous: rate-limited public reads (Index, Datasets, public Subgraphs).
- sk-sl_ API key: raises limits, unlocks Streams reads; writes need a claimed
  account. Ghost keys (POST /v1/keys) are read-only until claimed by email.

## Docs
- https://secondlayer.tools/docs (append ?mode=agent for the agent view)
`;

export function GET() {
	return new Response(LLMS_TXT, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
