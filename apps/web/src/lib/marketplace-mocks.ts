import type {
	CreatorProfile,
	MarketplaceSubgraphDetail,
	MarketplaceSubgraphSummary,
} from "./marketplace-types";

// ── Mock usage data (30 days) ────────────────────────────────────────────
function mockDaily(
	base: number,
	trend: number,
): { date: string; count: number }[] {
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
	{
		name: "sbtc-yield-vaults",
		description:
			"sBTC yield vault deposits, withdrawals, and APY snapshots across DeFi protocols integrating sBTC.",
		tags: ["defi", "sbtc"],
		creator: { displayName: "Stacks Dev", slug: "stacksdev" },
		status: "active",
		version: "1",
		tables: ["deposits", "withdrawals", "apy_snapshots"],
		totalQueries7d: 5210,
		forkCount: 3,
		progress: 1,
		createdAt: "2026-01-15T00:00:00Z",
	},
	{
		name: "stackingdao-deposits",
		description:
			"StackingDAO liquid stacking protocol — deposits, stSTX mints, reward distributions, and TVL tracking.",
		tags: ["stacking", "defi"],
		creator: { displayName: "StackingDAO Team", slug: "stackingdao" },
		status: "active",
		version: "3",
		tables: ["deposits", "mints", "rewards", "tvl_daily"],
		totalQueries7d: 7312,
		forkCount: 8,
		progress: 1,
		createdAt: "2025-09-10T00:00:00Z",
	},
	{
		name: "stx-stacking-rewards",
		description:
			"STX stacking cycle rewards, pool participation, and yield history for all stacking methods.",
		tags: ["stacking", "tokens"],
		creator: { displayName: "James Builds", slug: "jamesbuilds" },
		status: "active",
		version: "2",
		tables: ["cycles", "rewards", "pool_members"],
		totalQueries7d: 4102,
		forkCount: 4,
		progress: 1,
		createdAt: "2025-11-01T00:00:00Z",
	},
	{
		name: "dao-proposals",
		description:
			"On-chain DAO proposals, votes, and execution status across Stacks governance contracts.",
		tags: ["governance", "tokens"],
		creator: { displayName: "Alex Builder", slug: "alexbuilder" },
		status: "active",
		version: "2",
		tables: ["proposals", "votes", "executions"],
		totalQueries7d: 2841,
		forkCount: 1,
		progress: 1,
		createdAt: "2026-02-05T00:00:00Z",
	},
	{
		name: "charisma-governance",
		description:
			"Charisma DAO governance activity — proposal lifecycle, voting power snapshots, and treasury movements.",
		tags: ["governance"],
		creator: { displayName: "StackingDAO Team", slug: "stackingdao" },
		status: "active",
		version: "1",
		tables: ["proposals", "votes", "treasury"],
		totalQueries7d: 1205,
		forkCount: 0,
		progress: 1,
		createdAt: "2026-03-01T00:00:00Z",
	},
	{
		name: "stx-token-transfers",
		description:
			"All STX token transfers with sender, recipient, amount, and memo — the canonical transfer index.",
		tags: ["tokens"],
		creator: { displayName: "Stacks Dev", slug: "stacksdev" },
		status: "active",
		version: "5",
		tables: ["transfers", "daily_volume"],
		totalQueries7d: 9430,
		forkCount: 14,
		progress: 1,
		createdAt: "2025-08-20T00:00:00Z",
	},
	{
		name: "whale-tracker",
		description:
			"Large STX and sBTC movements — whale wallet activity, accumulation trends, and exchange flow analysis.",
		tags: ["analytics", "tokens"],
		creator: { displayName: "NFT Collector", slug: "nftcollector" },
		status: "active",
		version: "1",
		tables: ["large_transfers", "wallet_balances", "exchange_flows"],
		totalQueries7d: 3821,
		forkCount: 2,
		progress: 1,
		createdAt: "2026-01-28T00:00:00Z",
	},
	{
		name: "protocol-analytics",
		description:
			"Cross-protocol analytics dashboard data — TVL, active users, transaction counts, and fee revenue by protocol.",
		tags: ["analytics", "defi"],
		creator: { displayName: "Alex Builder", slug: "alexbuilder" },
		status: "active",
		version: "2",
		tables: ["tvl_daily", "active_users", "fees", "protocol_summary"],
		totalQueries7d: 6102,
		forkCount: 7,
		progress: 1,
		createdAt: "2025-12-15T00:00:00Z",
	},
	{
		name: "velar-dex",
		description:
			"Velar DEX trading data — swaps, liquidity pool changes, and volume by pair across all Velar markets.",
		tags: ["defi", "dex"],
		creator: { displayName: "James Builds", slug: "jamesbuilds" },
		status: "syncing",
		version: "1",
		tables: ["swaps", "liquidity_changes", "volume_daily"],
		totalQueries7d: 2103,
		forkCount: 1,
		progress: 0.89,
		createdAt: "2026-03-25T00:00:00Z",
	},
	{
		name: "nft-collection-stats",
		description:
			"Aggregated NFT collection statistics — floor prices, holder distribution, volume trends, and rarity scores.",
		tags: ["nfts", "analytics"],
		creator: { displayName: "NFT Collector", slug: "nftcollector" },
		status: "active",
		version: "2",
		tables: ["collections", "floor_history", "holders", "rarity"],
		totalQueries7d: 2940,
		forkCount: 3,
		progress: 1,
		createdAt: "2026-02-12T00:00:00Z",
	},
];

