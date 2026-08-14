import { CtaPill } from "@/components/home/cta-pill";
import { FeatureStack } from "@/components/home/feature-stack";
import { HomeStatusBadge } from "@/components/status/home-status-badge";
import { socialMeta } from "@/lib/og";
import { readStatusSnapshot } from "@/lib/status-snapshot";
import type { SystemStatus } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "secondlayer — self-hosted Stacks data",
	description:
		"Postgres plus one container beside your node. The signed archive is public to check. Large restore and backfill off our R2 is metered.",
	image: "/og/home.png",
	path: "/",
});

export default async function Home() {
	const status = await readStatusSnapshot();
	return <HomeView status={status} />;
}

export function HomeView({ status }: { status: SystemStatus | null }) {
	return (
		<div className="home">
			<HomeStatusBadge status={status} />

			<section className="home-hero">
				<Link href="/docs/self-host" className="home-announce">
					<span className="home-announce-tag">NEW</span>
					<span className="home-announce-msg">
						<b>Postgres plus one container</b>
						<span> beside your node</span>
					</span>
					<span className="home-announce-go" aria-hidden="true">
						›
					</span>
				</Link>
				<h1>
					Self-hosted
					<br />
					<span className="home-h1-dim">Stacks runtime.</span>
				</h1>
				<p className="home-sub">
					Decoded data, TypeScript subgraphs, and verified history, running
					beside your node.
				</p>
				<CtaPill />
				<p className="home-caption">
					Free to self-host. Archive restore is metered.
				</p>
				<nav className="home-hero-links">
					<Link href="/docs">
						Read Docs <span className="home-hero-ch" aria-hidden="true" />
					</Link>
					<Link href="/docs/changelog">
						Changelog <span className="home-hero-ch" aria-hidden="true" />
					</Link>
					<Link href="/docs/self-host">
						Self-host <span className="home-hero-ch" aria-hidden="true" />
					</Link>
				</nav>
			</section>

			<FeatureStack />

			<section className="home-final">
				<h2>Your node. Your schema.</h2>
				<p className="home-sub">
					Docs for the surfaces. Archive for the check.
				</p>
				<CtaPill />
				<div className="home-final-btns">
					<Link href="/docs" className="home-btn-outline">
						Read docs
					</Link>
					<Link href="/docs/self-host" className="home-btn-solid">
						Get started
					</Link>
				</div>
			</section>
		</div>
	);
}
