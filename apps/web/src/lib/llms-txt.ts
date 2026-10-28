import { docsNavPages } from "@/app/(www)/docs/nav";
import { dataPath, liveDataTopics } from "./data-topics";
import { SITE, markdownPath } from "./docs-agent";

const INTRO = `# Secondlayer: instant data for apps on Bitcoin

> Index Stacks and Runes from their first block, stream new ones as they
> land, and prove Stacks data back to Bitcoin. Bitcoin Runes hosted and self-host. Hosted on api.secondlayer.tools (Index, Streams, Subgraphs, Webhooks),
> or self-hosted: Postgres plus one container beside your node.

## Shortest path
- Agent skill: bunx skills add ryanwaits/secondlayer --skill secondlayer -y
- MCP: bunx @secondlayer/mcp (set SECONDLAYER_API_KEY)
- Every endpoint as a markdown URL (~14 KB): ${SITE}/llms-api.txt
- All guides in one file (~197 KB): ${SITE}/llms-full.txt

## Start here
- Hosted: get an account key (sk-sl_*) at ${SITE}/signin. The
  SDK, MCP and CLI send SECONDLAYER_API_KEY automatically on api.secondlayer.tools.
- Self-host: bun add -g @secondlayer/cli && secondlayer init --network mainnet
- Local API: http://127.0.0.1:3800  (SDK/CLI default)
- Hosted OpenAPI: https://api.secondlayer.tools/v1/openapi.json
- OpenAPI on your instance: http://127.0.0.1:3800/v1/openapi.json
- Docs: ${SITE}/docs

## Products
- Archive: ${SITE}/p/archive. Signed history. Check your copy free.
- Streams: ${SITE}/p/streams. Every event. You hold the cursor.
- Index: ${SITE}/p/index. Typed rows from genesis.
- Subgraphs: ${SITE}/p/subgraphs. Your contract, as a table.
- Webhooks: ${SITE}/p/webhooks. Your server, told first.
- Verify: ${SITE}/verify. Check a block or transaction yourself.
- Pricing: ${SITE}/pricing. 1M rows free per month.

## Auth model
- Hosted (api.secondlayer.tools): SECONDLAYER_API_KEY (sk-sl_*). The
  secondlayer subgraphs and secondlayer webhooks commands accept the account key there.
- Self-host: INSTANCE_TOKEN from secondlayer init. Loopback reads need no key.

## Billing (hosted)
- 1M rows free per month, then $5 per 1M ($2 per 1M past $50). Block headers
  are free.
- A hosted stack (runs your subgraphs and webhooks, so webhook-only accounts
  have one too) bills memory plus storage. Webhooks only: $5/mo minimum while
  your stack runs. With subgraphs: $10/mo minimum. Webhook events are $10 per
  1M.
- With no active webhooks and no subgraphs the stack stops itself within
  minutes (never in its first 15 minutes) and bills nothing; the next request
  starts it again.
- The monthly spend cap covers every charge. At the cap, reads past the free
  rows answer 402 spend_cap_reached and the stack stops, so webhooks stop
  delivering until the next month or a raised cap.
- Reads of your own subgraph tables are free.
- Self-host is unmetered. Only archive restore and backfill off our R2 is metered.

## Hosted subgraphs
- Hostable sources: event filters and contract_call / contract_deploy. Anything
  else returns 422 SOURCE_NOT_HOSTABLE.
- After 3 stall or OOM deaths at one height a subgraph is marked error.
- Set startBlock so the first deploy does not backfill from genesis.
- Webhooks fire on chain events. React to subgraph rows from your Postgres or the subgraph API.

## Batch
- POST /v1/batch — up to 10 public /v1 reads in one round trip
  ({"requests":[{"path":"/v1/index/events","params":{...}}, ...]}); results
  return in order with per-item status.

## Docs
- ${SITE}/docs
- Any page as markdown: append .md — ${SITE}/docs/streams.md
- SDK agent notes ship in the package: node_modules/@secondlayer/sdk/AGENTS.md
- Verify: ${SITE}/docs/verification (check a block or
  transaction yourself, @secondlayer/verify)
- Env: examples read SECONDLAYER_API_URL and SECONDLAYER_API_KEY. On your own
  box set the URL to http://127.0.0.1:3800
`;

/** The agent-facing product summary plus a `.md` link for every docs page, generated from the sidebar. */
export function llmsTxt(): string {
	const pages = docsNavPages().map(
		(page) =>
			`- [${page.title}](${SITE}${markdownPath(page.href)}) (${page.group})`,
	);
	const protocols = liveDataTopics().map(
		(topic) =>
			`- [${topic.eyebrow}](${SITE}${dataPath(topic)}): ${topic.description}`,
	);
	return `${INTRO}\n## Protocol data\n${protocols.join("\n")}\n\n## Pages\n${pages.join("\n")}\n`;
}