// ── Details ──────────────────────────────────────────────────────────────
const MOCK_DETAILS: Record<string, MarketplaceSubgraphDetail> = {
	"alex-dex-trades": {
		...MOCK_SUBGRAPHS[0],
		startBlock: 100000,
		lastProcessedBlock: 7482103,
		forkedFrom: null,
		sources: {
			swap: {
				type: "contract_call",
				contractId:
					"SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-swap-pool-v1-1",
				functionName: "swap-helper",
			},
		},
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
		sources: {
			transfer: {
				type: "ft_transfer",
				assetIdentifier:
					"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc",
			},
		},
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
		sources: {
			register: {
				type: "contract_call",
				contractId: "SP000000000000000000002Q6VF78.bns",
				functionName: "name-register",
			},
		},
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
		sources: {
			sale: {
				type: "print_event",
				contractId: "SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.marketplace-v6",
			},
		},
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
	"sbtc-yield-vaults": {
		...MOCK_SUBGRAPHS[4],
		startBlock: 200000,
		lastProcessedBlock: 7481500,
		forkedFrom: null,
		sources: {
			deposit: {
				type: "contract_call",
				contractId: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR.sbtc-yield-v1",
				functionName: "deposit",
			},
		},
		tableSchemas: {
			deposits: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					amount: { type: "uint" },
					vault: { type: "text" },
				},
				rowCount: 3201,
				endpoint: "/api/marketplace/subgraphs/sbtc-yield-vaults/deposits",
			},
			withdrawals: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					amount: { type: "uint" },
					vault: { type: "text" },
				},
				rowCount: 1842,
				endpoint: "/api/marketplace/subgraphs/sbtc-yield-vaults/withdrawals",
			},
			apy_snapshots: {
				columns: {
					vault: { type: "text" },
					apy: { type: "uint" },
					date: { type: "text" },
				},
				rowCount: 920,
				endpoint: "/api/marketplace/subgraphs/sbtc-yield-vaults/apy_snapshots",
			},
		},
		usage: {
			totalQueries7d: 5210,
			totalQueries30d: 18420,
			daily: mockDaily(170, 4),
		},
	},
	"stackingdao-deposits": {
		...MOCK_SUBGRAPHS[5],
		startBlock: 90000,
		lastProcessedBlock: 7482000,
		forkedFrom: null,
		sources: {
			deposit: {
				type: "contract_call",
				contractId:
					"SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.stacking-dao-core-v1",
				functionName: "deposit",
			},
		},
		tableSchemas: {
			deposits: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					stx_amount: { type: "uint" },
					ststx_received: { type: "uint" },
				},
				rowCount: 42100,
				endpoint: "/api/marketplace/subgraphs/stackingdao-deposits/deposits",
			},
			mints: {
				columns: {
					tx_id: { type: "text" },
					recipient: { type: "principal" },
					ststx_amount: { type: "uint" },
					block_height: { type: "int" },
				},
				rowCount: 41800,
				endpoint: "/api/marketplace/subgraphs/stackingdao-deposits/mints",
			},
			rewards: {
				columns: {
					cycle: { type: "int" },
					total_stx: { type: "uint" },
					reward_stx: { type: "uint" },
					apy: { type: "uint" },
				},
				rowCount: 156,
				endpoint: "/api/marketplace/subgraphs/stackingdao-deposits/rewards",
			},
			tvl_daily: {
				columns: {
					date: { type: "text" },
					tvl_stx: { type: "uint" },
					tvl_usd: { type: "uint" },
				},
				rowCount: 580,
				endpoint: "/api/marketplace/subgraphs/stackingdao-deposits/tvl_daily",
			},
		},
		usage: {
			totalQueries7d: 7312,
			totalQueries30d: 24800,
			daily: mockDaily(240, 6),
		},
	},
	"stx-stacking-rewards": {
		...MOCK_SUBGRAPHS[6],
		startBlock: 1,
		lastProcessedBlock: 7481800,
		forkedFrom: null,
		sources: { reward: { type: "event", eventName: "stacking/stack-stx" } },
		tableSchemas: {
			cycles: {
				columns: {
					cycle: { type: "int" },
					total_stacked: { type: "uint" },
					reward_rate: { type: "uint" },
				},
				rowCount: 92,
				endpoint: "/api/marketplace/subgraphs/stx-stacking-rewards/cycles",
			},
			rewards: {
				columns: {
					cycle: { type: "int" },
					stacker: { type: "principal" },
					btc_reward: { type: "uint" },
					stx_locked: { type: "uint" },
				},
				rowCount: 382100,
				endpoint: "/api/marketplace/subgraphs/stx-stacking-rewards/rewards",
			},
			pool_members: {
				columns: {
					pool: { type: "principal" },
					member: { type: "principal" },
					amount: { type: "uint" },
					cycle: { type: "int" },
				},
				rowCount: 128400,
				endpoint:
					"/api/marketplace/subgraphs/stx-stacking-rewards/pool_members",
			},
		},
		usage: {
			totalQueries7d: 4102,
			totalQueries30d: 14200,
			daily: mockDaily(130, 3),
		},
	},
	"dao-proposals": {
		...MOCK_SUBGRAPHS[7],
		startBlock: 120000,
		lastProcessedBlock: 7481900,
		forkedFrom: null,
		sources: {
			propose: {
				type: "contract_call",
				contractId: "SP3JP0N1ZXGASRJ0F7QAHWFPGTVK9T2XNXDB908Z.alex-dao",
				functionName: "propose",
			},
		},
		tableSchemas: {
			proposals: {
				columns: {
					id: { type: "int" },
					title: { type: "text" },
					proposer: { type: "principal" },
					status: { type: "text" },
					created_at: { type: "int" },
				},
				rowCount: 342,
				endpoint: "/api/marketplace/subgraphs/dao-proposals/proposals",
			},
			votes: {
				columns: {
					proposal_id: { type: "int" },
					voter: { type: "principal" },
					amount: { type: "uint" },
					direction: { type: "text" },
				},
				rowCount: 18420,
				endpoint: "/api/marketplace/subgraphs/dao-proposals/votes",
			},
			executions: {
				columns: {
					proposal_id: { type: "int" },
					executor: { type: "principal" },
					block_height: { type: "int" },
				},
				rowCount: 218,
				endpoint: "/api/marketplace/subgraphs/dao-proposals/executions",
			},
		},
		usage: {
			totalQueries7d: 2841,
			totalQueries30d: 9800,
			daily: mockDaily(90, 2),
		},
	},
	"charisma-governance": {
		...MOCK_SUBGRAPHS[8],
		startBlock: 160000,
		lastProcessedBlock: 7481600,
		forkedFrom: null,
		sources: {
			vote: {
				type: "contract_call",
				contractId:
					"SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.charisma-governance",
				functionName: "vote",
			},
		},
		tableSchemas: {
			proposals: {
				columns: {
					id: { type: "int" },
					title: { type: "text" },
					proposer: { type: "principal" },
					status: { type: "text" },
				},
				rowCount: 87,
				endpoint: "/api/marketplace/subgraphs/charisma-governance/proposals",
			},
			votes: {
				columns: {
					proposal_id: { type: "int" },
					voter: { type: "principal" },
					power: { type: "uint" },
				},
				rowCount: 4210,
				endpoint: "/api/marketplace/subgraphs/charisma-governance/votes",
			},
			treasury: {
				columns: {
					tx_id: { type: "text" },
					direction: { type: "text" },
					amount: { type: "uint" },
					token: { type: "text" },
				},
				rowCount: 312,
				endpoint: "/api/marketplace/subgraphs/charisma-governance/treasury",
			},
		},
		usage: {
			totalQueries7d: 1205,
			totalQueries30d: 4100,
			daily: mockDaily(40, 1),
		},
	},
	"stx-token-transfers": {
		...MOCK_SUBGRAPHS[9],
		startBlock: 1,
		lastProcessedBlock: 7482100,
		forkedFrom: null,
		sources: { transfer: { type: "stx_transfer" } },
		tableSchemas: {
			transfers: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					recipient: { type: "principal" },
					amount: { type: "uint" },
					memo: { type: "text" },
				},
				rowCount: 8421000,
				endpoint: "/api/marketplace/subgraphs/stx-token-transfers/transfers",
			},
			daily_volume: {
				columns: {
					date: { type: "text" },
					volume: { type: "uint" },
					tx_count: { type: "int" },
				},
				rowCount: 1820,
				endpoint: "/api/marketplace/subgraphs/stx-token-transfers/daily_volume",
			},
		},
		usage: {
			totalQueries7d: 9430,
			totalQueries30d: 32100,
			daily: mockDaily(310, 7),
		},
	},
	"whale-tracker": {
		...MOCK_SUBGRAPHS[10],
		startBlock: 50000,
		lastProcessedBlock: 7481700,
		forkedFrom: null,
		sources: { transfer: { type: "stx_transfer" } },
		tableSchemas: {
			large_transfers: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					recipient: { type: "principal" },
					amount: { type: "uint" },
					usd_value: { type: "uint" },
				},
				rowCount: 42100,
				endpoint: "/api/marketplace/subgraphs/whale-tracker/large_transfers",
			},
			wallet_balances: {
				columns: {
					address: { type: "principal" },
					stx_balance: { type: "uint" },
					sbtc_balance: { type: "uint" },
					snapshot_date: { type: "text" },
				},
				rowCount: 15200,
				endpoint: "/api/marketplace/subgraphs/whale-tracker/wallet_balances",
			},
			exchange_flows: {
				columns: {
					date: { type: "text" },
					exchange: { type: "text" },
					inflow: { type: "uint" },
					outflow: { type: "uint" },
				},
				rowCount: 3640,
				endpoint: "/api/marketplace/subgraphs/whale-tracker/exchange_flows",
			},
		},
		usage: {
			totalQueries7d: 3821,
			totalQueries30d: 13200,
			daily: mockDaily(120, 3),
		},
	},
	"protocol-analytics": {
		...MOCK_SUBGRAPHS[11],
		startBlock: 100000,
		lastProcessedBlock: 7482050,
		forkedFrom: null,
		sources: { aggregate: { type: "block_handler" } },
		tableSchemas: {
			tvl_daily: {
				columns: {
					protocol: { type: "text" },
					date: { type: "text" },
					tvl_usd: { type: "uint" },
				},
				rowCount: 8400,
				endpoint: "/api/marketplace/subgraphs/protocol-analytics/tvl_daily",
			},
			active_users: {
				columns: {
					protocol: { type: "text" },
					date: { type: "text" },
					unique_users: { type: "int" },
				},
				rowCount: 8400,
				endpoint: "/api/marketplace/subgraphs/protocol-analytics/active_users",
			},
			fees: {
				columns: {
					protocol: { type: "text" },
					date: { type: "text" },
					fee_usd: { type: "uint" },
				},
				rowCount: 8400,
				endpoint: "/api/marketplace/subgraphs/protocol-analytics/fees",
			},
			protocol_summary: {
				columns: {
					protocol: { type: "text" },
					tvl_usd: { type: "uint" },
					users_7d: { type: "int" },
					fees_7d: { type: "uint" },
				},
				rowCount: 24,
				endpoint:
					"/api/marketplace/subgraphs/protocol-analytics/protocol_summary",
			},
		},
		usage: {
			totalQueries7d: 6102,
			totalQueries30d: 21400,
			daily: mockDaily(200, 5),
		},
	},
	"velar-dex": {
		...MOCK_SUBGRAPHS[12],
		startBlock: 180000,
		lastProcessedBlock: 6800000,
		forkedFrom: { id: "alex-dex-trades", name: "alex-dex-trades" },
		sources: {
			swap: {
				type: "contract_call",
				contractId: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.velar-swap-v1",
				functionName: "swap",
			},
		},
		tableSchemas: {
			swaps: {
				columns: {
					tx_id: { type: "text" },
					sender: { type: "principal" },
					token_in: { type: "text" },
					token_out: { type: "text" },
					amount_in: { type: "uint" },
				},
				rowCount: 89200,
				endpoint: "/api/marketplace/subgraphs/velar-dex/swaps",
			},
			liquidity_changes: {
				columns: {
					tx_id: { type: "text" },
					provider: { type: "principal" },
					pool: { type: "text" },
					amount: { type: "uint" },
					direction: { type: "text" },
				},
				rowCount: 12400,
				endpoint: "/api/marketplace/subgraphs/velar-dex/liquidity_changes",
			},
			volume_daily: {
				columns: {
					date: { type: "text" },
					pair: { type: "text" },
					volume_usd: { type: "uint" },
				},
				rowCount: 1240,
				endpoint: "/api/marketplace/subgraphs/velar-dex/volume_daily",
			},
		},
		usage: {
			totalQueries7d: 2103,
			totalQueries30d: 7200,
			daily: mockDaily(70, 2),
		},
	},
	"nft-collection-stats": {
		...MOCK_SUBGRAPHS[13],
		startBlock: 80000,
		lastProcessedBlock: 7481900,
		forkedFrom: null,
		sources: {
			sale: {
				type: "print_event",
				contractId: "SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.marketplace-v6",
			},
		},
		tableSchemas: {
			collections: {
				columns: {
					contract_id: { type: "text" },
					name: { type: "text" },
					total_supply: { type: "int" },
					total_volume: { type: "uint" },
				},
				rowCount: 892,
				endpoint: "/api/marketplace/subgraphs/nft-collection-stats/collections",
			},
			floor_history: {
				columns: {
					collection: { type: "text" },
					date: { type: "text" },
					floor_price: { type: "uint" },
				},
				rowCount: 26800,
				endpoint:
					"/api/marketplace/subgraphs/nft-collection-stats/floor_history",
			},
			holders: {
				columns: {
					collection: { type: "text" },
					holder: { type: "principal" },
					count: { type: "int" },
				},
				rowCount: 142000,
				endpoint: "/api/marketplace/subgraphs/nft-collection-stats/holders",
			},
			rarity: {
				columns: {
					collection: { type: "text" },
					nft_id: { type: "text" },
					rarity_score: { type: "uint" },
					rank: { type: "int" },
				},
				rowCount: 89200,
				endpoint: "/api/marketplace/subgraphs/nft-collection-stats/rarity",
			},
		},
		usage: {
			totalQueries7d: 2940,
			totalQueries30d: 10200,
			daily: mockDaily(95, 2),
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
		subgraphs: [MOCK_SUBGRAPHS[0], MOCK_SUBGRAPHS[7], MOCK_SUBGRAPHS[11]],
	},
	stacksdev: {
		displayName: "Stacks Dev",
		bio: "Core protocol team member. Building the sBTC bridge indexer and Stacking analytics.",
		avatarUrl: null,
		slug: "stacksdev",
		subgraphs: [MOCK_SUBGRAPHS[1], MOCK_SUBGRAPHS[4], MOCK_SUBGRAPHS[9]],
	},
	jamesbuilds: {
		displayName: "James Builds",
		bio: "Identity and naming systems on Bitcoin layers. Maintaining the canonical BNS index.",
		avatarUrl: null,
		slug: "jamesbuilds",
		subgraphs: [MOCK_SUBGRAPHS[2], MOCK_SUBGRAPHS[6], MOCK_SUBGRAPHS[12]],
	},
	nftcollector: {
		displayName: "NFT Collector",
		bio: "Indexing Gamma marketplace data for collection analytics and floor price tracking.",
		avatarUrl: null,
		slug: "nftcollector",
		subgraphs: [MOCK_SUBGRAPHS[3], MOCK_SUBGRAPHS[10], MOCK_SUBGRAPHS[13]],
	},
	stackingdao: {
		displayName: "StackingDAO Team",
		bio: "Building liquid stacking infrastructure for Stacks. Core team behind the stSTX protocol and DAO governance tooling.",
		avatarUrl: null,
		slug: "stackingdao",
		subgraphs: [MOCK_SUBGRAPHS[5], MOCK_SUBGRAPHS[9]],
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
		results = results.filter((s) => tagList.some((t) => s.tags.includes(t)));
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
