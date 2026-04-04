import type {
	CreatorProfile,
	MarketplaceSubgraphDetail,
	MarketplaceSubgraphSummary,
} from "./marketplace-types";

// ── Mock usage data (30 days) ────────────────────────────────────────────
function mockDaily(base: number, trend: number): { date: string; count: number }[] {
	const days: { date: string; count: number }[] = [];
	for (let i = 29; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const noise = Math.floor(Math.random() * base * 0.3);
		days.push({
			date: d.toISOString().slice(0, 10),
			count: Math.max(0, Math.floor(base + trend * (30 - i) + noise)),
		});
	}
	return days;
}

// ── Summaries ────────────────────────────────────────────────────────────
export const MOCK_SUBGRAPHS: MarketplaceSubgraphSummary[] = [
	{
		name: "alex-dex-trades",
		description:
			"Historical DEX trade data from Alex Lab — swaps, volumes, and price impact across all trading pairs.",
		tags: ["defi", "dex"],
		creator: { displayName: "Alex Builder", slug: "alexbuilder" },
		status: "active",
		version: "4",
		tables: ["swaps", "volumes_daily", "price_snapshots"],
		totalQueries7d: 12438,
		forkCount: 12,
		progress: 1,
		createdAt: "2025-11-14T00:00:00Z",
	},
	{
		name: "sbtc-transfers",
		description:
			"sBTC peg-in and peg-out tracking — deposit requests, mints, burns, and BTC reserve movements.",
		tags: ["defi", "sbtc"],
		creator: { displayName: "Stacks Dev", slug: "stacksdev" },
		status: "active",
		version: "2",
		tables: ["deposits", "mints", "burns", "reserves"],
		totalQueries7d: 8742,
		forkCount: 5,
		progress: 1,
		createdAt: "2025-12-02T00:00:00Z",
	},
	{
		name: "bns-names",
		description:
			"BNS name registrations, transfers, renewals, and expirations — the complete Bitcoin Name Service index.",
		tags: ["identity", "bns"],
		creator: { displayName: "James Builds", slug: "jamesbuilds" },
		status: "active",
		version: "3",
		tables: ["registrations", "transfers", "renewals"],
		totalQueries7d: 3102,
		forkCount: 2,
		progress: 1,
		createdAt: "2025-10-20T00:00:00Z",
	},
	{
		name: "gamma-nft-sales",
		description:
			"NFT marketplace sales from Gamma — listings, bids, sales, and floor price movements for all collections.",
		tags: ["nfts", "marketplace"],
		creator: { displayName: "NFT Collector", slug: "nftcollector" },
		status: "syncing",
		version: "1",
		tables: ["listings", "bids", "sales", "floor_prices", "collections"],
		totalQueries7d: 1823,
		forkCount: 0,
		progress: 0.72,
		createdAt: "2026-03-18T00:00:00Z",
	},
];

