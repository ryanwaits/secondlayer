import { AgentQuickstart } from "@/components/home/agent-quickstart";
import { CtaPill } from "@/components/home/cta-pill";
import { Notation } from "@/components/notation";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

const SUB =
	"Every Stacks block and Bitcoin rune, decoded from genesis and delivered at tip.";

export const metadata: Metadata = socialMeta({
	title: "secondlayer · instant data for apps on Bitcoin",
	description: `${SUB} Hosted, or on your own box.`,
	image: "/og/home.png",
	path: "/",
});

const WHY = [
	{
		title: "Forks, handled",
		body: "Reorgs roll your rows back and forward on their own. No cleanup job.",
	},
	{
		title: "Gaps, hunted",
		body: "A missing block stops the cursor instead of skipping it. Every height is checked.",
	},
	{
		title: "History included",
		body: (
			<>
				Backfill from genesis or any <code>startBlock</code>, then held at tip.
			</>
		),
	},
	{
		title: "Idle is free",
		body: "You pay for rows delivered, not for time. Block headers are free.",
	},
	{
		title: "Same API, your box",
		body: "Self-host runs the same code. Move either way without rewriting.",
	},
	{
		title: "Your agent can drive",
		body: "CLI, SDK, MCP and agent skills, all on the same key.",
	},
];

export default function Home() {
	return <HomeView />;
}

function CodeWindow({
	path,
	meta,
	children,
}: {
	path: string;
	meta: string;
	children: ReactNode;
}) {
	return (
		<div className="home-code">
			<div className="home-code-bar">
				<i />
				<i />
				<i />
				<span className="home-code-path">{path}</span>
				<span className="home-code-meta">{meta}</span>
			</div>
			<pre>{children}</pre>
		</div>
	);
}

