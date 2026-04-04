export interface MarketplaceSubgraph {
	slug: string;
	name: string;
	description: string;
	creator: string;
	creatorHandle: string;
	status: "active" | "syncing";
	tags: string[];
	tables: number;
	queriesWeek: string;
	category: string;
}

export const MARKETPLACE_SUBGRAPHS: MarketplaceSubgraph[] = [
	{
		slug: "velar-dex",
		name: "velar-dex",
		description: "Velar DEX trading data — swaps, liquidity pool changes, and volume by pair across all Velar markets.",
		creator: "James",
		creatorHandle: "jamesbuilds",
		status: "syncing",
		tags: ["defi", "dex"],
		tables: 3,
		queriesWeek: "2.1k",
		category: "DeFi",
	},
	{
		slug: "sbtc-yield-vaults",
		name: "sbtc-yield-vaults",
		description: "sBTC yield vault deposits, withdrawals, and APY snapshots across DeFi protocols integrating sBTC.",
		creator: "StacksDev",
		creatorHandle: "stacksdev",
		status: "active",
		tags: ["defi", "sbtc"],
		tables: 3,
		queriesWeek: "5.2k",
		category: "DeFi",
	},
	{
		slug: "sbtc-transfers",
		name: "sbtc-transfers",
		description: "sBTC peg-in and peg-out tracking — deposit requests, mints, burns, and BTC reserve movements.",
		creator: "StacksDev",
		creatorHandle: "stacksdev",
		status: "active",
		tags: ["defi", "sbtc"],
		tables: 2,
		queriesWeek: "8.4k",
		category: "DeFi",
	},
	{
		slug: "alex-orderbook",
		name: "alex-orderbook",
		description: "ALEX DEX orderbook data — limit orders, fills, and liquidity depth across all trading pairs.",
		creator: "Alex Lab",
		creatorHandle: "alexlab",
		status: "active",
		tags: ["defi", "dex"],
		tables: 5,
		queriesWeek: "4.7k",
		category: "DeFi",
	},
	{
		slug: "stacking-dao-pool",
		name: "stacking-dao-pool",
		description: "StackingDAO liquid stacking pool data — deposits, withdrawals, stSTX supply, and reward distributions.",
		creator: "StackingDAO",
		creatorHandle: "stackingdao",
		status: "active",
		tags: ["stacking", "liquid"],
		tables: 4,
		queriesWeek: "3.8k",
		category: "Stacking",
	},
	{
		slug: "cycle-rewards",
		name: "cycle-rewards",
		description: "Per-cycle stacking reward tracking — BTC rewards by stacker, pool distributions, and APY calculations.",
		creator: "Ryan Waits",
		creatorHandle: "ryanwaits",
		status: "active",
		tags: ["stacking", "rewards"],
		tables: 2,
		queriesWeek: "1.9k",
		category: "Stacking",
	},
];

export const CATEGORIES = ["All", "DeFi", "Stacking", "NFTs", "Identity", "Governance", "Analytics", "Tokens"];
