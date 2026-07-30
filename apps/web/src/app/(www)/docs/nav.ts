export interface DocsNavItem {
	title: string;
	href: string;
}
export interface DocsNavGroup {
	label: string;
	items: DocsNavItem[];
}

/** Sidebar information architecture for the docs site. */
export const DOCS_NAV: DocsNavGroup[] = [
	{
		label: "Getting started",
		items: [
			{ title: "Introduction", href: "/docs" },
			{ title: "Quickstart", href: "/docs/quickstart" },
			{ title: "Devnet", href: "/docs/devnet" },
			{ title: "Authentication", href: "/docs/authentication" },
		],
	},
	{
		label: "Build",
		items: [
			{ title: "Index", href: "/docs/index" },
			{ title: "Subgraphs", href: "/docs/subgraphs" },
			{ title: "Subscriptions", href: "/docs/subscriptions" },
			{ title: "Streams", href: "/docs/streams" },
			{ title: "SDK", href: "/docs/sdk" },
			{ title: "Sinks", href: "/docs/sinks" },
			{ title: "Filters", href: "/docs/filters" },
			{ title: "CLI", href: "/docs/cli" },
			{ title: "MCP", href: "/docs/mcp" },
		],
	},
	{
		label: "Deploy",
		items: [
			{ title: "Overview", href: "/docs/deploy" },
			{ title: "Railway", href: "/docs/deploy/railway" },
			{ title: "Render", href: "/docs/deploy/render" },
			{ title: "Fly", href: "/docs/deploy/fly" },
			{ title: "Vercel", href: "/docs/deploy/vercel" },
			{ title: "Docker and EC2", href: "/docs/deploy/docker" },
			{ title: "Run the platform yourself", href: "/docs/self-host" },
		],
	},
	{
		label: "Reference",
		items: [
			{ title: "REST API", href: "/docs/rest-api" },
			{ title: "API reference", href: "/docs/api-reference" },
			{ title: "SDK reference", href: "/docs/sdk-reference" },
			{ title: "Verification", href: "/docs/verification" },
			{ title: "Bitcoin SPV", href: "/docs/bitcoin-spv" },
			{ title: "sBTC settlement", href: "/docs/sbtc-settlement" },
			{ title: "Contract discovery", href: "/docs/contracts" },
			{ title: "Stacks SDK", href: "/docs/stacks" },
			{ title: "PoX-5 staking", href: "/docs/pox5" },
			{ title: "Migrating from Chainhook", href: "/docs/migrate-chainhook" },
			{ title: "x402 (experimental)", href: "/docs/x402" },
			{ title: "Changelog", href: "/docs/changelog" },
		],
	},
];
