import type { SystemStatus } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the data plane for Stacks",
	description:
		"Foundation Datasets, subgraphs, streams, indexes, and subscriptions for every team building on Stacks. Calm infrastructure beats clever infrastructure.",
};

const STATUS_API_URL = process.env.SL_API_URL || "http://localhost:3800";
const STATUS_API_KEY =
	process.env.SL_STATUS_API_KEY || process.env.SL_SERVICE_KEY;
const STATUS_PATH = STATUS_API_KEY ? "/status" : "/public/status";

async function readStatus(): Promise<SystemStatus | null> {
	try {
		const headers: Record<string, string> = {};
		if (STATUS_API_KEY) headers.Authorization = `Bearer ${STATUS_API_KEY}`;
		const res = await fetch(`${STATUS_API_URL}${STATUS_PATH}`, {
			headers,
			cache: "no-store",
		});
		if (!res.ok) return null;
		return (await res.json()) as SystemStatus;
	} catch {
		return null;
	}
}

const LAYERS: Array<{
	num: string;
	name: string;
	one: string;
	for: string;
	href?: string;
}> = [
	{
		num: "01",
		name: "Foundation Datasets",
		one: "Five public-good datasets — STX Transfers, sBTC, PoX-4, BNS, Network Health. Stable schemas, REST APIs, parquet bulk dumps.",
		for: "for analysts, dashboards, agents",
		href: "/datasets",
	},
	{
		num: "02",
		name: "Streams",
		one: "Raw event firehose. Cursor-paginated reads, idempotent ingest, deterministic replay.",
		for: "for indexers, archivers, backfill",
	},
	{
		num: "03",
		name: "Index",
		one: "Decoded transaction-level read API. Joinable shapes for FTs, NFTs, contract calls.",
		for: "for app backends, search",
	},
	{
		num: "04",
		name: "Subgraphs",
		one: "Define your own indexed shape. Deploys to a dedicated Postgres you can SSH into.",
		for: "for app teams who outgrow public datasets",
		href: "/subgraphs",
	},
	{
		num: "05",
		name: "Subscriptions",
		one: "Push delivery to your webhook. Inngest, Trigger.dev, Cloudflare, Node-native runtimes.",
		for: "for event-driven app loops",
	},
];

function fmt(n: number | null | undefined): string {
	if (n === null || n === undefined) return "—";
	return n.toLocaleString("en-US");
}

function fmtSeconds(s: number | null | undefined): string {
	if (s === null || s === undefined) return "—";
	if (s < 60) return `${Math.round(s)}s`;
	const m = Math.floor(s / 60);
	const r = Math.round(s - m * 60);
	return r ? `${m}m ${r}s` : `${m}m`;
}

