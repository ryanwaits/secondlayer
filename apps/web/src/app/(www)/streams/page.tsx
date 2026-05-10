import { CodeBlock } from "@/components/code-block";
import { DatasetSandbox } from "@/components/dataset-sandbox";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Streams | secondlayer",
	description:
		"Raw chain event firehose. Cursor-paginated REST, idempotent, replayable.",
};

const toc: TocItem[] = [
	{ label: "Auth", href: "#auth" },
	{ label: "Tiers", href: "#tiers" },
	{ label: "Endpoints", href: "#endpoints" },
	{ label: "TypeScript", href: "#typescript" },
	{ label: "Try it", href: "#try-it" },
];

export default function StreamsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Streams" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Streams</h1>
				</header>

				<div className="prose">
					<p>
						Raw chain event firehose — cursor-paginated REST, idempotent,
						replayable. The same surface every Foundation Dataset decoder
						consumes internally. For push semantics see{" "}
						<a href="/subscriptions">Subscriptions</a>.
					</p>
				</div>

				<SectionHeading id="auth">Auth</SectionHeading>

				<CodeBlock
					code={`# Issue a key at /platform/api-keys (product: Streams), then:
curl -H "Authorization: Bearer sk-sl_streams_..." \\
  https://api.secondlayer.tools/v1/streams/tip`}
					lang="bash"
				/>

				<SectionHeading id="tiers">Tiers</SectionHeading>

				<CodeBlock
					code={`tier        rate/sec   retention
free        10         7  days  (~121K blocks)
build       50         30 days  (~518K blocks)
scale       250        90 days  (~1.6M blocks)
enterprise  unlimited  unlimited`}
					lang="text"
				/>

				<SectionHeading id="endpoints">Endpoints</SectionHeading>

				<CodeBlock
					code={`GET /v1/streams/events
  ?cursor=<height>:<event_index>
  &from_height=<n>  &to_height=<n>
  &types=stx_transfer,ft_transfer,nft_transfer,print,...
  &contract_id=<SP...>
  &limit=<1-1000>

GET /v1/streams/events/:tx_id          # every event from a tx
GET /v1/streams/blocks/:height/events  # every event in a block
GET /v1/streams/reorgs?since=<cursor>  # reorg history
GET /v1/streams/canonical/:height      # canonical block at height
GET /v1/streams/tip                    # current canonical tip`}
					lang="text"
				/>

				<SectionHeading id="typescript">TypeScript</SectionHeading>

				<CodeBlock
					code={`import { createStreamsClient } from "@secondlayer/sdk";

const streams = createStreamsClient({ apiKey: process.env.SL_STREAMS_API_KEY! });

await streams.events.consume({
  fromCursor: lastCheckpoint,
  types: ["print"],
  contractId: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
  batchSize: 500,
  onBatch: async (events, envelope) => {
    for (const e of events) await handle(e);
    await saveCheckpoint(envelope.next_cursor);
    return envelope.next_cursor;
  },
});`}
				/>

				<SectionHeading id="try-it">Try it</SectionHeading>

				<DatasetSandbox
					endpoint="/v1/streams/events"
					title="Try /v1/streams/events"
					requiresApiKey
					filters={[
						{
							name: "types",
							type: "enum",
							options: [
								"stx_transfer",
								"ft_transfer",
								"nft_transfer",
								"print",
								"stx_mint",
								"stx_burn",
								"ft_mint",
								"ft_burn",
								"nft_mint",
								"nft_burn",
								"stx_lock",
							],
						},
						{
							name: "contract_id",
							type: "string",
							placeholder: "SP2...BNS-V2",
						},
						{ name: "from_height", type: "number" },
						{ name: "limit", type: "number", default: "5", placeholder: "5" },
					]}
				/>
			</main>
		</div>
	);
}
