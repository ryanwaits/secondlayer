import { HomeStatusBadge } from "@/components/status/home-status-badge";
import type { SystemStatus } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the agent-native data plane for Stacks",
	description:
		"The agent-native data plane for Stacks. Pull raw with Streams, query decoded with Index, shape your own with Subgraphs, push with Subscriptions, or query the curated Foundation Datasets. Indexed once, free to read.",
};

type IndexEntry = {
	name: string;
	href: string;
	desc: string;
	endpoint: string;
};

const products: IndexEntry[] = [
	{
		name: "Streams",
		href: "/streams",
		desc: "Raw chain events, in order.",
		endpoint: "/v1/streams",
	},
	{
		name: "Index",
		href: "/index-api",
		desc: "Decoded transactions and events.",
		endpoint: "/v1/index",
	},
	{
		name: "Subgraphs",
		href: "/subgraphs",
		desc: "Your schema, your handlers.",
		endpoint: "/api/subgraphs",
	},
	{
		name: "Subscriptions",
		href: "/subscriptions",
		desc: "Webhooks pushed to your endpoint.",
		endpoint: "push",
	},
];

const tools: IndexEntry[] = [
	{
		name: "SDK",
		href: "/sdk",
		desc: "Typed Stacks client, viem-style.",
		endpoint: "@secondlayer/sdk",
	},
	{
		name: "CLI",
		href: "/cli",
		desc: "Deploy and inspect from the terminal.",
		endpoint: "sl",
	},
	{
		name: "MCP",
		href: "/mcp",
		desc: "Chain data for your agent.",
		endpoint: "mcp",
	},
	{
		name: "Datasets",
		href: "/datasets",
		desc: "Curated Foundation datasets.",
		endpoint: "/v1/datasets",
	},
];

function IndexRow({ item }: { item: IndexEntry }) {
	return (
		<li className="index-item">
			<Link href={item.href} className="index-link">
				<span className="index-link-main">
					<span className="index-link-label">{item.name}</span>
					<span className="index-link-desc">{item.desc}</span>
				</span>
				<span className="index-link-end">{item.endpoint}</span>
			</Link>
		</li>
	);
}

function IndexGroup({ label, items }: { label: string; items: IndexEntry[] }) {
	return (
		<div className="index-year-group">
			<div className="index-year">{label}</div>
			<ul className="index-list">
				{items.map((item) => (
					<IndexRow key={item.href} item={item} />
				))}
			</ul>
		</div>
	);
}

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
						<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
						<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
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
					Pull raw with Streams, query decoded with Index, shape your own with
					Subgraphs, push with Subscriptions, or query the curated{" "}
					<Link href="/datasets">Foundation Datasets</Link> directly.
				</p>
			</div>

			<section
				className="index-group"
				style={{ marginTop: "var(--spacing-xl)" }}
			>
				<IndexGroup label="Products" items={products} />
				<IndexGroup label="Tools" items={tools} />
			</section>
		</div>
	);
}
