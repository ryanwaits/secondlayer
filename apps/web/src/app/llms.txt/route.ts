const LLMS_TXT = `# Secondlayer — the indexing layer for Stacks

> Raw chain events (Streams), decoded events (Index), your own indexed views
> (Subgraphs), and webhooks (Subscriptions).
> One REST surface at https://api.secondlayer.tools. Public reads need no key.

## Start here
- OpenAPI: https://api.secondlayer.tools/v1/openapi.json
- Public subgraph directory (no key): https://api.secondlayer.tools/v1/subgraphs
- Per-subgraph agent docs: https://api.secondlayer.tools/v1/subgraphs/{name}/docs.md
- MCP server (40+ tools): npx -y @secondlayer/mcp  (reads need zero setup)
- Mint a free API key, no signup: POST https://api.secondlayer.tools/v1/keys

## Pay per call (x402, for agents without accounts)
- Capability advertisement: https://api.secondlayer.tools/v1/x402/supported
- Paid reads: /v1/index/* and /v1/streams/* (x402 v2, network stacks:1,
  sponsored transfers — you hold sBTC/STX/USDCx, never gas; $0.001/call floor).
  Index: first 1,000 reads/day/IP free before any 402. Streams: one payment
  opens a session (PAYMENT-SESSION voucher, up to 500 calls / 1h).
- Paid writes: POST /v1/subgraphs ($2) deploys a subgraph owned by the paying
  wallet (live indexing from deploy, 7-day TTL); POST /v1/subgraphs/{name}/renew
  ($0.50) extends it a week. Claiming the account clears the expiry.
- Prepaid credit: POST /v1/x402/deposit?usd=N (min $0.25, max $100/deposit)
  loads a tab with one on-chain payment and returns a PAYMENT-BALANCE token;
  calls carrying it debit the tab (X-BALANCE-REMAINING-USD on responses).
  GET /v1/x402/balance reads the tab.
- SDK: withX402(fetch, { account, balanceToken?, topUp? }) auto-pays 402s,
  replays session vouchers, spends the prepaid tab, and can top itself up
  autonomously (topUp: { usd, whenBelow }).

## Auth model
- Anonymous: rate-limited public reads (Index, public Subgraphs).
- sk-sl_ API key: raises limits, unlocks Streams reads; writes need a claimed
  account. Ghost keys (POST /v1/keys) are read-only until claimed by email.
- Wallet continuity: a claimed account can link its paying wallet
  (POST /api/wallet/link, signed message) — x402 spend history attaches and
  any wallet-owned subgraphs become permanent.

## Docs
- https://secondlayer.tools/docs (append ?mode=agent for the agent view)
`;

export function GET() {
	return new Response(LLMS_TXT, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
