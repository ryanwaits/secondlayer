import { sdkPages } from "./sdk-reference/pages";

export interface DocsNavItem {
	title: string;
	href: string;
}
export interface DocsNavGroup {
	label: string;
	items: DocsNavItem[];
}

/**
 * Sidebar information architecture for the docs site: five nouns by altitude,
 * then task guides.
 *
 * - **Start** is onboarding: Introduction, Keys and billing, Self-host
 *   (start it, run it in production, size the hardware, upgrade), and Verify:
 *   one page for everything you can check (a transaction, a block, an
 *   archive, subgraph rows), with the products linking to it instead of
 *   restating it.
 * - **Products** is Archive (signed history) → Streams (raw) → Index
 *   (decoded) → Subgraphs (your schema) → Webhooks (push). Order is
 *   load-bearing; keep it. Protocols (PoX-5, sBTC, Runes) and contract
 *   discovery are sections of Index, not pages or products.
 * - **Tools** is how you drive it: CLI (with its local devnet), SDK (Filters
 *   is a section), Sinks, Deploy your app, and MCP and skills (the generated
 *   tool table plus the agent skill).
 * - **Guides** are task pages, one search question each, with the question as
 *   the H1: a short answer with the one call that does it. Slugs live under
 *   `/docs/guides/`.
 * - **API reference** is the HTTP reference in six pages by job (Index,
 *   Streams, Proofs, Subgraphs, Webhooks, Instance), generated from the
 *   OpenAPI description; the open page lists its endpoints under its row.
 *   Pages are assigned in `api-reference/pages.ts`.
 * - **SDK reference** is the client, one page per surface (`sl.streams`,
 *   `sl.index`, ...) plus helpers and errors, generated from the SDK's own
 *   source. Pages are listed in `sdk-reference/pages.ts`.
 * - **Reference** is lookup: REST API conventions sit with the API index
 *   and the changelog. Library pages for
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
			{ title: "Verify", href: "/docs/verification" },
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
		label: "Guides",
		items: [
			{
				title: "Listen for contract events",
				href: "/docs/guides/listen-for-contract-events",
			},
			{
				title: "FT transfers by address",
				href: "/docs/guides/ft-transfers-by-address",
			},
			{
				title: "Calls to a contract function",
				href: "/docs/guides/contract-function-calls",
			},
			{
				title: "Decode print events",
				href: "/docs/guides/decode-print-events",
			},
			{
				title: "NFT transfers for a collection",
				href: "/docs/guides/nft-transfers-for-collection",
			},
			{
				title: "Index a contract into Postgres",
				href: "/docs/guides/index-contract-into-postgres",
			},
		],
	},
	{
		label: "API reference",
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
		label: "SDK reference",
		items: sdkPages().map(({ title, href }) => ({ title, href })),
	},
	{
		label: "Reference",
		items: [
			{ title: "REST conventions", href: "/docs/rest-api" },
			{ title: "API reference", href: "/docs/api-reference" },
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
 * `group.items` directly: previous/next links, the agent-facing markdown source,
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
