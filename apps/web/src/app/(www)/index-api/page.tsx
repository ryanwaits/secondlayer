import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { DatasetSandbox } from "@/components/dataset-sandbox";
import { IndexDiagram } from "@/components/diagrams/index-diagram";
import { InlineKey, KeyTrigger } from "@/components/inline-key";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Index | secondlayer",
	description:
		"Decoded FT & NFT transfers for Stacks — normalized, filterable, cursor-paginated. No decoders to write.",
};

const toc: TocItem[] = [
	{ label: "How it works", href: "#how-it-works" },
	{ label: "Querying", href: "#querying" },
	{ label: "Try it", href: "#try-it" },
];

export default function IndexPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Index" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Index</h1>
				</header>

				<div className="prose">
					<p>
						Index is the decoded read layer for Stacks. An L2 decoder consumes
						the raw <a href="/streams">Streams</a> firehose and normalizes it
						into typed FT and NFT transfer tables — query them directly by
						contract, wallet, or block range, with no decoders to write or
						maintain.
					</p>
					<InlineKey product="index">
						Reads are open during beta — anonymous works, and an{" "}
						<KeyTrigger>API key</KeyTrigger> just raises your rate limit.
					</InlineKey>
					<p>
						For your own app-specific shape, see{" "}
						<a href="/subgraphs">Subgraphs</a>; for raw events, see{" "}
						<a href="/streams">Streams</a>.
					</p>
				</div>

				<SectionHeading id="how-it-works">How it works</SectionHeading>

				<IndexDiagram />

				<div className="prose">
					<p>
						The decoder reads Streams and writes normalized{" "}
						<code>ft_transfer</code> and <code>nft_transfer</code> rows; the
						Index API serves them, filtered and cursor-paginated. Decoding
						happens once, on shared infra — you just query.
					</p>
				</div>

				<SectionHeading id="querying">Querying</SectionHeading>

				<div className="prose">
					<p>
						Two endpoints — <code>/v1/index/ft-transfers</code> and{" "}
						<code>/v1/index/nft-transfers</code> — both filter by{" "}
						<code>contract_id</code>, <code>sender</code>,{" "}
						<code>recipient</code>, and block range, and page forward on a{" "}
						<code>cursor</code>. The SDK wraps list + cursor-walking:
					</p>
				</div>

				<CodeBlock
					code={`import { Index } from "@secondlayer/sdk";

const index = new Index({ apiKey: process.env.SL_INDEX_API_KEY });

// One page of decoded FT transfers, filtered
const { events, next_cursor } = await index.ftTransfers.list({
  contractId: "SP2C2YFP12AJZB4MR27X4XXNXKWQK90ZQGW8A0X.token-usda",
  sender: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
  limit: 50,
});

// Or stream every match across pages
for await (const t of index.ftTransfers.walk({ contractId })) {
  await handle(t);
}`}
				/>

				<Callout label="Full reference">
					<p>
						Every field, the rate tiers, and the NFT endpoint live in the docs →{" "}
						<a href="/docs/index">/docs/index</a>.
					</p>
				</Callout>

				<SectionHeading id="try-it">Try it</SectionHeading>

				<DatasetSandbox
					endpoint="/v1/index/ft-transfers"
					title="Try /v1/index/ft-transfers"
					filters={[
						{
							name: "contract_id",
							type: "string",
							placeholder: "SP2...token-usda",
						},
						{ name: "sender", type: "string", placeholder: "SP3..." },
						{ name: "recipient", type: "string", placeholder: "SP1..." },
						{ name: "from_height", type: "number" },
						{ name: "limit", type: "number", default: "5", placeholder: "5" },
					]}
				/>
			</main>
		</div>
	);
}
