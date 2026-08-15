import { CtaPill } from "@/components/home/cta-pill";
import { FeatureStack } from "@/components/home/feature-stack";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "secondlayer · self-hosted Stacks data runtime",
	description:
		"Decoded Stacks data in your own database — backfilled from genesis, reorg-safe, kept current. Get tables and a REST API out of the box, or stream rows into your own schema.",
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
					Decoded chain data,
					<br />
					<span className="home-h1-dim">in your own database.</span>
				</h1>
				<p className="home-sub">
					Backfilled from genesis, reorg-safe, kept current. Get tables and a
					REST API out of the box, or stream rows into your own schema —
					Postgres, SQLite, or anything you already run.
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
				<h2>Your node. Your database.</h2>
				<p className="home-sub">
					One container beside your node. Every row lands in Postgres you
					operate, checkable against the signed archive.
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
