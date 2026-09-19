export interface DocsNavItem {
	title: string;
	href: string;
	/**
	 * Sub-pages of this one. One level only — a third would mean the parent is
	 * really a group. The sidebar reveals these when the reader is somewhere
	 * under the parent's href; everywhere else they stay collapsed, so a page
	 * with sub-pages costs one row like any other.
	 *
	 * Children are NOT a second way to file a page. Use them when one page grew
	 * past the terseness budget and split along a reader task, so the parts only
	 * make sense under their parent (Subgraphs → writing handlers, reading rows).
	 * A topic that stands on its own gets a top-level entry.
	 */
	items?: DocsNavItem[];
}
export interface DocsNavGroup {
	label: string;
	items: DocsNavItem[];
}

/**
 * Sidebar information architecture for the docs site.
 *
 * - **Products** is the five nouns by altitude: Archive (signed history) →
 *   Streams (raw) → Index (decoded) → Subgraphs (your schema) → Webhooks
 *   (push). Order is load-bearing; keep it.
 * - **Channels** are how you reach them (REST, CLI, SDK, MCP). SDK
 *   concepts (Sinks, Filters) sit with the SDK rather than competing with
 *   the nouns in Products.
 * - **Boot-contract pages** (PoX-5, sBTC) hang under Index. They are
 *   the decoded primitive on contracts everyone shares, not extra products
 *   and not a catalog. New protocols belong in the operator's consume()
 *   loop or a subgraph. Contract discovery + Chainhook stay in Chain data.
 * - **Start / Operate / Reference** are onboarding, ops, and lookup.
 *   Library pages for `@secondlayer/stacks` live at stacks.secondlayer.tools.
 */
export const DOCS_NAV: DocsNavGroup[] = [
	{
		label: "Start",
		items: [
			{ title: "Introduction", href: "/docs" },
			{
				title: "Run Secondlayer",
				href: "/docs/self-host",
				items: [{ title: "Upgrade", href: "/docs/self-host/upgrade" }],
			},
			{ title: "Quickstart", href: "/docs/quickstart" },
			{ title: "Instance token and account key", href: "/docs/authentication" },
		],
	},
	{
		label: "Products",
		items: [
			{ title: "Archive", href: "/docs/archive" },
			{ title: "Streams", href: "/docs/streams" },
			{
				title: "Index",
				href: "/docs/index",
				items: [
					{ title: "PoX-5 events", href: "/docs/pox5-events" },
					{ title: "sBTC settlement", href: "/docs/sbtc-settlement" },
				],
			},
			{
				title: "Subgraphs",
				href: "/docs/subgraphs",
				items: [
					{ title: "Writing handlers", href: "/docs/subgraphs/handlers" },
					{ title: "Reading rows", href: "/docs/subgraphs/reading" },
				],
			},
			{
				title: "Webhooks",
				href: "/docs/webhooks",
				items: [
					{
						title: "Receiving deliveries",
						href: "/docs/webhooks/deliveries",
					},
					{ title: "Event shapes", href: "/docs/webhooks/event-shapes" },
				],
			},
		],
	},
	{
		label: "Channels",
		items: [
			{ title: "REST API", href: "/docs/rest-api" },
			{ title: "CLI", href: "/docs/cli" },
			{
				title: "SDK",
				href: "/docs/sdk",
				items: [
					{ title: "Sinks", href: "/docs/sinks" },
					{ title: "Write your own sink", href: "/docs/sinks/custom" },
					{ title: "Filters", href: "/docs/filters" },
				],
			},
			{ title: "MCP", href: "/docs/mcp" },
		],
	},
	{
		label: "Chain data",
		items: [
			{ title: "Contract discovery", href: "/docs/contracts" },
			{ title: "Migrating from Chainhook", href: "/docs/migrate-chainhook" },
		],
	},
	{
		label: "Operate",
		items: [
			{ title: "Verification", href: "/docs/verification" },
			{
				title: "Deploy your app",
				href: "/docs/deploy",
				items: [{ title: "Docker and EC2", href: "/docs/deploy/docker" }],
			},
			{ title: "Devnet", href: "/docs/devnet" },
		],
	},
	{
		label: "Reference",
		items: [
			{ title: "API reference", href: "/docs/api-reference" },
			{ title: "SDK reference", href: "/docs/sdk-reference" },
			{ title: "Changelog", href: "/docs/changelog" },
		],
	},
];

export interface DocsNavPage {
	href: string;
	title: string;
	group: string;
}

/**
 * Every docs page in sidebar order, sub-pages flattened in after their parent.
 *
 * Anything that answers "what pages exist" reads this rather than walking
 * `group.items` directly — the breadcrumb, the agent-facing markdown source,
 * and the command palette all did, and each one silently omitted sub-pages the
 * day nesting arrived. A missing page there is invisible, not broken, which is
 * the kind of bug nobody reports.
 */
export function docsNavPages(): DocsNavPage[] {
	const pages: DocsNavPage[] = [];
	for (const group of DOCS_NAV) {
		for (const item of group.items) {
			pages.push({ href: item.href, title: item.title, group: group.label });
			for (const child of item.items ?? []) {
				pages.push({
					href: child.href,
					title: child.title,
					group: group.label,
				});
			}
		}
	}
	return pages;
}
