/**
 * Resource guardrails — preflight RAM/disk/Postgres and estimate growth.
 * Constrained fixtures fail early.
 *
 * The disk numbers here were wrong by 3-6x until 2026-08-15: they promised a
 * full-history mainnet index would fit in 80 GB, and estimated growth at 1 GB
 * per 100k blocks. The reference index measured 504 GB at height 8,771,873.
 * An operator who sized a box from these figures would have filled the disk
 * partway through their first bootstrap, so every constant below now cites what
 * it was measured against.
 */

export type ResourceSnapshot = {
	ramMb: number;
	diskGb: number;
	postgresMaxConnections: number;
	postgresSharedBuffersMb?: number;
};

export type DiskEstimates = {
	/** blocks + transactions + events, no decoded plane. */
	diskGbPer100kBlocks: number;
	/** Same, plus a broad decoder set writing `decoded_events`. */
	diskGbPer100kBlocksDecoded: number;
};

export type GuardrailResult =
	| { ok: true; estimates: DiskEstimates }
	| { ok: false; errors: string[] };

export type GuardrailNetwork = "mainnet" | "testnet" | "devnet";

/**
 * Measured on the mainnet reference index at height 8,771,873 (2026-08-15):
 * `blocks` 3.5 GB + `transactions` 55 GB + `events` 189 GB = 247 GB of core
 * datasets, and 504 GB total with a broad decoder set (`decoded_events` alone
 * is 253 GB).
 *
 * These are averages over all history, and history is not uniform — early
 * heights are far sparser than recent ones, so a forward-looking operator
 * should treat them as a lower bound on future growth rather than a constant.
 */
const MEASURED_DISK: DiskEstimates = {
	diskGbPer100kBlocks: 3,
	diskGbPer100kBlocksDecoded: 6,
};

export const FLOORS = {
	appRamMb: 4096,
	fullRamMb: 98304,
	/**
	 * Mainnet full history: 504 GB measured today, growing ~0.5 GB/day at the
	 * observed block rate. 600 leaves roughly six months of headroom, which is
	 * the point of a floor — a box that fits exactly today fails within weeks.
	 */
	mainnetAppDiskGb: 600,
	/**
	 * Testnet/devnet carry a fraction of mainnet's history. Unmeasured; retained
	 * as the long-standing default rather than replaced with a fresh guess.
	 */
	appDiskGb: 80,
	/**
	 * Bundled node on mainnet. The Stacks chainstate alone measured 1.3 TB on
	 * the reference node (2026-08-15), and the index adds ~500 GB; bitcoind is
	 * additional and not measured here. The previous 1.5 TB floor was below the
	 * two components we HAVE measured.
	 */
	mainnetFullDiskGb: 2500,
	/** Bundled node, non-mainnet. Unmeasured; retained default. */
	fullDiskGb: 1500,
	postgresMaxConnections: 50,
} as const;

/** The disk floor that applies to a given mode and network. */
export function diskFloorGb(
	mode: "external" | "stacks" | "full",
	network: GuardrailNetwork,
): number {
	if (mode === "full") {
		return network === "mainnet" ? FLOORS.mainnetFullDiskGb : FLOORS.fullDiskGb;
	}
	return network === "mainnet" ? FLOORS.mainnetAppDiskGb : FLOORS.appDiskGb;
}

/**
 * A dimension the caller could not measure is absent, not zero. Skipping it
 * keeps an unreadable `statfs` from presenting as a 0 GB disk and refusing a
 * perfectly adequate box.
 */
export function preflightResources(
	snap: Partial<ResourceSnapshot>,
	mode: "external" | "stacks" | "full",
	// Defaults to the strictest network: an unspecified caller should be told it
	// needs more disk than it does, never less.
	network: GuardrailNetwork = "mainnet",
): GuardrailResult {
	const errors: string[] = [];
	const ramFloor = mode === "full" ? FLOORS.fullRamMb : FLOORS.appRamMb;
	const diskFloor = diskFloorGb(mode, network);
	if (snap.ramMb !== undefined && snap.ramMb < ramFloor) {
		errors.push(
			`RAM ${snap.ramMb}MB below ${ramFloor}MB for NODE_MODE=${mode}`,
		);
	}
	if (snap.diskGb !== undefined && snap.diskGb < diskFloor) {
		errors.push(
			`disk ${snap.diskGb}GB below ${diskFloor}GB for NODE_MODE=${mode} on ${network}`,
		);
	}
	if (
		snap.postgresMaxConnections !== undefined &&
		snap.postgresMaxConnections < FLOORS.postgresMaxConnections
	) {
		errors.push(
			`Postgres max_connections ${snap.postgresMaxConnections} below ${FLOORS.postgresMaxConnections}`,
		);
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, estimates: MEASURED_DISK };
}
