const LLMS_TXT = `# Secondlayer: instant data for apps on Bitcoin

> Every Stacks block and Bitcoin rune, decoded from genesis and delivered at
> tip. Hosted on api.secondlayer.tools (Index, Streams, Subgraphs, Webhooks),
> or self-hosted: Postgres plus one container beside your node.

## Start here
- Hosted: get an account key (sk-sl_*) at https://secondlayer.tools/login. The
  SDK, MCP and CLI send SECONDLAYER_API_KEY automatically on api.secondlayer.tools.
- Self-host: bun add -g @secondlayer/cli && secondlayer init --network mainnet
- Local API: http://127.0.0.1:3800  (SDK/CLI default)
- OpenAPI on your instance: http://127.0.0.1:3800/v1/openapi.json
- Docs: https://secondlayer.tools/docs

## Auth model
- Hosted (api.secondlayer.tools): SECONDLAYER_API_KEY (sk-sl_*). The
  secondlayer subgraphs and secondlayer webhooks commands accept the account key there.
- Self-host: INSTANCE_TOKEN from secondlayer init. Loopback reads need no key.

## Billing (hosted)
- 1M rows free per month, then $5 per 1M ($2 per 1M past $50). Block headers
  are free.
- A hosted stack (runs your subgraphs and webhooks) has a 0.5 GB memory minimum
  (about $10/mo while running) plus storage. Webhook events are $10 per 1M.
- Reads of your own subgraph tables are free.
- Self-host is unmetered. Only archive restore and backfill off our R2 is metered.

## Hosted subgraphs
- Hostable sources: event filters and contract_call / contract_deploy. Anything
  else returns 422 SOURCE_NOT_HOSTABLE.
- After 3 stall or OOM deaths at one height a subgraph is marked error.
- Set startBlock so the first deploy does not backfill from genesis.
- Subgraph webhooks are self-host only. Hosted webhooks fire on chain events.

## Batch
- POST /v1/batch — up to 10 public /v1 reads in one round trip
  ({"requests":[{"path":"/v1/index/events","params":{...}}, ...]}); results
  return in order with per-item status.

## Docs
- https://secondlayer.tools/docs (append ?mode=agent for the agent view —
  note it resolves client-side, so if you do not execute JS use the .md
  routes below, which are the real answer for non-JS readers)
- Full text, one file: https://secondlayer.tools/llms-full.txt
- Any page as markdown: append .md — https://secondlayer.tools/docs/streams.md
- SDK agent notes ship in the package: node_modules/@secondlayer/sdk/AGENTS.md
- Verify: https://secondlayer.tools/docs/verification (check a block or
  transaction yourself, @secondlayer/verify)
- Env: examples read SECONDLAYER_API_URL and SECONDLAYER_API_KEY. On your own
  box set the URL to http://127.0.0.1:3800
- Deeper agent skill: bunx skills add ryanwaits/secondlayer --skill secondlayer -y
`;

export function GET() {
	return new Response(LLMS_TXT, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
