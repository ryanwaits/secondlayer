/**
 * The five products as the docs lay them out, chain to app. The intro stack,
 * each product page's "You get / You write" pair and the seam at the foot of a
 * page all read from here. Order must equal the Products group in `nav.ts`.
 */
export type ProductKey =
	| "archive"
	| "streams"
	| "index"
	| "subgraphs"
	| "webhooks";

export interface DocsProduct {
	key: ProductKey;
	title: string;
	href: string;
	/** Intro stack row. */
	stack: { get: string; write: string };
	/** Product page "You get / You write" pair. */
	get: string;
	write: string;
}

export const DOCS_PRODUCTS: DocsProduct[] = [
	{
		key: "archive",
		title: "Archive",
		href: "/docs/archive",
		stack: {
			get: "Signed history an instance boots from",
			write: "nothing; run bootstrap",
		},
		get: "Signed history from genesis, hashed per partition",
		write: "Nothing. You run commands.",
	},
	{
		key: "streams",
		title: "Streams",
		href: "/docs/streams",
		stack: { get: "Raw signed events, replayable", write: "your own decoder" },
		get: "Raw signed events, replayable, reorgs rewound for you",
		write: "A consume() loop and your own decoder",
	},
	{
		key: "index",
		title: "Index",
		href: "/docs/index",
		stack: {
			get: "Decoded rows, swept into your own tables",
			write: "a consume() loop",
		},
		get: "Decoded rows from genesis, typed per event",
		write: "A consume() loop into your schema",
	},
	{
		key: "subgraphs",
		title: "Subgraphs",
		href: "/docs/subgraphs",
		stack: {
			get: "A table you define, plus a REST API over it",
			write: "one .ts file",
		},
		get: "A table you define, plus a REST API over it",
		write: "One file: sources, schema, handlers",
	},
	{
		key: "webhooks",
		title: "Webhooks",
		href: "/docs/webhooks",
		stack: {
			get: "A signed POST when a chain event happens",
			write: "an endpoint",
		},
		get: "A signed POST per matched chain event",
		write: "An endpoint that checks the signature",
	},
];

/** What the neighbour one layer away offers you, keyed `${from}>${to}`. */
export const SEAM_CELLS: Record<string, { why: string; tease: string }> = {
	"archive>streams": {
		why: "Read the history as a raw, signed stream.",
		tease: 'await sl.streams.events.consume({ types: ["ft_transfer"], … })',
	},
	"streams>archive": {
		why: "Restore or check the history it streams.",
		tease: "secondlayer bootstrap --against <archive>",
	},
	"streams>index": {
		why: "Skip the decoder; rows arrive typed.",
		tease: 'await index.events.consume({ eventType: "ft_transfer", … })',
	},
	"index>streams": {
		why: "Decode it yourself from the signed raw stream.",
		tease: 'await sl.streams.events.consume({ types: ["ft_transfer"], … })',
	},
	"index>subgraphs": {
		why: "Skip the loop and the API; get a table and REST.",
		tease: 'export default defineSubgraph({ name: "pool-reserves", … })',
	},
	"subgraphs>index": {
		why: "Keep your own API shape; write the loop.",
		tease: 'await index.events.consume({ eventType: "ft_transfer", … })',
	},
	"subgraphs>webhooks": {
		why: "Get a POST instead of a table.",
		tease: 'await sl.webhooks.create({ name: "amm-swaps", … })',
	},
	"webhooks>subgraphs": {
		why: "Need history too? Webhooks never backfill. A table does.",
		tease: 'export default defineSubgraph({ name: "pool-reserves", … })',
	},
};

/** The products one layer toward the chain (`down`) and toward your app (`up`). */
export function neighbours(key: ProductKey): {
	down?: DocsProduct;
	up?: DocsProduct;
} {
	const i = DOCS_PRODUCTS.findIndex((p) => p.key === key);
	return { down: DOCS_PRODUCTS[i - 1], up: DOCS_PRODUCTS[i + 1] };
}

export type StartKey = "keys" | "selfhost" | "verify";

export interface StartCell {
	label: string;
	title: string;
	href: string;
	why: string;
	tease: string;
}

export interface StartPage {
	key: StartKey;
	/** Absent when the page opens without a get/write pair (Verify). */
	yields?: { get: string; writeLabel: string; write: string };
	seam: [StartCell, StartCell];
}

/** The three Start pages: their opening pair and the two pages they hand off to. */
export const START_PAGES: StartPage[] = [
	{
		key: "keys",
		yields: {
			get: "1M rows free a month, then $5 per 1M",
			writeLabel: "You set",
			write: "A key, and a spend cap if you want one",
		},
		seam: [
			{
				label: "Next",
				title: "Self-host",
				href: "/docs/self-host",
				why: "The same product on your Postgres, with no meter.",
				tease: "secondlayer init --network mainnet",
			},
			{
				label: "Or",
				title: "Introduction",
				href: "/docs#get-started",
				why: "Get a table live in six commands.",
				tease: "secondlayer subgraphs create my-balances --from-contract …",
			},
		],
	},
	{
		key: "selfhost",
		yields: {
			get: "Every product on your box, no meter",
			writeLabel: "You bring",
			write: "Docker, 4 GB RAM, the CLI; a 600 GB SSD for mainnet history",
		},
		seam: [
			{
				label: "Next",
				title: "Verify",
				href: "/docs/verification",
				why: "Check a block, a transaction or your rows against Bitcoin.",
				tease: "secondlayer verify block 9137005",
			},
			{
				label: "Or",
				title: "Keys and billing",
				href: "/docs/authentication",
				why: "Rather not run a box? Hosted is one key.",
				tease: "export SECONDLAYER_API_KEY=sk-sl_...",
			},
		],
	},
	{
		key: "verify",
		seam: [
			{
				label: "Next",
				title: "Archive",
				href: "/docs/archive",
				why: "Check your whole history against the signed archive.",
				tease: "secondlayer verify raw --against <latest.json>",
			},
			{
				label: "Or",
				title: "Subgraphs",
				href: "/docs/subgraphs",
				why: "Recompute a state subgraph's rows on your machine.",
				tease: "secondlayer verify subgraph pool-reserves --replay",
			},
		],
	},
];
