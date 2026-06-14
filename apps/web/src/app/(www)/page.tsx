import { CtaPill } from "@/components/home/cta-pill";
import { HomeFeatures, HomeGetStarted } from "@/components/home/home-sections";
import { ProtocolMarquee } from "@/components/home/protocol-marquee";
import { HomeStatusBadge } from "@/components/status/home-status-badge";
import { socialMeta } from "@/lib/og";
import { readStatusSnapshot } from "@/lib/status-snapshot";
import type { SystemStatus } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "secondlayer — every layer of the chain, none of the infra",
	description:
		"Build a custom indexer at any level — the raw event firehose, decoded queryable rows, or a hosted one-file subgraph. All on decoded Stacks data, no node to run.",
	image: "/og/home.png",
	path: "/",
});

export default async function Home() {
	const status = await readStatusSnapshot();
	return (
		<>
			<HomeView status={status} />
			<ProtocolMarquee />
			<HomeFeatures />
			<HomeGetStarted />
			<section className="home-final">
				<h2>
					Stop rebuilding the indexer.
					<br />
					Start shipping features.
				</h2>
				<p className="home-sub">
					Open data, open SDKs, honest infrastructure — decoded sBTC, PoX, and
					Clarity calls included.
				</p>
				<div className="home-ctas">
					<CtaPill />
				</div>
			</section>
		</>
	);
}

// Sync inner view, exported for the smoke test (renderToStaticMarkup is sync).
export function HomeView({ status }: { status: SystemStatus | null }) {
	return (
		<div className="home">
			<HomeStatusBadge status={status} />

			<section className="home-hero">
				<Link href="/subgraphs/explore" className="home-pill">
					<span className="home-pill-dot" />
					Latest — Explore subgraphs is live
					<span className="home-pill-arr">→</span>
				</Link>
				<h1>
					Every layer of the chain.
					<br />
					None of the infra.
				</h1>
				<p className="home-sub">
					Build a custom indexer at any altitude — tail the raw event firehose,
					query decoded rows, or deploy a hosted one-file subgraph. It&apos;s
					all decoded Stacks data — transfers, contract calls, sBTC peg events,
					typed into JSON — with no node to run.
				</p>
				<div className="home-ctas">
					<CtaPill />
					<Link href="/docs" className="home-ghost-cta">
						Read the docs <span className="ar">→</span>
					</Link>
				</div>
			</section>

			{/* S3 mounts: marquee → capability sections → get-started → final CTA */}
		</div>
	);
}
