/**
 * Registry of known mainnet venues that hold or route sBTC — the protocols sBTC
 * flows *into* once it is minted (lending vaults, DEX pools, LST trackers).
 *
 * This is the lookup that turns a raw `sbtc_token_events` recipient/sender
 * principal into a named destination ("Granite", "Bitflow", …), powering the
 * sBTC Peg Explorer's "where does sBTC go" view and large-flow alerts.
 *
 * Provenance — every contract id here was discovered empirically from our own
 * index (top `sbtc-token` ft_transfer counterparties by volume), NOT guessed.
 * The contract names are self-identifying (`bitflow-sbtc-swap-router`,
 * `hermetica-interface-hbtc-v1`, Granite's `v0-vault-sbtc`). When adding a
 * venue, verify the principal appears in `/v1/index/ft-transfers?contract_id=
 * <sbtc-token>` before labeling it — a wrong tag silently mislabels the feed.
 */

/** What a venue does with the sBTC it receives. Drives grouping + copy. */
export type SbtcVenueCategory =
	| "lending" // BTC-collateralized lending / borrowing
	| "dex" // swap pools / AMMs / routers
	| "lst" // liquid-stacking / yield-bearing wrappers
	| "vault" // yield vaults / structured products
	| "bridge"; // cross-chain / wrapped-BTC bridges

/** One contract that belongs to a venue, with the role it plays. */
export type SbtcVenueContract = {
	/** Fully-qualified `address.name` mainnet contract id. */
	contractId: string;
	/** Human role within the venue (e.g. "collateral vault", "STX/sBTC pool"). */
	role: string;
};

export type SbtcVenue = {
	/** Stable kebab-case key used in the API + UI. */
	slug: string;
	/** Display name. */
	label: string;
	category: SbtcVenueCategory;
	/** Marketing/site URL for the protocol (deep-link from the explorer). */
	url?: string;
	/** Contracts that send/receive sBTC on this venue's behalf. */
	contracts: SbtcVenueContract[];
};

/**
 * High-confidence venues, seeded from index discovery (recent ~2,400 sBTC
 * transfers, 2026-06-18 window). Deliberately conservative: only contracts whose
 * name or deployer prefix unambiguously identifies the protocol are labeled here.
 * High-volume but ambiguous principals (e.g. standalone `liquidator`, faktory
 * pools) are intentionally left unlabeled so the explorer shows them as
 * "unidentified" rather than mis-attributing them.
 */
export const SBTC_VENUES: readonly SbtcVenue[] = [
	{
		slug: "granite",
		label: "Granite",
		category: "lending",
		url: "https://granite.world",
		contracts: [
			{
				contractId: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc",
				role: "sBTC collateral vault",
			},
			{
				contractId: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market",
				role: "lending market",
			},
			{
				contractId: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.fll-v2",
				role: "liquidation",
			},
		],
	},
	{
		slug: "bitflow",
		label: "Bitflow",
		category: "dex",
		url: "https://www.bitflow.finance",
		contracts: [
			{
				contractId:
					"SP2CMK69QNY60HBG8BJ4X5TD7XX2ZT4XB62V13SV.bitflow-sbtc-swap-router",
				role: "sBTC swap router",
			},
			{
				contractId:
					"SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-1-bps-15",
				role: "STX/sBTC DLMM pool",
			},
			{
				contractId:
					"SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10",
				role: "sBTC/USDCx DLMM pool",
			},
			{
				contractId:
					"SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-1",
				role: "sBTC/USDCx DLMM pool",
			},
			{
				contractId:
					"SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1",
				role: "sBTC/STX XYK pool",
			},
			{
				contractId:
					"SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-sbtc-pbtc-v-1-1",
				role: "sBTC/pBTC stableswap pool",
			},
		],
	},
	{
		slug: "hermetica",
		label: "Hermetica",
		category: "vault",
		url: "https://www.hermetica.fi",
		contracts: [
			{
				contractId: "SP1S1HSFH0SQQGWKB69EYFNY0B1MHRMGXR3J1FH4D.vault-hbtc-v1-2",
				role: "hBTC Bitcoin Vault",
			},
			{
				contractId: "SP1S1HSFH0SQQGWKB69EYFNY0B1MHRMGXR3J1FH4D.reserve-hbtc-v1",
				role: "hBTC reserve",
			},
			{
				contractId:
					"SP1S1HSFH0SQQGWKB69EYFNY0B1MHRMGXR3J1FH4D.hermetica-interface-hbtc-v1",
				role: "hBTC interface",
			},
		],
	},
	{
		slug: "stackingdao",
		label: "StackingDAO",
		category: "lst",
		url: "https://www.stackingdao.com",
		contracts: [
			{
				contractId:
					"SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-tracking-v2",
				role: "ststxbtc tracking",
			},
		],
	},
] as const;

/** Lowercased `contractId` → venue, built once for O(1) tagging. */
const VENUE_BY_CONTRACT: ReadonlyMap<string, SbtcVenue> = new Map(
	SBTC_VENUES.flatMap((v) =>
		v.contracts.map((c) => [c.contractId.toLowerCase(), v] as const),
	),
);

/** Resolve a principal to its venue, or `undefined` if it isn't a known venue. */
export function sbtcVenueForPrincipal(
	principal: string | null | undefined,
): SbtcVenue | undefined {
	if (!principal) return undefined;
	return VENUE_BY_CONTRACT.get(principal.toLowerCase());
}

/** All labeled venue contract ids (for SQL `IN (...)` pushdowns / alerts). */
export const SBTC_VENUE_CONTRACT_IDS: readonly string[] = SBTC_VENUES.flatMap(
	(v) => v.contracts.map((c) => c.contractId),
);
