import { Code } from "@/components/code/code";
import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Highlight,
	Split,
	StatusDot,
} from "@/components/site";
import { RowsTable, TrustChainArt } from "@/components/site/assets";
import { ChainLink } from "@/components/site/chain-link";
import { socialMeta } from "@/lib/og";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

const SUB =
	"Index Stacks and Runes from their first block, stream new ones as they land, and prove Stacks data back to Bitcoin. Runes on hosted is coming soon.";

export const metadata: Metadata = socialMeta({
	title: "secondlayer · instant data for apps on Bitcoin",
	description: `${SUB} Hosted, or on your own box.`,
	image: "/og/home.png",
	path: "/",
});

/** Longer hero lines. The short nav line lives in PRODUCTS. */
const SPINE_LINE: Record<(typeof PRODUCTS)[number]["noun"], string> = {
	Archive: "Signed history. Check your copy free, repair only what's broken.",
	Streams: "Every event in order. You hold the cursor.",
	Index: "Typed rows from genesis, filtered before they cost you.",
	Subgraphs: "Your contract, as a table you query.",
	Webhooks: "Your server, told first. Signed, retried, logged.",
};

function TileIcon({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 22 22"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

const TILES: readonly { icon: ReactNode; title: string; body: ReactNode }[] = [
	{
		icon: (
			<TileIcon>
				<path d="M4 18V9a5 5 0 0 1 5-5h0M4 18h0M11 18v-6a4 4 0 0 1 4-4h3" />
				<circle cx="4" cy="18" r="1.6" />
				<circle cx="11" cy="18" r="1.6" />
			</TileIcon>
		),
		title: "Forks, handled",
		body: "Every page reports the tip, the finalized height and any reorg that crossed your cursor.",
	},
	{
		icon: (
			<TileIcon>
				<rect x="2.5" y="7" width="5" height="8" rx="1" />
				<rect x="14.5" y="7" width="5" height="8" rx="1" />
				<path d="M9.5 11h3" strokeDasharray="1.5 1.5" />
			</TileIcon>
		),
		title: "Gaps, hunted",
		body: "Block count equals span, so a missing block shows up as arithmetic. Repair fetches just that range.",
	},
	{
		icon: (
			<TileIcon>
				<path d="M3 11h16M3 11l4-4M3 11l4 4" />
				<path d="M19 5v12" />
			</TileIcon>
		),
		title: "History included",
		body: "Backfill from genesis on the same rows you read live. No second pipeline for the past.",
	},
	{
		icon: (
			<TileIcon>
				<rect x="5" y="4" width="4" height="14" rx="1" />
				<rect x="13" y="4" width="4" height="14" rx="1" />
			</TileIcon>
		),
		title: "Idle is free",
		body: "A stopped stack costs nothing. Reading your own subgraph tables costs nothing.",
	},
	{
		icon: (
			<TileIcon>
				<rect x="3" y="4" width="16" height="6" rx="1.5" />
				<rect x="3" y="12" width="16" height="6" rx="1.5" />
				<path d="M6 7h.01M6 15h.01" />
			</TileIcon>
		),
		title: "Same API on your box",
		body: (
			<>
				Point <code>SECONDLAYER_API_URL</code> at your instance. The CLI, SDK
				and routes answer the same.
			</>
		),
	},
	{
		icon: (
			<TileIcon>
				<path d="M5 7l4 4-4 4M11 16h6" />
			</TileIcon>
		),
		title: "Your agent can drive",
		body: "CLI · SDK · 50 MCP tools · a skill. Errors carry a request id your agent can report back.",
	},
];

const COVERS: readonly {
	covered: boolean;
	title: string;
	detail?: string;
}[] = [
	{
		covered: true,
		title: "Block headers and signatures",
	},
	{
		covered: true,
		title: "Which transactions a block holds",
	},
	{
		covered: true,
		title: "State changes",
	},
	{
		covered: true,
		title: "State subgraph rows",
	},
	{
		covered: false,
		title: "Print events and transaction results",
		detail: "Not covered yet. Stacks headers don't commit to them.",
	},
];

const VERIFY = `$ secondlayer verify block 9137005
  checkpoint         9,000,000 (shipped)
  ✓ bitcoin headers
  ✓ signer set
  ✓ tx merkle root
  ✓ state writes     every map, var and balance
  ✓ block 9,137,005 verified

$ secondlayer verify subgraph sbtc-flows --replay
  ✓ rows recomputed · match`;

export default function Home() {
	return <HomeView />;
}

export function HomeView() {
	return (
		<main className="site home" id="top">
			<section className="hero">
				<div className="shell">
					<div className="hero-copy">
						<h1>
							Instant data for apps on
							<br /> Bitcoin. <Highlight>Proof included.</Highlight>
						</h1>
						<div className="hero-row">
							<p className="sub">
								Index{" "}
								<ChainLink chain="stacks" href="/p/index">
									Stacks
								</ChainLink>{" "}
								and{" "}
								<ChainLink chain="runes" href="/docs/index#runes">
									Runes
								</ChainLink>{" "}
								from their first block, stream new ones as they land, and prove
								Stacks data back to{" "}
								<ChainLink chain="bitcoin" href="/verify#chain">
									Bitcoin
								</ChainLink>
								.
							</p>
							<p className="hero-note">
								Coming soon:{" "}
								<ChainLink chain="runes" href="#runes-data">
									Runes
								</ChainLink>{" "}
								and{" "}
								<ChainLink chain="clarity" href="#clarity-state-writes">
									Clarity
								</ChainLink>{" "}
								contract state, including inner contract calls.
							</p>
							<div className="hero-cta">
								<div className="btns">
									<ButtonLink href="/login">Start free</ButtonLink>
									<ButtonLink href="/docs" variant="secondary">
										Read the docs
									</ButtonLink>
								</div>
								<span className="cap">1M rows free every month</span>
							</div>
						</div>
					</div>
					<nav className="spine" aria-label="Products">
						<div className="spine-head">
							<span className="eyebrow">
								From signed history to your server
							</span>
						</div>
						{PRODUCTS.map((p) => (
							<Link key={p.noun} href={p.href}>
								<span className="n">{p.noun}</span>
								<span className="v">{p.verb}</span>
								<span className="d">{SPINE_LINE[p.noun]}</span>
								<span className="ar" aria-hidden="true">
									→
								</span>
							</Link>
						))}
					</nav>
				</div>
			</section>

			<section className="band" id="verify">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Verify" />
						<h2>Trust, and verify.</h2>
						<p className="lede">
							Each block's state proves back through the signer set to a Bitcoin
							header. You run the check on your machine, and it never asks us
							anything.
						</p>
					</div>
					<div className="verify-trust">
						<TrustChainArt />
					</div>
					<div className="verify-grid">
						<div className="art">
							<Code lang="text" title="~/app" code={VERIFY} />
						</div>
						<ul className="covers" aria-label="What a check covers">
							{COVERS.map((c) => (
								<li key={c.title}>
									<span
										className={c.covered ? "k y" : "k n"}
										aria-hidden="true"
									>
										{c.covered ? "✓" : "–"}
									</span>
									<span>
										{c.title}
										{c.detail ? <span className="s">{c.detail}</span> : null}
									</span>
								</li>
							))}
						</ul>
					</div>
					<div className="verify-foot">
						<ButtonLink href="/verify" variant="secondary">
							How verification works
						</ButtonLink>
					</div>
				</div>
			</section>

			<section className="band" id="reliability">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Reliability" />
						<h2>Built for apps that can't miss a block.</h2>
					</div>
					<div className="tiles">
						{TILES.map((t) => (
							<div className="tile" key={t.title}>
								{t.icon}
								<h3>{t.title}</h3>
								<p>{t.body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="band" id="data">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Datasets" />
						<h2>Data nobody else decodes.</h2>
						<p className="lede">
							Same rows, same price as everything else. No premium for the hard
							ones.
						</p>
					</div>
					<div className="data">
						<div className="well">
							<div className="well-top">
								<h3>PoX-5 by signer</h3>
								<StatusDot state="live" />
							</div>
							<p>
								The pox-5 print log, decoded per signer and cycle since
								activation at Bitcoin block 960,230.
							</p>
							<RowsTable
								columns={["signer", "cycle", "stx locked"]}
								rows={[
									["03a1…9f2c", "n", "41,250,000"],
									["02c7…41b0", "n", "38,900,000"],
									["03f0…be17", "n", "22,410,000"],
								]}
							/>
						</div>
						<div className="well">
							<div className="well-top">
								<h3>sBTC in and out</h3>
								<StatusDot state="live" />
							</div>
							<p>
								Every deposit and withdrawal as one row, with the Bitcoin side
								attached.
							</p>
							<RowsTable
								columns={["direction", "height", "sbtc"]}
								rows={[
									["in", "9,137,002", "0.5000"],
									["out", "9,137,004", "0.1200"],
									["in", "9,137,006", "2.0000"],
								]}
								firstClass={(row) => (row[0] === "in" ? "tag-in" : "tag-out")}
							/>
						</div>
						<div className="well" id="runes-data">
							<div className="well-top">
								<h3>Runes</h3>
								<StatusDot state="rolling" />
							</div>
							<p>
								Catalog, balances and activity from block 840,000, checked
								against ord with the record published.
							</p>
							<div className="stats">
								<div>
									<b>441M</b>
									<span>rune events</span>
								</div>
								<div>
									<b>6.94M</b>
									<span>outpoints</span>
								</div>
								<div>
									<b>0</b>
									<span>mismatches vs ord</span>
								</div>
							</div>
						</div>
						<div className="well" id="clarity-state-writes">
							<div className="well-top">
								<h3>Clarity state writes</h3>
								<StatusDot state="soon" />
							</div>
							<p>
								What a transaction changed inside a contract, including
								contracts that never print.
							</p>
							<RowsTable
								columns={["op", "key", "value"]}
								rows={[
									["map_set", "balances[SP2J…4K]", "u1200"],
									["var_set", "total-supply", "u98400"],
									["map_delete", "pending[u42]", "none"],
								]}
							/>
						</div>
					</div>
					<span className="cap data-note">example rows</span>
				</div>
			</section>

			<section className="band" id="box">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Hosting" />
						<h2>Your box or ours.</h2>
						<p className="lede">
							Same rows, same API, same proofs. You pay for what we run for you,
							and checking our work stays free either way.
						</p>
					</div>
					<div className="fork">
						<div className="side ours">
							<span className="eyebrow">Ours</span>
							<h3>We run it.</h3>
							<p>
								A private stack per account, held at tip. Your subgraphs and
								webhooks run on it, sandboxed from everyone else's.
							</p>
							<ul>
								<li>Index and Streams reads with one key</li>
								<li>Hosted subgraphs, isolated per account</li>
								<li>Signed webhooks with free retries</li>
							</ul>
							<div className="price">
								<span className="cap">
									1M rows free every month · then $5 per 1M
								</span>
							</div>
						</div>
						<div className="side yours">
							<span className="eyebrow">Yours</span>
							<h3>You run it.</h3>
							<p>
								One container beside your node and Postgres. Bootstrap from the
								signed archive in hours instead of replaying the chain.
							</p>
							<ul>
								<li>Same CLI, SDK and routes</li>
								<li>Reads over loopback need no key</li>
								<li>Verify and repair against the public manifests</li>
							</ul>
							<div className="price">
								<span className="cap">MIT · free forever</span>
							</div>
							<Link className="more" href="/docs/self-host">
								Self-host guide →
							</Link>
						</div>
					</div>
					<p className="fork-line">
						Already run a Stacks node?{" "}
						<Link href="/docs/self-host#connect-your-node">
							Point its event observer at secondlayer
						</Link>
					</p>
				</div>
			</section>

			<CloseBand
				title={
					<>
						Ship on Bitcoin data <Highlight>today.</Highlight>
					</>
				}
				cta={
					<>
						<ButtonLink href="/login">Start free</ButtonLink>
						<ButtonLink href="/verify" variant="secondary">
							Verify a block
						</ButtonLink>
					</>
				}
			/>
		</main>
	);
}
