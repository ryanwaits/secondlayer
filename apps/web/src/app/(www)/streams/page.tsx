import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { DatasetSandbox } from "@/components/dataset-sandbox";
import { StreamsDiagram } from "@/components/diagrams/streams-diagram";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Streams | secondlayer",
	description:
		"The raw event firehose for Stacks — an immutable, replayable, cursor-paginated log. No node required.",
};

const toc: TocItem[] = [
	{ label: "How it works", href: "#how-it-works" },
	{ label: "Auth", href: "#auth" },
	{ label: "Reading the log", href: "#reading-the-log" },
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
						Streams is the raw event firehose for Stacks. One service captures
						every event a Stacks node emits — STX, FT and NFT transfers,
						contract prints, locks — and saves them as an immutable, ordered
						log. You read that log over a cursor-paginated REST API.
					</p>
					<p>
						Because the data is append-only and never changes, it's heavily
						cacheable and trivially replayable: sync, stop, and pick up exactly
						where you left off. The point is what you <em>don't</em> do — you
						never run a Stacks node. We shoulder data availability so you can
						build higher-level APIs and indexers on top. It's the same firehose
						every Foundation Dataset decoder reads internally. For push
						delivery, see <a href="/subscriptions">Subscriptions</a>.
					</p>
				</div>

				<SectionHeading id="how-it-works">How it works</SectionHeading>

				<StreamsDiagram />

				<div className="prose">
					<p>
						An indexer faces the Stacks node and writes raw, canonical events;
						the Streams API serves them to your consumer over a cursor. Stop and
						resume anytime — the cursor is just <code>height:event_index</code>.
					</p>
				</div>

				<SectionHeading id="auth">Auth</SectionHeading>

				<div className="prose">
					<p>
						Streams is read-only but keyed — every request needs an API key,
						including during open beta. Issue one at{" "}
						<a href="/platform/api-keys">/platform/api-keys</a> (product:
						Streams).
					</p>
				</div>

				<CodeBlock
					code={`curl -H "Authorization: Bearer sk-sl_..." \\
  https://api.secondlayer.tools/v1/streams/tip`}
					lang="bash"
				/>

				<SectionHeading id="reading-the-log">Reading the log</SectionHeading>

				<div className="prose">
					<p>
						Every event carries a cursor — <code>height:event_index</code>. Page
						forward from a cursor and the stream is fully{" "}
						<strong>idempotent</strong>: persist the last cursor you saw and a
						restarted job resumes from exactly that point, no duplicates.
						Because the log is append-only it's also reorg-aware — when a fork
						resolves, <code>/v1/streams/reorgs</code> tells you which cursors to
						roll back, so your derived state stays consistent.
					</p>
					<p>The SDK wraps this into a consume loop with checkpointing:</p>
				</div>

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

				<Callout label="Full reference">
					<p>
						Every endpoint, the rate and retention tiers, and the full SDK
						surface live in the docs → <a href="/docs/streams">/docs/streams</a>
						.
					</p>
				</Callout>

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
