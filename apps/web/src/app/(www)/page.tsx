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
	title: "secondlayer — your indexer, our decoders",
	description:
		"You write the loop, we hand you decoded Stacks events with cursors and reorgs already handled. Deploy it to Railway, Fly, or your own box. No node to run.",
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
					Stop rebuilding the chain indexer.
					<br />
					Start shipping your own.
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
					Your indexer.
					<br />
					Our decoders.
				</h1>
				<p className="home-sub">
					You write the loop, we hand you decoded events with cursors and reorgs
					already handled. Deploy it to Railway, Fly, or your own box. No node
					to run.
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
