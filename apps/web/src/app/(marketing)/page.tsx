import { BetaBracket } from "@/components/beta-badge";
import { SiteLink } from "@/components/site-link";
import type { SystemStatus } from "@/lib/types";
import cliPackage from "../../../../../packages/cli/package.json";
import mcpPackage from "../../../../../packages/mcp/package.json";
import sdkPackage from "../../../../../packages/sdk/package.json";
import stacksPackage from "../../../../../packages/stacks/package.json";
import { HomeAnnotations } from "./home-annotations";
import { HomeStatusBadge } from "./home-status-toolbar";

export { HomeStatusBadge } from "./home-status-toolbar";

const STATUS_API_URL = process.env.SL_API_URL || "http://localhost:3800";
const STATUS_API_KEY =
	process.env.SL_STATUS_API_KEY || process.env.SL_SERVICE_KEY;
const STATUS_PATH = STATUS_API_KEY ? "/status" : "/public/status";

export const homeProducts = [
	{ name: "Stacks Streams", href: "/stacks-streams" },
	{ name: "Stacks Index", href: "/stacks-index" },
	{ name: "Subgraphs", href: "/subgraphs" },
	{ name: "Subscriptions", href: "/subscriptions" },
];

const interfaces = [
	{ name: "CLI", href: "/cli", version: cliPackage.version },
	{ name: "SDK", href: "/sdk", version: sdkPackage.version },
	{ name: "MCP", href: "/mcp", version: mcpPackage.version },
];

const foundation = [
	{ name: "Stacks", href: "/stacks", version: stacksPackage.version },
];

function IndexItem({
	item,
}: { item: { name: string; href: string; version?: string } }) {
	return (
		<li className="index-item">
			<SiteLink href={item.href} className="index-link">
				<span className="index-link-label">{item.name}</span>
				<span className="index-date">{item.version}</span>
			</SiteLink>
		</li>
	);
}

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

export default async function HomePage() {
	const status = await readStatusSnapshot();

	return (
		<div className="homepage">
			<HomeStatusBadge status={status} />
			<header className="page-header">
				<h1 className="page-title">secondlayer</h1>
			</header>

			<HomeAnnotations />

			<section
				className="index-group"
				style={{ marginTop: "var(--spacing-xl)" }}
			>
				<div className="index-year-group">
					<div className="index-year">Products</div>
					<BetaBracket>
						<ul className="index-list">
							{homeProducts.map((item) => (
								<IndexItem key={item.href} item={item} />
							))}
						</ul>
					</BetaBracket>
				</div>

				<div className="index-year-group">
					<div className="index-year">Interfaces</div>
					<ul className="index-list">
						{interfaces.map((item) => (
							<IndexItem key={item.href} item={item} />
						))}
					</ul>
				</div>

				<div className="index-year-group">
					<div className="index-year">Foundation</div>
					<ul className="index-list">
						{foundation.map((item) => (
							<IndexItem key={item.href} item={item} />
						))}
					</ul>
				</div>
			</section>
		</div>
	);
}