function Well({
	head,
	rows,
	caption,
}: {
	head: { label: string; right?: boolean }[];
	rows: ReactNode[][];
	caption: string;
}) {
	return (
		<div className="home-well">
			<table>
				<thead>
					<tr>
						{head.map((h) => (
							<th key={h.label} className={h.right ? "r" : undefined}>
								{h.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={String(row[0]) + String(row[1])}>
							{row.map((cell, i) => (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: static cells, fixed order
									key={i}
									className={head[i]?.right ? "r" : undefined}
									colSpan={row.length < head.length ? head.length : undefined}
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			<p className="home-well-cap">{caption}</p>
		</div>
	);
}

export function HomeView() {
	return (
		<div className="home">
			<section className="home-hero">
				<h1>
					Instant data
					<br />
					<Notation
						type="highlight"
						color="currentColor"
						multiline
						animationDuration={800}
						delay={400}
						coverage={0.72}
					>
						for apps on Bitcoin.
					</Notation>
				</h1>
				<p className="home-sub">{SUB}</p>
				<div className="home-hero-btns">
					<Link href="/login" className="home-btn-solid">
						Start free
					</Link>
					<Link href="/docs" className="home-btn-outline">
						Read the docs
					</Link>
				</div>
				<p className="home-hero-under">
					1M rows free every month. Self-host free forever.
				</p>
			</section>

			<section className="home-sec home-panel" id="products">
				<div className="home-shell">
					<div className="home-head">
						<h2>Rows when you ask. Pushes when it happens.</h2>
						<p>
							Both read the same decoded chain. Pick the one that fits the app
							you already run.
						</p>
					</div>
					<div className="home-doors">
						<article className="home-door">
							<p className="home-lbl">I need rows to query</p>
							<h3>Your contract, as a table.</h3>
							<p>
								Query any decoded event from our API, or write one TypeScript
								file and get your own tables with a REST API you didn&rsquo;t
								write.
							</p>
							<div className="home-chips">
								<span className="home-chip">Index</span>
								<span className="home-chip">Subgraphs</span>
							</div>
							<CodeWindow
								path="pox5-stakes.ts"
								meta="secondlayer subgraphs deploy"
							>
								<span className="tm">
									{"// one file: events in, your table out"}
								</span>
								{"\n"}
								<span className="tb">export default</span>
								{" defineSubgraph({\n  name: "}
								<span className="tt">&quot;pox5-stakes&quot;</span>
								{",\n  startBlock: "}
								<span className="tt">8_740_000</span>
								{",\n  sources: { stake: { type: "}
								<span className="tt">&quot;print_event&quot;</span>
								{",\n    contractId: "}
								<span className="tt">&quot;SP000…002Q6VF78.pox-5&quot;</span>
								{" } },\n  …\n});\n"}
								<span className="tok">✓ deployed</span>{" "}
								<span className="tm">
									· GET /v1/subgraphs/pox5-stakes/stakes
								</span>
							</CodeWindow>
							<Link href="/docs/subgraphs/hosted" className="home-go">
								Build a subgraph
							</Link>
						</article>
						<article className="home-door">
							<p className="home-lbl">I need to react</p>
							<h3>Your server, told first.</h3>
							<p>
								A signed POST the moment a matching event lands, with retries,
								replay and a log of every attempt. Or follow the ordered feed
								yourself.
							</p>
							<div className="home-chips">
								<span className="home-chip">Webhooks</span>
								<span className="home-chip">Streams</span>
							</div>
							<CodeWindow path="POST https://your.app/hooks/sbtc" meta="signed">
								<span className="tm">secondlayer-signature: t=…,v1=…</span>
								{"\n{\n  "}
								<span className="tt">&quot;type&quot;</span>
								{": "}
								<span className="tt">&quot;ft_transfer&quot;</span>
								{",\n  "}
								<span className="tt">&quot;asset&quot;</span>
								{": "}
								<span className="tt">&quot;…sbtc-token::sbtc-token&quot;</span>
								{",\n  "}
								<span className="tt">&quot;amount&quot;</span>
								{": "}
								<span className="tb">&quot;250000&quot;</span>
								{",\n  "}
								<span className="tt">&quot;block_height&quot;</span>
								{": "}
								<span className="tb">9134950</span>
								{"\n}\n"}
								<span className="tok">200 OK</span>{" "}
								<span className="tm">· delivered 0.8s after ingest</span>
							</CodeWindow>
							<Link href="/docs/webhooks" className="home-go">
								Create a webhook
							</Link>
						</article>
					</div>
				</div>
			</section>

			<section className="home-sec" id="why">
				<div className="home-shell">
					<div className="home-head">
						<h2>Built for apps that can&rsquo;t miss a block.</h2>
					</div>
					<div className="home-why">
						{WHY.map((w) => (
							<div key={w.title}>
								<h3>{w.title}</h3>
								<p>{w.body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="home-sec home-panel" id="data">
				<div className="home-shell">
					<div className="home-head">
						<h2>Data nobody else decodes.</h2>
						<p>
							The protocols that matter on Bitcoin, as typed rows, from the
							first block they existed.
						</p>
					</div>
					<div className="home-ds">
						<article className="home-ds-card">
							<div className="home-ds-tag">
								<h3>PoX-5 stakes by signer</h3>
							</div>
							<p>
								Every stake, delegation and reward cycle, keyed to the signer
								that holds it.
							</p>
							<Well
								head={[
									{ label: "staker" },
									{ label: "signer" },
									{ label: "STX", right: true },
								]}
								rows={[
									["SP15RG…CJ01", "native-pool", "60,000"],
									["SP2507…4V39", "fastpool-max500", "14,750"],
									["SP3KS5…XW6", "xverse-3", "980"],
								]}
								caption="GET /v1/index/pox5/events?signer=…"
							/>
						</article>
						<article className="home-ds-card">
							<div className="home-ds-tag">
								<h3>sBTC in and out</h3>
							</div>
							<p>
								Deposits, withdrawals and token moves, so a supply or peg check
								is one query.
							</p>
							<Well
								head={[
									{ label: "kind" },
									{ label: "block" },
									{ label: "sats", right: true },
								]}
								rows={[
									["deposit", "9134902", "250,000"],
									["withdrawal", "9134811", "1,000,000"],
									["transfer", "9134790", "48,210"],
								]}
								caption="GET /v1/index/sbtc/deposits · example rows"
							/>
						</article>
						<article className="home-ds-card">
							<div className="home-ds-tag">
								<h3>Runes</h3>
								<span className="home-soon">Rolling out</span>
							</div>
							<p>
								Every etching, mint and balance on Bitcoin, from block 840,000,
								checked against ord.
							</p>
							<Well
								head={[
									{ label: "rune" },
									{ label: "id" },
									{ label: "holders", right: true },
								]}
								rows={[
									["DOG•GO•TO•THE•MOON", "840000:3", "…"],
									[
										<span key="n" className="home-well-note">
											215,495 runes · 6.9M outpoints tracked
										</span>,
									],
								]}
								caption="GET /v1/index/runes/:id"
							/>
						</article>
						<article className="home-ds-card">
							<div className="home-ds-tag">
								<h3>Clarity state changes</h3>
								<span className="home-soon">Coming soon</span>
							</div>
							<p>
								Every map and variable write, and every contract call inside a
								call, for contracts that never print a thing.
							</p>
							<Well
								head={[
									{ label: "block" },
									{ label: "op" },
									{ label: "contract" },
									{ label: "key" },
								]}
								rows={[
									["9134950", "map-set", "…amm-pool-v2", "{ id: u42 }"],
									["9134950", "var-set", "…amm-pool-v2", "total-supply"],
									["9134950", "call", "…router → …amm-pool-v2", "swap-x-for-y"],
								]}
								caption="from the Clarity VM, in order · example rows"
							/>
						</article>
					</div>
				</div>
			</section>

			<section className="home-sec" id="pricing">
				<div className="home-shell">
					<div className="home-head">
						<h2>Your box or ours.</h2>
						<p className="home-fork-q">
							Already run a Stacks node? Run it beside your node. If not, use
							ours.
						</p>
					</div>
					<div className="home-fork">
						<div>
							<div className="home-fork-body">
								<p className="home-lbl">Hosted</p>
								<h3>Ours, private to your account.</h3>
								<ul>
									<li>
										<span>
											Index, Streams, Subgraphs and Webhooks on{" "}
											<code>api.secondlayer.tools</code>
										</span>
									</li>
									<li>
										<span>Your subgraphs run in your own sandboxed stack</span>
									</li>
									<li>
										<span>Prepaid credits, spend caps, no surprise bills</span>
									</li>
								</ul>
							</div>
							<Link href="/login" className="home-btn-solid">
								Start free
							</Link>
							<p className="home-fork-price">
								1M rows free / month · then $5 per 1M · stack from ~$10/mo while
								it runs
							</p>
						</div>
						<div>
							<div className="home-fork-body">
								<p className="home-lbl">Self-host</p>
								<h3>Yours, the same code.</h3>
								<ul>
									<li>
										<span>
											One container beside your node, rows in Postgres you
											operate
										</span>
									</li>
									<li>
										<span>
											Bootstrap from the signed archive, verify it for free
										</span>
									</li>
									<li>
										<span>MIT. No meter on anything you run</span>
									</li>
								</ul>
								<CtaPill />
							</div>
							<Link href="/docs/self-host" className="home-btn-outline">
								Self-host guide
							</Link>
							<p className="home-fork-price">
								Free · archive bootstrap is the only paid part
							</p>
						</div>
					</div>
				</div>
			</section>

			<AgentQuickstart />

			<section className="home-sec home-panel home-close">
				<div className="home-shell">
					<h2>Ship on Bitcoin data today.</h2>
					<p>Start with 1M free rows. No node to run.</p>
					<div className="home-final-btns">
						<Link href="/login" className="home-btn-solid">
							Start free
						</Link>
						<Link href="/docs" className="home-btn-outline">
							Read the docs
						</Link>
					</div>
				</div>
			</section>
		</div>
	);
}
