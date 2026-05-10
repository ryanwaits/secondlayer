import { DatasetSandbox } from "@/components/dataset-sandbox";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Streams | secondlayer",
	description:
		"Raw chain event firehose. Cursor-paginated REST, idempotent, replayable. Pull every print, transfer, and contract event on Stacks at your own pace.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Auth", href: "#auth" },
	{ label: "Tiers", href: "#tiers" },
	{ label: "Endpoints", href: "#endpoints" },
	{ label: "Try it", href: "#try-it" },
	{ label: "TypeScript", href: "#typescript" },
	{ label: "Known limitations", href: "#known-limitations" },
];

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function StreamsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Streams" toc={toc} />
			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Streams</h1>
				</header>

				<SectionHeading id="overview">Overview</SectionHeading>

				<div className="prose">
					<p>
						Streams is the raw chain event firehose. Cursor-paginated REST,
						idempotent, replayable — the same surface every Foundation Dataset
						decoder consumes internally. Use it directly when you want to walk
						chain history at your own pace, build your own indexer, or feed an
						ETL pipeline.
					</p>
					<p>
						Push semantics — server delivers matching events to your webhook —
						live on the <a href="/docs/subscriptions">Subscriptions</a> product.
					</p>
				</div>

				<SectionHeading id="auth">Auth</SectionHeading>

				<div className="prose">
					<p>
						Issue a Streams API key from{" "}
						<a href="/platform/api-keys">/platform/api-keys</a> (product:
						Streams). Pass it as a Bearer token on every request:
					</p>
				</div>

				<InlineCodeBlock>
					{`curl -H "Authorization: Bearer sk-sl_streams_..." \\
  https://api.secondlayer.tools/v1/streams/tip`}
				</InlineCodeBlock>

				<SectionHeading id="tiers">Tiers</SectionHeading>

				<div className="prose">
					<p>
						Tier determines rate limit and retention window — older events fall
						out of the window and become parquet-only.
					</p>
				</div>

				<InlineCodeBlock>
					{`tier        rate/sec   retention
free        10         7  days  (~121K blocks)
build       50         30 days  (~518K blocks)
scale       250        90 days  (~1.6M blocks)
enterprise  unlimited  unlimited`}
				</InlineCodeBlock>

				<SectionHeading id="endpoints">Endpoints</SectionHeading>

				<div className="prose">
					<p>
						<code>GET /v1/streams/events</code> — cursor-paginated event list.
						Filters: <code>cursor</code>, <code>from_height</code>,{" "}
						<code>to_height</code>, <code>types</code> (comma-separated; one of{" "}
						<code>stx_transfer</code>, <code>ft_transfer</code>,{" "}
						<code>nft_transfer</code>, <code>print</code>, <code>stx_mint</code>
						, <code>stx_burn</code>, <code>ft_mint</code>, <code>ft_burn</code>,{" "}
						<code>nft_mint</code>, <code>nft_burn</code>, <code>stx_lock</code>
						), <code>contract_id</code>, <code>limit</code> (max 1000).
					</p>
					<p>
						<code>GET /v1/streams/events/:tx_id</code> — every event from a
						given transaction.
					</p>
					<p>
						<code>GET /v1/streams/blocks/:height_or_hash/events</code> — every
						event in a block.
					</p>
					<p>
						<code>GET /v1/streams/reorgs</code> — reorg history since cursor.
					</p>
					<p>
						<code>GET /v1/streams/canonical/:height</code> — canonical block
						metadata at height.
					</p>
					<p>
						<code>GET /v1/streams/tip</code> — current canonical tip.
					</p>
				</div>

				<SectionHeading id="try-it">Try it</SectionHeading>

				<div className="prose">
					<p>
						Paste a Streams API key into <code>apiBase</code> auth header (the
						sandbox includes it automatically once provided), then try a query.
						No key? <code>sk-sl_streams_status_public</code> works for low-rate
						read-only checks.
					</p>
				</div>

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
							helper: "(comma-separated; pick one to start)",
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

				<SectionHeading id="typescript">TypeScript</SectionHeading>

				<div className="prose">
					<p>
						The SDK ships a typed client. Use <code>events.consume</code> for
						indexers (checkpoint-aware pull) or <code>events.stream</code> for a
						live tail:
					</p>
				</div>

				<InlineCodeBlock>
					{`import { createStreamsClient } from "@secondlayer/sdk";

const streams = createStreamsClient({
  apiKey: process.env.SL_STREAMS_API_KEY!,
});

// Pull every print event from a contract, page by page.
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
				</InlineCodeBlock>

				<SectionHeading id="known-limitations">
					Known limitations
				</SectionHeading>

				<div className="prose">
					<p>
						<strong>Rate limiting is process-local.</strong> The current
						implementation uses an in-memory sliding window per API key. On a
						multi-instance API deployment a key could exceed its named tier
						limit until requests rebalance. Single-instance prod is unaffected;
						Redis-backed rate limiting ships post-launch.
					</p>
					<p>
						<strong>Print event types: two DB labels, one stream type.</strong>{" "}
						The upstream node renamed <code>smart_contract_event</code> to{" "}
						<code>contract_event</code> mid-2026. Streams transparently maps
						both into <code>type: "print"</code>; consumers should not need to
						care.
					</p>
				</div>
			</main>
		</div>
	);
}