// ── Details ──────────────────────────────────────────────────────────────
const MOCK_DETAILS: Record<string, MarketplaceSubgraphDetail> = {
	"alex-dex-trades": {
		...MOCK_SUBGRAPHS[0],
		startBlock: 100000,
		lastProcessedBlock: 7482103,
		forkedFrom: null,
		sources: { swap: { type: "contract_call", contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-swap-pool-v1-1", functionName: "swap-helper" } },
		tableSchemas: {
			swaps: {
				columns: {
					tx_id: { type: "text" },
					block_height: { type: "int" },
					sender: { type: "principal" },
					token_in: { type: "text" },
					token_out: { type: "text" },
					amount_in: { type: "uint" },
				},
				rowCount: 482319,
				endpoint: "/api/marketplace/subgraphs/alex-dex-trades/swaps",
			},
			volumes_daily: {
				columns: {
					date: { type: "text" },
					pair: { type: "text" },
					volume_usd: { type: "uint" },
					trade_count: { type: "int" },
					avg_price_impact: { type: "uint" },
				},
				rowCount: 1247,
				endpoint: "/api/marketplace/subgraphs/alex-dex-trades/volumes_daily",
			},
			price_snapshots: {
				columns: {
					block_height: { type: "int" },
					pair: { type: "text" },
					price: { type: "uint" },
					timestamp: { type: "timestamp" },
				},
				rowCount: 89412,
				endpoint: "/api/marketplace/subgraphs/alex-dex-trades/price_snapshots",
			},
		},
		usage: {
			totalQueries7d: 12438,
			totalQueries30d: 41207,
			daily: mockDaily(400, 8),
		},
	},
	"sbtc-transfers": {
		...MOCK_SUBGRAPHS[1],
		startBlock: 150000,
		lastProcessedBlock: 7481200,
		forkedFrom: null,
		sources: { transfer: { type: "ft_transfer", assetIdentifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc" } },
		tableSchemas: {
			deposits: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					amount: { type: "uint" },
					btc_txid: { type: "text" },
					status: { type: "text" },
				},
				rowCount: 8421,
				endpoint: "/api/marketplace/subgraphs/sbtc-transfers/deposits",
			},
			mints: {
				columns: {
					tx_id: { type: "text" },
					recipient: { type: "principal" },
					amount: { type: "uint" },
					block_height: { type: "int" },
				},
				rowCount: 7892,
				endpoint: "/api/marketplace/subgraphs/sbtc-transfers/mints",
			},
			burns: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					amount: { type: "uint" },
					btc_address: { type: "text" },
				},
				rowCount: 3201,
				endpoint: "/api/marketplace/subgraphs/sbtc-transfers/burns",
			},
			reserves: {
				columns: {
					block_height: { type: "int" },
					total_supply: { type: "uint" },
					btc_reserve: { type: "uint" },
				},
				rowCount: 45210,
				endpoint: "/api/marketplace/subgraphs/sbtc-transfers/reserves",
			},
		},
		usage: {
			totalQueries7d: 8742,
			totalQueries30d: 29104,
			daily: mockDaily(280, 5),
		},
	},
	"bns-names": {
		...MOCK_SUBGRAPHS[2],
		startBlock: 1,
		lastProcessedBlock: 7480500,
		forkedFrom: null,
		sources: { register: { type: "contract_call", contractId: "SP000000000000000000002Q6VF78.bns", functionName: "name-register" } },
		tableSchemas: {
			registrations: {
				columns: {
					name: { type: "text" },
					namespace: { type: "text" },
					owner: { type: "principal" },
					registered_at: { type: "int" },
					expires_at: { type: "int" },
				},
				rowCount: 124302,
				endpoint: "/api/marketplace/subgraphs/bns-names/registrations",
			},
			transfers: {
				columns: {
					name: { type: "text" },
					from_owner: { type: "principal" },
					to_owner: { type: "principal" },
					block_height: { type: "int" },
				},
				rowCount: 31204,
				endpoint: "/api/marketplace/subgraphs/bns-names/transfers",
			},
			renewals: {
				columns: {
					name: { type: "text" },
					owner: { type: "principal" },
					new_expiry: { type: "int" },
					block_height: { type: "int" },
				},
				rowCount: 8921,
				endpoint: "/api/marketplace/subgraphs/bns-names/renewals",
			},
		},
		usage: {
			totalQueries7d: 3102,
			totalQueries30d: 11840,
			daily: mockDaily(100, 2),
		},
	},
	"gamma-nft-sales": {
		...MOCK_SUBGRAPHS[3],
		startBlock: 80000,
		lastProcessedBlock: 5400000,
		forkedFrom: null,
		sources: { sale: { type: "print_event", contractId: "SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.marketplace-v6" } },
		tableSchemas: {
			listings: {
				columns: {
					nft_id: { type: "text" },
					collection: { type: "text" },
					seller: { type: "principal" },
					price: { type: "uint" },
					listed_at: { type: "int" },
				},
				rowCount: 210402,
				endpoint: "/api/marketplace/subgraphs/gamma-nft-sales/listings",
			},
			bids: {
				columns: {
					nft_id: { type: "text" },
					bidder: { type: "principal" },
					amount: { type: "uint" },
					block_height: { type: "int" },
				},
				rowCount: 89201,
				endpoint: "/api/marketplace/subgraphs/gamma-nft-sales/bids",
			},
			sales: {
				columns: {
					nft_id: { type: "text" },
					seller: { type: "principal" },
					buyer: { type: "principal" },
					price: { type: "uint" },
					block_height: { type: "int" },
				},
				rowCount: 156320,
				endpoint: "/api/marketplace/subgraphs/gamma-nft-sales/sales",
			},
			floor_prices: {
				columns: {
					collection: { type: "text" },
					floor_price: { type: "uint" },
					date: { type: "text" },
				},
				rowCount: 42100,
				endpoint: "/api/marketplace/subgraphs/gamma-nft-sales/floor_prices",
			},
			collections: {
				columns: {
					contract_id: { type: "text" },
					name: { type: "text" },
					total_supply: { type: "int" },
					total_volume: { type: "uint" },
				},
				rowCount: 892,
				endpoint: "/api/marketplace/subgraphs/gamma-nft-sales/collections",
			},
		},
		usage: {
			totalQueries7d: 1823,
			totalQueries30d: 6102,
			daily: mockDaily(60, 3),
		},
	},
};

