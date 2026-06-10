import { CtaPill } from "@/components/home/cta-pill";
import { HomeFeatures, HomeGetStarted } from "@/components/home/home-sections";
import { ProtocolMarquee } from "@/components/home/protocol-marquee";
import { HomeStatusBadge } from "@/components/status/home-status-badge";
import type { SystemStatus } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer — the data plane for Stacks",
	description:
		"Raw events, decoded transactions, and your own indexed views — one API, no node, readable by anyone. Even agents that pay per call.",
};

const STATUS_API_URL =
	process.env.SL_API_URL || "https://api.secondlayer.tools";
const STATUS_API_KEY =
	process.env.SL_STATUS_API_KEY || process.env.SL_SERVICE_KEY;
const STATUS_PATH = STATUS_API_KEY ? "/status" : "/public/status";

async function readStatusSnapshot(): Promise<SystemStatus | null> {
	try {
		const headers: Record<string, string> = {};
		if (STATUS_API_KEY) headers.Authorization = `Bearer ${STATUS_API_KEY}`;
		const res = await fetch(`${STATUS_API_URL}${STATUS_PATH}`, {
			headers,
			// ISR: keep `/` static + prefetchable; refresh the status snapshot
			// server-side at most every 30s instead of a blocking fetch per request.
			next: { revalidate: 30 },
		});
		if (!res.ok) return null;
		return (await res.json()) as SystemStatus;
	} catch {
		return null;
	}
}

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
					Ship your indexer once.
				</h2>
				<p className="home-sub">
					Open data, open SDKs, honest infrastructure. The indexing every
					Stacks team rebuilds — run as a utility.
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
					Decoded once.
					<br />
					Query forever.
				</h1>
				<p className="home-sub">
					The data plane for Stacks: raw events, decoded transactions, and your
					own indexed views — one API, no node, readable by anyone. Even agents
					that pay per call.
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
