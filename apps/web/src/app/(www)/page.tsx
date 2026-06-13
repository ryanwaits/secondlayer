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
	title: "secondlayer — the chain, decoded",
	description:
		"Every transfer, contract call, and sBTC peg event on Stacks — decoded into typed JSON. Read it keyless over REST, the SDK, or your agent. No node required.",
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
					Stop running nodes.
					<br />
					Ship your own API.
				</h2>
				<p className="home-sub">
					Open data, open SDKs, honest infrastructure. The indexing every Stacks
					team rebuilds — run as a utility.
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
					The chain, decoded.
					<br />
					No node required.
				</h1>
				<p className="home-sub">
					Every transfer, contract call, and sBTC peg event on Stacks — decoded
					into typed JSON. Read it keyless over REST, the SDK, or your agent.
					Outgrow the read? Deploy your own indexer in one file.
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
