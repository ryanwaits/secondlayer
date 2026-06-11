/** Wire shapes from GET /v1/subgraphs (public discovery surface). */

export interface ExploreSummary {
	name: string;
	description: string | null;
	status: string;
	visibility: "public" | "private";
	owned: boolean;
	version: string;
	created_at: string;
	/** null for BYO subgraphs (rows live in the user's database). */
	total_rows: number | null;
	sources: string[];
	last_processed_block: number;
	blocks_behind: number;
	tables: string[];
	url: string;
}

export interface ExploreList {
	subgraphs: ExploreSummary[];
	tip: { block_height: number };
}

export interface ExploreTable {
	endpoint: string;
	columns: string[];
	column_types: Record<string, string>;
}

export interface ExploreDetail {
	name: string;
	description: string | null;
	version: string;
	status: string;
	visibility: "public" | "private";
	created_at: string;
	sources: string[];
	start_block: number;
	tables: Record<string, ExploreTable>;
	tip: {
		block_height: number;
		subgraph_height: number;
		blocks_behind: number;
	};
	docs: { openapi: string; schema: string; markdown: string };
}

/** Curated first-party seeds — the only listings attributed "by secondlayer". */
export const FEATURED = [
	"sbtc-flows",
	"pox-stacking",
	"bns-names",
	"sip10-balances",
	// Balance ledgers (G7) — listed once seeded; missing names are filtered.
	"sbtc-balances",
	"usdcx-balances",
	"alex-balances",
];
