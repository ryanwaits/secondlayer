export interface DocsNavItem {
	title: string;
	href: string;
}
export interface DocsNavGroup {
	label: string;
	items: DocsNavItem[];
}

/**
 * Sidebar information architecture for the docs site.
 *
 * Ordered by what a reader does, not by what we built:
 *
 * - **Start** gets them running. Devnet used to sit here in slot 4, ahead of
 *   the instance token — it's a local-development concern, so it moved to
 *   Operate.
 * - **Build** is the three surfaces in fork order (keep your own API → take the
 *   generated one → decode it yourself), with Subscriptions last because it's a
 *   delivery mode over the first two, never a fourth peer.
 * - **Tools** are the ways you reach those surfaces. SDK concepts (Sinks,
 *   Filters) sit with the SDK rather than competing with the surfaces in Build.
 * - **Operate / Reference / Chain** are lookup, not learning.
 */
export const DOCS_NAV: DocsNavGroup[] = [
	{
		label: "Start",
		items: [
			{ title: "Introduction", href: "/docs" },
			{ title: "Run Secondlayer", href: "/docs/self-host" },
			{ title: "Quickstart", href: "/docs/quickstart" },
			{ title: "Instance token & credits", href: "/docs/authentication" },
		],
	},
	{
		label: "Build",
		items: [
			{ title: "Index", href: "/docs/index" },
			{ title: "Subgraphs", href: "/docs/subgraphs" },
			{ title: "Streams", href: "/docs/streams" },
			{ title: "Subscriptions", href: "/docs/subscriptions" },
		],
	},
	{
		label: "Tools",
		items: [
			{ title: "SDK", href: "/docs/sdk" },
			{ title: "Sinks", href: "/docs/sinks" },
			{ title: "Filters", href: "/docs/filters" },
			{ title: "CLI", href: "/docs/cli" },
			{ title: "MCP", href: "/docs/mcp" },
		],
	},
	{
		label: "Operate",
		items: [
			{ title: "Verified archive", href: "/docs/archive" },
			{ title: "Verification", href: "/docs/verification" },
			{ title: "Deploy your app", href: "/docs/deploy" },
			{ title: "Docker and EC2", href: "/docs/deploy/docker" },
			{ title: "Devnet", href: "/docs/devnet" },
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