export default async function WwwLandingPage() {
	const status = await readStatus();
	const chainTip =
		status?.chainTip ?? status?.streams?.tip?.block_height ?? null;
	const streamsLag = status?.streams?.tip?.lag_seconds ?? null;
	const reorgs24h = status?.reorgs?.last_24h ?? null;
	const overallStatus = status?.status ?? null;

	return (
		<div className="www-page">
			<a className="www-skip-link" href="#main">
				Skip to content
			</a>
			<header className="www-topbar">
				<div className="www-mark">
					<span className="www-mark-dot" aria-hidden="true" />
					<Link
						href="/"
						className="www-mark-text"
						aria-label="secondlayer home"
					>
						secondlayer
					</Link>
				</div>
				<nav className="www-nav" aria-label="Primary">
					<Link href="/datasets">datasets</Link>
					<Link href="/pricing">pricing</Link>
					<Link href="/docs">docs</Link>
					<Link href="/platform" className="www-nav-cta">
						sign in →
					</Link>
				</nav>
			</header>

			<main id="main">
				<section className="www-hero" aria-labelledby="hero-title">
					<div className="www-eyebrow">
						<span className="www-eyebrow-tick" aria-hidden="true" />
						<span>The data plane for Stacks</span>
					</div>
					<h1 id="hero-title" className="www-hero-title">
						Calm infrastructure
						<br />
						for every team building
						<br />
						on Bitcoin's L2.
					</h1>
					<p className="www-hero-sub">
						Foundation Datasets, subgraphs, streams, indexes, and subscriptions
						— layered, observable, dependable. Reputation is the moat.
					</p>
					<div className="www-cta-row">
						<Link href="/platform" className="www-btn www-btn-primary">
							Start free
						</Link>
						<Link href="mailto:hi@secondlayer.tools" className="www-btn">
							Talk to us
						</Link>
					</div>
				</section>

				<section className="www-evidence">
					<div className="www-evidence-row">
						<EvidenceCell
							label="Stacks tip"
							value={fmt(chainTip)}
							suffix="blk"
						/>
						<EvidenceCell
							label="Streams lag"
							value={fmtSeconds(streamsLag)}
							mode={streamsLag !== null && streamsLag <= 30 ? "ok" : "neutral"}
						/>
						<EvidenceCell
							label="Reorgs · 24h"
							value={fmt(reorgs24h)}
							mode={reorgs24h === 0 ? "ok" : "neutral"}
						/>
						<EvidenceCell
							label="System"
							value={
								overallStatus === "healthy"
									? "all green"
									: (overallStatus ?? "—")
							}
							mode={overallStatus === "healthy" ? "ok" : "neutral"}
						/>
					</div>
					<div className="www-evidence-foot">
						<Link href="/public/status" className="www-link-quiet">
							/public/status →
						</Link>
					</div>
				</section>

				<section className="www-section">
					<div className="www-section-head">
						<div className="www-section-num">layers</div>
						<h2 className="www-section-title">
							Five products. One architecture.
						</h2>
						<p className="www-section-sub">
							The chain produces events. We shape, decode, join, and deliver
							them in five layers — each independently useful, independently
							priced, independently versioned. Pick the layer that matches your
							problem and ignore the rest.
						</p>
					</div>
					<ol className="www-layers">
						{LAYERS.map((layer) => (
							<li key={layer.num} className="www-layer">
								<div className="www-layer-num">{layer.num}</div>
								<div className="www-layer-body">
									<h3 className="www-layer-name">
										{layer.href ? (
											<Link href={layer.href}>{layer.name}</Link>
										) : (
											<span>{layer.name}</span>
										)}
									</h3>
									<p className="www-layer-one">{layer.one}</p>
									<p className="www-layer-for">{layer.for}</p>
								</div>
							</li>
						))}
					</ol>
				</section>

				<section className="www-public-goods">
					<div className="www-public-goods-tag">public goods</div>
					<h2 className="www-public-goods-title">
						The five Foundation Datasets are free, forever.
					</h2>
					<p className="www-public-goods-sub">
						STX transfers, sBTC, PoX-4 stacking, BNS, network health. Public
						APIs. Public parquet dumps. Public freshness reporting. We monetize
						hosted infrastructure — never access to the chain.
					</p>
					<div className="www-public-goods-list">
						<Link href="/datasets/stx-transfers">STX Transfers</Link>
						<span aria-hidden="true">·</span>
						<Link href="/datasets/sbtc">sBTC</Link>
						<span aria-hidden="true">·</span>
						<Link href="/datasets/pox-4">PoX-4</Link>
						<span aria-hidden="true">·</span>
						<Link href="/datasets/bns">BNS</Link>
						<span aria-hidden="true">·</span>
						<Link href="/datasets/network-health">Network Health</Link>
					</div>
				</section>

				<section className="www-section www-section-narrow">
					<div className="www-section-head">
						<div className="www-section-num">lineage</div>
						<h2 className="www-section-title">Built on a written-down idea.</h2>
					</div>
					<div className="www-prose">
						<p>
							In 2022, Thomas Osmonson at Fundamental Systems published{" "}
							<em>Project Kourier</em> — a written and recorded walkthrough of
							exactly this layered, "stacked indexers" model for Stacks data
							infrastructure. Kourier identified the right decomposition: a
							raw-events layer anyone can mirror; a canonical-state layer that
							handles reorgs once on behalf of every downstream; and a per-app
							indexing layer where teams shape data however they need.
						</p>
						<p>
							Where Kourier was a proposal, secondlayer is the running system.
							The product names are ours; the architecture is the ecosystem's.
						</p>
					</div>
				</section>

				<section className="www-cta-bottom">
					<h2 className="www-cta-bottom-title">
						Start with public datasets.
						<br />
						Graduate to dedicated when ready.
					</h2>
					<div className="www-cta-row">
						<Link href="/platform" className="www-btn www-btn-primary">
							Start free
						</Link>
						<Link href="/docs/quickstart" className="www-btn">
							Read the quickstart
						</Link>
						<Link href="/pricing" className="www-link-quiet">
							See pricing →
						</Link>
					</div>
				</section>
			</main>

			<footer className="www-footer">
				<div className="www-footer-line">
					<span>secondlayer · the data plane for Stacks</span>
					<span>
						<Link href="/public/status">status</Link>
						{" · "}
						<Link href="/docs">docs</Link>
						{" · "}
						<Link href="/pricing">pricing</Link>
					</span>
				</div>
			</footer>
		</div>
	);
}

function EvidenceCell({
	label,
	value,
	suffix,
	mode = "neutral",
}: {
	label: string;
	value: string;
	suffix?: string;
	mode?: "ok" | "neutral";
}) {
	return (
		<div className={`www-evidence-cell www-evidence-${mode}`}>
			<div className="www-evidence-label">{label}</div>
			<div className="www-evidence-value">
				{value}
				{suffix ? <span className="www-evidence-suffix"> {suffix}</span> : null}
			</div>
		</div>
	);
}
