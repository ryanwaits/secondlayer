import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Highlight,
	StatusDot,
} from "@/components/site";
import { RowsTable } from "@/components/site/assets";
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
					<div className="next-cols">
						<div className="next-col">
							<StatusDot state="live" />
							<p>
								PoX-5 stacking on{" "}
								<ChainLink chain="stacks" href="/docs/index#pox-5">
									Stacks
								</ChainLink>
								, decoded per signer and cycle since activation at Bitcoin block
								960,230. And every{" "}
								<ChainLink chain="sbtc" href="/docs/index#sbtc">
									sBTC
								</ChainLink>{" "}
								deposit and withdrawal as one row, with its Bitcoin side
								attached.
							</p>
							<div className="next-example">
								<RowsTable
									columns={[
										"direction",
										"height",
										"bitcoin transaction",
										"sbtc",
									]}
									rows={[
										["in", "9,137,002", "7c1e…a0", "0.5000"],
										["out", "9,137,004", "e93b…41", "0.1200"],
										["in", "9,137,006", "2fd0…9c", "2.0000"],
									]}
									firstClass={(row) => (row[0] === "in" ? "tag-in" : "tag-out")}
								/>
								<span className="cap">example rows · sBTC in and out</span>
							</div>
						</div>
						<div className="next-col">
							<StatusDot state="soon" />
							<p>
								<span id="runes-data">
									<ChainLink chain="runes" href="/docs/index#runes">
										Runes
									</ChainLink>{" "}
									indexing
								</span>{" "}
								<span id="clarity-state-writes">
									and <ChainLink chain="clarity">Clarity</ChainLink> contract
									state: every map and variable write, including inner contract
									calls.
								</span>
							</p>
							<div className="next-example">
								<RowsTable
									columns={["op", "key", "value"]}
									rows={[
										["map_set", "balances[SP2J…4K]", "u1200"],
										["var_set", "total-supply", "u98400"],
										["map_delete", "pending[u42]", "none"],
									]}
								/>
								<span className="cap">
									example rows · Clarity contract state
								</span>
							</div>
						</div>
					</div>
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
