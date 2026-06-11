import { CodeBlock } from "@/components/code-block";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Index | secondlayer",
	description:
		"Decoded Stacks events and contract calls — normalized, filterable, cursor-paginated. Build an indexer for any contract without running a node.",
};

const INDEXER_CODE = `import { Index } from "@secondlayer/sdk";

const index = new Index();
const CONTRACT = "SP2H8…marketplace-v2";

// Tail every decoded call to your contract —
// no node to run, no Clarity to parse.
for await (const call of index.contractCalls.walk({
  contractId: CONTRACT,
  functionName: "buy-asset",
})) {
  const [assetId, price] = call.args;

  await db.sales.insert({
    txId: call.tx_id,
    buyer: call.sender,
    assetId,
    price,
    block: call.block_height,
  });
}`;

const HIGHLIGHTS = [
	{
		title: "Index now decodes PoX-4 stacking",
		body: (
			<>
				stack-stx, delegate-stx, and reward actions land typed at{" "}
				<code>/v1/index/stacking</code> — no node, no decoders.
			</>
		),
		meta: "Product · Jun 9, 2026",
	},
	{
		title: "Reads went keyless",
		body: "Index reads need no key during open beta. A key only raises your rate limit; public data stays public.",
		meta: "Changelog · Jun 2, 2026",
	},
	{
		title: "Trait-filtered event queries",
		body: (
			<>
				Restrict any event type or contract call to a SIP standard with{" "}
				<code>?trait=</code> — SIP-010, SIP-009, and more.
			</>
		),
		meta: "Changelog · May 24, 2026",
	},
];

export default function IndexPage() {
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

			{/* PRODUCT WINDOW DEMO: the indexer, in your editor */}
			<section className="pp-wrap">
				<div className="pp-stage">
					<div className="pp-stage-inner">
						<div className="pp-window pp-win-lg">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">track-sales.ts</div>
							</div>
							<div className="pp-body">
								<div className="pp-editor">
									<CodeBlock code={INDEXER_CODE} lang="typescript" />
								</div>
							</div>
						</div>

						<div className="pp-window pp-win-sm">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">sl — index</div>
							</div>
							<div className="pp-term">
								<div>
									<span className="pfx">$</span> sl index contract-calls \
								</div>
								<div>&nbsp;&nbsp;--contract-id SP2H8….marketplace-v2 \</div>
								<div>&nbsp;&nbsp;--function-name buy-asset --limit 3</div>
								<div>
									&#123; <span className="mut">"contract_calls"</span>: [ …3 ],
								</div>
								<div>
									&nbsp;&nbsp;<span className="mut">"next_cursor"</span>:{" "}
									<span className="pp-s">"8249712:7"</span> &#125;
								</div>
								<div className="mut">next_cursor: 8249712:7</div>
								<div>
									<span className="pfx">$</span> <span className="cur" />
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* SURFACES */}
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
					<div className="pp-surface">
						<h4>SDK</h4>
						<p>Typed list + cursor-walking in TypeScript.</p>
						<Link href="/sdk" className="pp-go">
							@secondlayer/sdk →
						</Link>
						<div className="pp-mini">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<div className="pp-mini-body">
								<div>
									<span className="pp-k">for await</span> (
									<span className="pp-k">const</span> call{" "}
									<span className="pp-k">of</span>
								</div>
								<div>&nbsp;&nbsp;index.contractCalls</div>
								<div>
									&nbsp;&nbsp;&nbsp;&nbsp;.<span className="pp-fn">walk</span>
									(&#123; contractId &#125;))
								</div>
								<div>
									&nbsp;&nbsp;<span className="pp-fn">index</span>(call.args);
								</div>
							</div>
						</div>
					</div>
					<div className="pp-surface">
						<h4>REST</h4>
						<p>Anonymous reads, wildcard CORS, opaque cursors.</p>
						<Link href="/docs/index" className="pp-go">
							curl /v1/index →
						</Link>
						<div className="pp-mini">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<div className="pp-mini-body">
								<div>
									<span className="pp-k">GET</span> /v1/index/events
								</div>
								<div>
									&nbsp;&nbsp;?event_type=
									<span className="pp-s">ft_transfer</span>
								</div>
								<div>
									&nbsp;&nbsp;&amp;sender=<span className="pp-s">SP3F…</span>
								</div>
								<div>&nbsp;&nbsp;→ &#123; events: [ … ] &#125;</div>
							</div>
						</div>
					</div>
					<div className="pp-surface">
						<h4>CLI</h4>
						<p>Pipeable, scriptable, JSON on demand.</p>
						<Link href="/cli" className="pp-go">
							sl index →
						</Link>
						<div className="pp-mini">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<div className="pp-mini-body">
								<div>
									<span className="pp-k">$</span> sl index events \
								</div>
								<div>&nbsp;&nbsp;--event-type nft_mint --json</div>
								<div>
									&nbsp;&nbsp;| jq{" "}
									<span className="pp-s">'.events[].recipient'</span>
								</div>
								<div className="pp-c">&nbsp;&nbsp;SP2J…M0RT</div>
							</div>
						</div>
					</div>
					<div className="pp-surface">
						<h4>Agent</h4>
						<p>The whole surface speaks MCP. Zero setup.</p>
						<Link href="/mcp" className="pp-go">
							Add to harness →
						</Link>
						<div className="pp-mini">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<div className="pp-mini-body">
								<div>
									<span className="pp-fn">index_events</span>(&#123; … &#125;)
								</div>
								<div className="pp-c">&nbsp;&nbsp;querying the chain…</div>
								<div>
									&nbsp;&nbsp;<span className="pp-k">✓</span> 41,208 decoded
									rows
								</div>
								<div className="pp-c">&nbsp;&nbsp;tool · ok</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* RECENT HIGHLIGHTS */}
			<section className="pp-band">
				<div className="pp-wrap pp-highlights">
					<span className="pp-hl-label">Recent highlights</span>
					<div className="pp-posts">
						{HIGHLIGHTS.map((h) => (
							<Link key={h.title} href="/docs/changelog" className="pp-post">
								<h4>{h.title}</h4>
								<p>{h.body}</p>
								<span className="meta">{h.meta}</span>
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
