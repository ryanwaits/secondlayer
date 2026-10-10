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
 * Sidebar information architecture for the docs site: five nouns by altitude.
 *
 * - **Start** is onboarding: Introduction, Keys and billing, and Self-host, a
 *   short start page with Run in production and Hardware as children.
 * - **Products** is Archive (signed history) → Streams (raw) → Index
 *   (decoded) → Subgraphs (your schema) → Webhooks (push). Order is
 *   load-bearing; keep it. Protocols (PoX-5, sBTC, Runes) and contract
 *   discovery are sections of Index, not pages or products.
 * - **Verify** is cross-cutting, not a product noun: one page for everything
 *   you can check (a transaction, a block, an archive, subgraph rows), with
 *   the products linking to it instead of restating it.
 * - **Tools** is how you drive it: CLI (Devnet is its local-dev child), SDK
 *   (Sinks and Deploy your app are its children, Filters is a section), and
 *   MCP and skills (the generated tool table plus the agent skill).
 * - **Reference** is lookup: REST API conventions sit with the generated API
 *   and SDK references and the changelog. Library pages for
 *   `@secondlayer/stacks` live at stacks.secondlayer.tools.
 *
 * Children only past the terseness budget, split along a reader task so the
 * parts only make sense under their parent. A topic that stands alone gets a
 * top-level entry.
 */
export const DOCS_NAV: DocsNavGroup[] = [
	{
		label: "Start",
		items: [
			{ title: "Introduction", href: "/docs" },
			{ title: "Keys and billing", href: "/docs/authentication" },
			{
				title: "Self-host",
				href: "/docs/self-host",
				items: [
					{ title: "Run in production", href: "/docs/self-host/production" },
					{ title: "Hardware", href: "/docs/self-host/hardware" },
				],
			},
		],
	},
	{
		label: "Products",
		items: [
			{ title: "Archive", href: "/docs/archive" },
			{ title: "Streams", href: "/docs/streams" },
			{ title: "Index", href: "/docs/index" },
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
					{
						title: "Migrating from Chainhook",
						href: "/docs/migrate-chainhook",
					},
				],
			},
		],
	},
	{
		label: "Verify",
		items: [{ title: "Verify", href: "/docs/verification" }],
	},
	{
		label: "Tools",
		items: [
			{
				title: "CLI",
				href: "/docs/cli",
				items: [{ title: "Devnet", href: "/docs/devnet" }],
			},
			{
				title: "SDK",
				href: "/docs/sdk",
				items: [
					{ title: "Sinks", href: "/docs/sinks" },
					{ title: "Deploy your app", href: "/docs/deploy" },
				],
			},
			{ title: "MCP and skills", href: "/docs/mcp" },
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
