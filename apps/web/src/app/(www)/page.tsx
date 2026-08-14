import { CtaPill } from "@/components/home/cta-pill";
import { FeatureStack } from "@/components/home/feature-stack";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "secondlayer · self-hosted Stacks runtime",
	description:
		"Postgres plus one container beside your node. The signed archive is public to check. Large restore and backfill off our R2 is metered.",
	image: "/og/home.png",
	path: "/",
});

export default function Home() {
	return <HomeView />;
}

export function HomeView() {
	return (
		<div className="home">
			<section className="home-hero">
				<h1>
					Self-hosted
					<br />
					<span className="home-h1-dim">Stacks runtime.</span>
				</h1>
				<p className="home-sub">
					Raw and decoded events, subgraphs, webhooks, and verified history,
					running beside your node.
				</p>
				<CtaPill />
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
					One container beside your node. Every row lands in your DB, checkable
					against the signed archive.
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
