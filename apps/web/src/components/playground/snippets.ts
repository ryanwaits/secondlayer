import { highlight } from "@/lib/highlight";
import type { AgentProduct } from "./agent-chat";

/** A copy-paste snippet, pre-highlighted with the shared Shiki highlighter so
 *  the agent's code matches every other snippet on the site. */
export interface HlSnippet {
	label: string;
	code: string;
	html: string;
}

const SNIPPETS: Record<
	AgentProduct,
	{ label: string; lang: string; code: string }[]
> = {
	index: [
		{
			label: "curl",
			lang: "bash",
			code: "curl 'api.secondlayer.tools/v1/index/events?event_type=ft_transfer&contract_id=…sbtc-token&limit=5'",
		},
		{
			label: "SDK",
			lang: "typescript",
			code: `import { Index } from "@secondlayer/sdk";
const index = new Index();
for await (const t of index.ftTransfers.walk({ contractId }))
  console.log(t.sender, t.amount);`,
		},
		{
			label: "CLI",
			lang: "bash",
			code: "sl index events --event-type ft_transfer --contract …sbtc-token --json | jq",
		},
	],
	streams: [
		{
			label: "curl",
			lang: "bash",
			code: "curl -N 'api.secondlayer.tools/v1/streams/events/stream'",
		},
		{
			label: "SDK",
			lang: "typescript",
			code: `for await (const batch of sl.streams.consume({ cursor }))
  await handle(batch.events); // ordered, reorg-aware`,
		},
		{ label: "CLI", lang: "bash", code: "sl streams tail --json" },
	],
	subgraphs: [],
};

/** Server-side: highlight a product's snippets. The resulting HTML is
 *  serializable, so it's passed straight into the client <AgentChat>. */
export async function getAgentSnippets(
	product: AgentProduct,
): Promise<HlSnippet[]> {
	return Promise.all(
		SNIPPETS[product].map(async (s) => ({
			label: s.label,
			code: s.code,
			html: await highlight(s.code, s.lang),
		})),
	);
}
