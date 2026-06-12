import { CodeBlock } from "@/components/code-block";
import { CodeTabs } from "@/components/product/code-tabs";
import { getHighlights } from "@/lib/changelog";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Index | secondlayer",
	description:
		"Decoded Stacks events and contract calls — normalized, filterable, cursor-paginated. Build an indexer for any contract without running a node.",
};

const INDEXER_CODE = `import { Index } from "@secondlayer/sdk";
import { db } from "./index-db";

const index = new Index();
const CONTRACT = "SP2H8…marketplace-v2";

// Tail every decoded call to your contract —
// no node to run, no Clarity to parse.
for await (const call of index.contractCalls.walk({
  contractId: CONTRACT,
  functionName: "buy-asset",
})) {
  const [assetId, price] = call.args;

  await db
    .insertInto("sales")
    .values({
      tx_id: call.tx_id,
      buyer: call.sender,
      asset_id: String(assetId),
      price: String(price),
      block_height: call.block_height,
    })
    .execute();
}`;

const DB_CODE = `import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

// The rows your indexer writes — one per decoded buy-asset call.
export interface Database {
  sales: {
    tx_id: string;
    buyer: string;
    asset_id: string;
    price: string;
    block_height: number;
  };
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool() }),
});`;

const SDK_CARD_CODE = `const index = new Index();

for await (const e of
  index.ftTransfers.walk({ contractId })) {
  tally(e.sender, e.amount);
}`;

export default function IndexPage() {
	const highlights = getHighlights("index");
	return (
		<main className="pp">
			<header className="pp-hero">
				<Link href="/docs/index" className="pp-pill">
					<span className="dot" /> Open beta — reads need no key{" "}
					<span className="arr">→</span>
				</Link>
				<h1>
					Decoded chain data.
					<br />
					No decoders to write.
				</h1>
				<p className="pp-sub">
					Index is the decoded read layer for Stacks. Every transfer, contract
					call, and print event, normalized into typed rows you can filter and
					page. We run the decoder, you query.
				</p>
				<div className="pp-ctas">
					<Link href="/docs/index" className="pp-btn pp-btn-ink">
						Start querying
					</Link>
					<Link href="/docs/index" className="pp-btn pp-btn-ghost">
						Read the docs →
					</Link>
				</div>
			</header>

			{/* PRODUCT WINDOW DEMO: interactive IDE tabs */}
			<section className="pp-wrap">
				<div className="pp-stage">
					<div className="pp-stage-inner">
						<CodeTabs
							tabs={[
								{
									label: "track-sales.ts",
									content: <CodeBlock code={INDEXER_CODE} lang="typescript" />,
								},
								{
									label: "index-db.ts",
									content: <CodeBlock code={DB_CODE} lang="typescript" />,
								},
							]}
						/>
					</div>
				</div>
			</section>

			{/* SURFACES — distinct treatment per surface */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						Read it your way.
						<br />
						<span className="dim">SDK, REST, CLI, or agent.</span>
					</h2>
					<p>
						One decoded layer, four ways in. Filter, paginate, and walk the same
						rows over the typed SDK, plain REST, your shell, or an MCP harness.
					</p>
					<Link href="/docs/index" className="pp-docs-link">
						Read the Index docs <span className="ar">→</span>
					</Link>
				</div>
				<div className="pp-surfaces">
					{/* SDK — a typed code snippet */}
					<div className="pp-surface">
						<h4>SDK</h4>
						<p>Typed list and cursor-walking in TypeScript, fully inferred.</p>
						<div className="pp-codeview">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<CodeBlock code={SDK_CARD_CODE} lang="typescript" />
						</div>
					</div>

					{/* REST — request → response */}
					<div className="pp-surface">
						<h4>REST</h4>
						<p>
							Anonymous reads, wildcard CORS, opaque cursors. No SDK needed.
						</p>
						<div className="pp-vis">
							<div className="pp-req">
								<div>
									<span className="verb">GET</span> /v1/index/events
								</div>
								<div>&nbsp;&nbsp;?event_type=ft_transfer</div>
								<div>&nbsp;&nbsp;&amp;sender=SP3F…</div>
								<div className="res">
									<span className="status">200</span> &#123;{" "}
									<span className="key">events</span>: [ … ],
								</div>
								<div
									className="res"
									style={{ marginTop: 0, borderTop: "none" }}
								>
									&nbsp;&nbsp;<span className="key">next_cursor</span>:
									"8249712:14" &#125;
								</div>
							</div>
						</div>
					</div>

					{/* CLI — terminal */}
					<div className="pp-surface">
						<h4>CLI</h4>
						<p>Pipeable and scriptable, with JSON whenever you ask for it.</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div>
									<span className="pfx">$</span> sl index events \
								</div>
								<div>&nbsp;&nbsp;--event-type stx_transfer --json</div>
								<div className="mut">&nbsp;&nbsp;| jq '.events | length'</div>
								<div>
									<span className="ok">✓</span> 2,481
								</div>
							</div>
						</div>
					</div>

					{/* Agent — MCP prompt + tool call */}
					<div className="pp-surface">
						<h4>Agent</h4>
						<p>
							The whole surface speaks MCP — an agent queries with zero setup.
						</p>
						<div className="pp-vis">
							<div className="pp-agent">
								<div className="pp-bubble">
									Index every sBTC transfer to my contract
								</div>
								<div className="pp-toolchip">⬡ index_events · ft_transfer</div>
								<div className="done">
									<b>✓</b> 2,481 rows streamed
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* RECENT HIGHLIGHTS — derived from /docs/changelog */}
			<section className="pp-band">
				<div className="pp-wrap pp-highlights">
					<span className="pp-hl-label">Recent highlights</span>
					<div className="pp-posts">
						{highlights.map((h) => (
							<Link key={h.slug} href={h.href} className="pp-post">
								<h4>{h.title}</h4>
								<p>{h.summary}</p>
								<span className="meta">
									{h.productLabel} · {h.date}
								</span>
							</Link>
						))}
						<Link href="/docs/changelog" className="pp-more">
							View the changelog →
						</Link>
					</div>
				</div>
			</section>

			<section className="pp-final">
				<div className="pp-wrap">
					<h2>
						Stop writing decoders.
						<br />
						Start reading the chain.
					</h2>
					<p>Reads are open during beta. No node, no key, no infra.</p>
					<div className="pp-ctas">
						<Link href="/docs/index" className="pp-btn pp-btn-ink">
							Get started
						</Link>
						<Link href="/docs/index" className="pp-btn pp-btn-ghost">
							/docs/index →
						</Link>
					</div>
				</div>
			</section>
		</main>
	);
}