// ── Creators ─────────────────────────────────────────────────────────────
const MOCK_CREATORS: Record<string, CreatorProfile> = {
	alexbuilder: {
		displayName: "Alex Builder",
		bio: "Building DeFi indexing infrastructure on Stacks. Core contributor to ALEX DEX analytics and open-source subgraph definitions.",
		avatarUrl: null,
		slug: "alexbuilder",
		subgraphs: [MOCK_SUBGRAPHS[0]],
	},
	stacksdev: {
		displayName: "Stacks Dev",
		bio: "Core protocol team member. Building the sBTC bridge indexer and Stacking analytics.",
		avatarUrl: null,
		slug: "stacksdev",
		subgraphs: [MOCK_SUBGRAPHS[1]],
	},
	jamesbuilds: {
		displayName: "James Builds",
		bio: "Identity and naming systems on Bitcoin layers. Maintaining the canonical BNS index.",
		avatarUrl: null,
		slug: "jamesbuilds",
		subgraphs: [MOCK_SUBGRAPHS[2]],
	},
	nftcollector: {
		displayName: "NFT Collector",
		bio: "Indexing Gamma marketplace data for collection analytics and floor price tracking.",
		avatarUrl: null,
		slug: "nftcollector",
		subgraphs: [MOCK_SUBGRAPHS[3]],
	},
};

// ── Lookup helpers ───────────────────────────────────────────────────────

export function getMockBrowse(params: {
	search?: string;
	tags?: string;
	sort?: string;
	limit?: number;
	offset?: number;
}) {
	let results = [...MOCK_SUBGRAPHS];

	if (params.search) {
		const q = params.search.toLowerCase();
		results = results.filter(
			(s) =>
				s.name.includes(q) ||
				s.description?.toLowerCase().includes(q) ||
				s.tags.some((t) => t.includes(q)),
		);
	}

	if (params.tags) {
		const tagList = params.tags.split(",").map((t) => t.trim().toLowerCase());
		results = results.filter((s) =>
			tagList.some((t) => s.tags.includes(t)),
		);
	}

	if (params.sort === "popular") {
		results.sort((a, b) => b.totalQueries7d - a.totalQueries7d);
	} else if (params.sort === "name") {
		results.sort((a, b) => a.name.localeCompare(b.name));
	} else {
		results.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}

	const limit = params.limit ?? 20;
	const offset = params.offset ?? 0;
	const page = results.slice(offset, offset + limit);

	return {
		data: page,
		meta: { total: results.length, limit, offset },
	};
}

export function getMockDetail(name: string): MarketplaceSubgraphDetail | null {
	return MOCK_DETAILS[name] ?? null;
}

export function getMockCreator(slug: string): CreatorProfile | null {
	return MOCK_CREATORS[slug] ?? null;
}
