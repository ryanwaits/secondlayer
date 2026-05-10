import { HomeStatusBadge } from "@/components/status/home-status-badge";
import type { SystemStatus } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the agent-native data plane for Stacks",
	description:
		"The agent-native data plane for Stacks. Pull with Streams, index with Subgraphs, push with Subscriptions, query five Foundation Datasets directly. Public goods, free forever.",
};

const products = [
	{ name: "Streams", href: "/streams" },
	{ name: "Subgraphs", href: "/subgraphs" },
	{ name: "Subscriptions", href: "/subscriptions" },
	{ name: "Datasets", href: "/datasets" },
	{ name: "Tools", href: "/tools" },
];

function IndexRow({ item }: { item: { name: string; href: string } }) {
	return (
		<li className="index-item">
			<Link href={item.href} className="index-link">
				<span className="index-link-label">{item.name}</span>
			</Link>
		</li>
	);
}

const STATUS_API_URL = process.env.SL_API_URL || "https://api.secondlayer.tools";
const STATUS_API_KEY =
	process.env.SL_STATUS_API_KEY || process.env.SL_SERVICE_KEY;
const STATUS_PATH = STATUS_API_KEY ? "/status" : "/public/status";

async function readStatusSnapshot(): Promise<SystemStatus | null> {
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

export default async function Home() {
	const status = await readStatusSnapshot();
	return <HomeView status={status} />;
}

// Sync inner view, exported for the smoke test (renderToStaticMarkup is sync).
export function HomeView({ status }: { status: SystemStatus | null }) {
	return (
		<div className="homepage">
			<HomeStatusBadge status={status} />
			<header className="page-header">
				<h1 className="page-title page-title-with-logo">
					<svg
						viewBox="4 7 40 28"
						width="24"
						height="16"
						fill="none"
						aria-hidden="true"
					>
						<polygon
							points="8,25 28,17 42,25 22,33"
							className="logo-echo"
						/>
						<polygon
							points="8,19 28,11 42,19 22,27"
							className="logo-primary"
						/>
					</svg>
					<span>secondlayer</span>
				</h1>
			</header>

			<div className="prose www-manifest">
				<p>
					Secondlayer is the agent-native data plane for Stacks.{" "}
					<em>
						The chain produces events; apps and agents need them in any shape.
					</em>
				</p>
				<p>
					Pull them with Streams, index them with Subgraphs, push them with
					Subscriptions, or query five{" "}
					<Link href="/datasets">Foundation Datasets</Link> directly. Public
					goods, free forever. Hosted infrastructure on top.
				</p>
			</div>

			<section
				className="index-group"
				style={{ marginTop: "var(--spacing-xl)" }}
			>
				<div className="index-year-group">
					<div className="index-year">Products</div>
					<ul className="index-list">
						{products.map((p) => (
							<IndexRow key={p.href} item={p} />
						))}
					</ul>
				</div>
			</section>
		</div>
	);
}
