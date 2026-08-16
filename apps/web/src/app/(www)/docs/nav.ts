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
			{
				title: "Subgraphs",
				href: "/docs/subgraphs",
				items: [
					{ title: "Writing handlers", href: "/docs/subgraphs/handlers" },
					{ title: "Reading rows", href: "/docs/subgraphs/reading" },
				],
			},
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
			{ title: "Console", href: "/docs/console" },
		],
	},
	{
		label: "Operate",
		items: [
			{ title: "Verified archive", href: "/docs/archive" },
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
