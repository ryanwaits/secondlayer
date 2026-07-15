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
		label: "Core surfaces",
		items: [
			{ title: "Index", href: "/docs/index" },
			{ title: "Subgraphs", href: "/docs/subgraphs" },
			{ title: "Subscriptions", href: "/docs/subscriptions" },
			{ title: "Streams", href: "/docs/streams" },
		],
	},
	{
		label: "Reference",
		items: [
			{ title: "Migrating from Chainhook", href: "/docs/migrate-chainhook" },
			{ title: "REST API", href: "/docs/rest-api" },
			{ title: "Verification", href: "/docs/verification" },
			{ title: "Bitcoin SPV", href: "/docs/bitcoin-spv" },
			{ title: "sBTC settlement", href: "/docs/sbtc-settlement" },
			{ title: "Contract discovery", href: "/docs/contracts" },
			{ title: "SDK", href: "/docs/sdk" },
			{ title: "Stacks SDK", href: "/docs/stacks" },
			{ title: "PoX-5 staking", href: "/docs/pox5" },
			{ title: "CLI", href: "/docs/cli" },
			{ title: "MCP", href: "/docs/mcp" },
			{ title: "x402 (experimental)", href: "/docs/x402" },
			{ title: "Self-hosting", href: "/docs/self-host" },
			{ title: "Changelog", href: "/docs/changelog" },
		],
	},
];
