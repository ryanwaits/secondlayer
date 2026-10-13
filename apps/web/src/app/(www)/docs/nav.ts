export interface DocsNavItem {
	title: string;
	href: string;
}
export interface DocsNavGroup {
	label: string;
	items: DocsNavItem[];
}

/**
 * Sidebar information architecture for the docs site: five nouns by altitude.
 *
 * - **Start** is onboarding: Introduction, Keys and billing, and Self-host
 *   (start it, run it in production, size the hardware, upgrade).
 * - **Products** is Archive (signed history) → Streams (raw) → Index
 *   (decoded) → Subgraphs (your schema) → Webhooks (push). Order is
 *   load-bearing; keep it. Protocols (PoX-5, sBTC, Runes) and contract
 *   discovery are sections of Index, not pages or products.
 * - **Verify** is cross-cutting, not a product noun: one page for everything
 *   you can check (a transaction, a block, an archive, subgraph rows), with
 *   the products linking to it instead of restating it.
 * - **Tools** is how you drive it: CLI (with its local devnet), SDK (Filters
 *   is a section), Sinks, Deploy your app, and MCP and skills (the generated
 *   tool table plus the agent skill).
 * - **API** is the HTTP reference in six pages by job (Index, Streams,
 *   Proofs, Subgraphs, Webhooks, Instance), generated from the OpenAPI
 *   description; each endpoint opens in a drawer. Pages are assigned in
 *   `api-reference/pages.ts`.
 * - **Reference** is lookup: REST API conventions sit with the API index,
 *   the SDK reference and the changelog. Library pages for
 *   `@secondlayer/stacks` live at stacks.secondlayer.tools.
 *
 * Pages only: no page has child pages. A new topic is a top-level row or a
 * section of an existing page, and the open page lists its own sections in
 * the sidebar.
 */
export const DOCS_NAV: DocsNavGroup[] = [
	{
		label: "Start",
		items: [
			{ title: "Introduction", href: "/docs" },
			{ title: "Keys and billing", href: "/docs/authentication" },
			{ title: "Self-host", href: "/docs/self-host" },
		],
	},
	{
		label: "Products",
		items: [
			{ title: "Archive", href: "/docs/archive" },
			{ title: "Streams", href: "/docs/streams" },
			{ title: "Index", href: "/docs/index" },
			{ title: "Subgraphs", href: "/docs/subgraphs" },
			{ title: "Webhooks", href: "/docs/webhooks" },
		],
	},
	{
		label: "Verify",
		items: [{ title: "Verify", href: "/docs/verification" }],
	},
	{
		label: "Tools",
		items: [
			{ title: "CLI", href: "/docs/cli" },
			{ title: "SDK", href: "/docs/sdk" },
			{ title: "Sinks", href: "/docs/sinks" },
			{ title: "Deploy your app", href: "/docs/deploy" },
			{ title: "MCP and skills", href: "/docs/mcp" },
		],
	},
	{
		label: "API",
		items: [
			{ title: "Index API", href: "/docs/api/index" },
			{ title: "Streams API", href: "/docs/api/streams" },
			{ title: "Proofs API", href: "/docs/api/proofs" },
			{ title: "Subgraphs API", href: "/docs/api/subgraphs" },
			{ title: "Webhooks API", href: "/docs/api/webhooks" },
			{ title: "Instance API", href: "/docs/api/instance" },
		],
	},
	{
		label: "Reference",
		items: [
			{ title: "REST conventions", href: "/docs/rest-api" },
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
 * Every docs page in sidebar order.
 *
 * Anything that answers "what pages exist" reads this rather than walking
 * `group.items` directly: the breadcrumb, the agent-facing markdown source,
 * and the command palette all do.
 */
export function docsNavPages(): DocsNavPage[] {
	return DOCS_NAV.flatMap((group) =>
		group.items.map((item) => ({
			href: item.href,
			title: item.title,
			group: group.label,
		})),
	);
}
