const LLMS_TXT = `# Secondlayer — self-hosted Stacks data

> Postgres plus one container beside your node. Three surfaces on that
> instance: raw signed firehose (Streams), decoded rows (Index), your schema
> (Subgraphs). The signed archive is public to check. Large restore and
> backfill off our R2 is metered.

## Start here
- Install: bun add -g @secondlayer/cli && secondlayer init --network mainnet
- Local API: http://127.0.0.1:3800  (SDK/CLI default)
- OpenAPI on your instance: http://127.0.0.1:3800/v1/openapi.json
- Docs: https://secondlayer.tools/docs
- Archive credits: secondlayer credits buy --email you@example.com --pack 25

## Auth model
- Loopback reads: no key.
- Writes and bind-beyond-loopback: INSTANCE_TOKEN from secondlayer init (or SL_API_KEY).
- Archive restore/backfill: card credits on https://api.secondlayer.tools
  (secondlayer credits buy / balance). Auto-refill is off until you set it.

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
- Deeper agent skill: bunx skills add ryanwaits/secondlayer
`;

export function GET() {
	return new Response(LLMS_TXT, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
