import { CodeBlock } from "@/components/code-block";
import { CodeTabs } from "@/components/product/code-tabs";
import { getHighlights } from "@/lib/changelog";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "Index | secondlayer",
	description:
		"Decoded Stacks events and contract calls — normalized, filterable, cursor-paginated. Build an indexer for any contract without running a node.",
	image: "/og/index.png",
	path: "/indexes",
});

const INDEXER_CODE = `import { Index } from "@secondlayer/sdk";
import { db } from "./index-db";

const index = new Index();
const MARKETPLACE = "SPNWZ…E0VQ0S.marketplace-v4";

// Tail every decoded call to a contract —
// no node to run, no Clarity to parse.
for await (const call of index.contractCalls.walk({
  contractId: MARKETPLACE,
  functionName: "purchase-asset",
})) {
  const [collection, tokenId] = call.args;

  await db
    .insertInto("sales")
    .values({
      tx_id: call.tx_id,
      buyer: call.sender,
      collection: String(collection),
      token_id: String(tokenId),
      block_height: call.block_height,
    })
    .execute();
}`;

const CHECKPOINT_CODE = `// The production loop: checkpointed, reorg-safe.
// Kill it anywhere — it resumes from your cursor.
await index.contractCalls.consume({
  contractId: MARKETPLACE,
  functionName: "purchase-asset",
  fromCursor: await loadCheckpoint(),
  fromHeight: 0, // first run: backfill from genesis (paid/credits; free reads = last 24h)

  onBatch: async (calls, envelope, ctx) => {
    await db.transaction().execute(async (tx) => {
      for (const call of calls) await insertSale(tx, call);
      await saveCheckpoint(tx, ctx.cursor); // commits with the rows
    });
    return ctx.cursor;
  },

  onReorg: async (reorg) => {
    // delete from the fork block up (inclusive); the consumer then rewinds
    // and re-reads the canonical run for you
    await db.deleteFrom("sales")
      .where("block_height", ">=", reorg.fork_point_height)
      .execute();
  },
});`;

const DB_CODE = `import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

// The rows your indexer writes — one per decoded purchase-asset call —
// plus the checkpoint that makes the loop resumable.
export interface Database {
  sales: {
    tx_id: string;
    buyer: string;
    collection: string;
    token_id: string;
    block_height: number;
  };
  checkpoints: { id: string; cursor: string };
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool() }),
});`;

const SDK_CARD_CODE = `const index = new Index();

for await (const t of
  index.ftTransfers.walk({ contractId })) {
  // t is fully typed
  console.log(t.sender, t.amount);
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
					We decode the chain.
					<br />
					You build the index.
				</h1>
				<p className="pp-sub">
					Every Stacks event, decoded into typed rows. Read them keyless, or
					sweep them into your own app index — cursors, reorgs, and backfill on
					every page.
				</p>
				<div className="pp-ctas">
					<Link href="/docs/index" className="pp-btn pp-btn-ink">
						Start indexing
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
									label: "checkpoint.ts",
									content: (
										<CodeBlock code={CHECKPOINT_CODE} lang="typescript" />
									),
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
						One decoded row set.
						<br />
						<span className="dim">Three ways in: SDK, CLI, Agent.</span>
					</h2>
					<p>
						Filter, paginate, and cursor-walk the same decoded rows from the
						typed SDK, your terminal, or an agent.
					</p>
					<Link href="/docs/index" className="pp-docs-link">
						Read the Index docs <span className="ar">→</span>
					</Link>
				</div>
				<div className="pp-surfaces three">
					{/* SDK — a typed code snippet */}
					<div className="pp-surface">
						<h4>SDK</h4>
						<p>Typed list and cursor-walking in TypeScript, fully inferred.</p>
						<div className="pp-codeview">
							<CodeBlock code={SDK_CARD_CODE} lang="typescript" />
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

					{/* Agent — MCP session in a terminal window */}
					<div className="pp-surface">
						<h4>Agent</h4>
						<p>
							The whole surface speaks MCP — an agent queries with zero setup.
						</p>
						<div className="pp-vis pp-vis-term">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">agent</div>
							</div>
							<div className="pp-agentterm">
								<div className="pp-at-banner">
									<span className="pp-at-logo">◆</span>
									<span className="pp-at-meta">
										<b>secondlayer</b> · mcp
										<br />
										12 tools · keyless reads
									</span>
								</div>
								<div className="pp-at-prompt">
									<span className="pp-at-caret">›</span> Index every sBTC
									transfer to my contract
								</div>
								<div className="pp-at-tool">⬡ index_events · ft_transfer</div>
								<div className="pp-at-done">
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
						Build your index.
						<br />
						We run the rest.
					</h2>
					<p>
						No node, no key, no infra to run. Just decoded rows — cursors,
						reorgs, and backfill — over the same{" "}
						<Link href="/streams">Streams</Link> firehose our decoder runs on.
						See it live in the <Link href="/sbtc">sBTC Peg Explorer</Link> — a
						full page built on nothing but the keyless API.
					</p>
					<div className="pp-ctas">
						<Link href="/docs/index" className="pp-btn pp-btn-ink">
							Get started
						</Link>
						<Link href="/sbtc" className="pp-btn pp-btn-ghost">
							See the sBTC peg feed →
						</Link>
					</div>
				</div>
			</section>
		</main>
	);
}
