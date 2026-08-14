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
			{ title: "Run Secondlayer", href: "/docs/self-host" },
			{ title: "Quickstart", href: "/docs/quickstart" },
			{ title: "Devnet", href: "/docs/devnet" },
			{ title: "Instance token & credits", href: "/docs/authentication" },
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
		label: "Archive",
		items: [
			{ title: "Verified archive", href: "/docs/archive" },
			{ title: "Verification", href: "/docs/verification" },
		],
	},
	{
		label: "Deploy",
		items: [
			{ title: "Deploy your app", href: "/docs/deploy" },
			{ title: "Docker and EC2", href: "/docs/deploy/docker" },
		],
	},
	{
		label: "Reference",
		items: [
			{ title: "REST API", href: "/docs/rest-api" },
			{ title: "API reference", href: "/docs/api-reference" },
			{ title: "SDK reference", href: "/docs/sdk-reference" },
			{ title: "Changelog", href: "/docs/changelog" },
		],
	},
	{
		label: "Chain",
		items: [
			{ title: "Bitcoin SPV", href: "/docs/bitcoin-spv" },
			{ title: "sBTC settlement", href: "/docs/sbtc-settlement" },
			{ title: "PoX-5 staking", href: "/docs/pox5" },
			{ title: "Contract discovery", href: "/docs/contracts" },
			{ title: "Stacks SDK", href: "/docs/stacks" },
			{ title: "Migrating from Chainhook", href: "/docs/migrate-chainhook" },
		],
	},
];
