import { BetaBracket } from "@/components/beta-badge";
import { SiteLink } from "@/components/site-link";
import cliPackage from "../../../../../packages/cli/package.json";
import mcpPackage from "../../../../../packages/mcp/package.json";
import sdkPackage from "../../../../../packages/sdk/package.json";
import stacksPackage from "../../../../../packages/stacks/package.json";
import { HomeAnnotations } from "./home-annotations";

const products = [
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

export default function HomePage() {
	return (
		<div className="homepage">
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
							{products.map((item) => (
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
