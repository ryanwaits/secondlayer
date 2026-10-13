import type { RangeDigest } from "@secondlayer/shared/archive/range-digest";
import type { ArchiveStatus } from "@secondlayer/shared/archive/status";
import type { ArchiveVerifyInput, ArchiveVerifyResult } from "./instance.ts";

export type { ArchiveStatus };

export type ArchiveDataset = "blocks" | "transactions" | "events";
export type ArchiveFlow = "bootstrap" | "repair";

export type ArchivePartition = {
	dataset: string;
	from_block: number;
	to_block: number;
	path: string;
	row_count: number;
	byte_size: number;
	sha256: string;
};

export type ArchiveManifest = {
	network?: string;
	coverage?: { from_block: number; to_block: number };
	partition_size_blocks?: number;
	range_digests?: RangeDigest[];
	partitions?: ArchivePartition[];
	signature?: string;
	key_id?: string;
	[key: string]: unknown;
};

export type LoadedArchive = {
	manifest: ArchiveManifest;
	origin: string;
	root: string;
	isRemote: boolean;
	signature: { verified: boolean; reason?: string };
};

export type ArchiveQuote = {
	partitions: number;
	bundles: number;
	usdMicros: number;
	usd: string;
	freeAllowanceAppliedMicros: number;
	allowanceRemainingBundles: number;
	balanceUsdMicros: number;
	sufficient: boolean;
};

export type ArchiveFetchItem = {
	path: string;
	url: string;
	expiresAt: string;
	chargedUsdMicros: number;
};

export type ArchiveFetchResult = {
	urls: ArchiveFetchItem[];
	chargedTotalUsdMicros: number;
	balanceAfterUsdMicros: number;
};

export type ArchiveCreditsBalance = {
	creditsUsdMicros: string;
	refill: {
		belowUsd: number | null;
		packUsd: number | null;
		lastAt: string | null;
	};
};

export type ArchiveLoadOptions = {
	insecure?: boolean;
};

export type ArchiveClient = {
	/**
	 * Load the latest signed archive manifest.
	 *
	 * Reads `<archive>/latest.json` unless `against` names another manifest URL. The manifest's ed25519 signature is checked against the archive signing key, and a missing or invalid one throws `ArchiveSignatureError`. `insecure: true` skips the check; `signature.verified` on the result says whether it held.
	 */
	latest(against?: string, opts?: ArchiveLoadOptions): Promise<LoadedArchive>;
	/**
	 * Load an archive manifest from a URL.
	 *
	 * Takes http(s) URLs only; a local path throws a `ValidationError` and stays on the CLI. The signature check is the same as {@link latest}.
	 */
	load(against: string, opts?: ArchiveLoadOptions): Promise<LoadedArchive>;
	/**
	 * Get the archive's current operational state.
	 *
	 * Reads the public `status.json`: `fresh`, `lagging`, `stale`, `gap`, `failed-audit`, or `source-unavailable`, plus how far the last signed publish reaches.
	 */
	status(): Promise<ArchiveStatus>;
	/**
	 * List a loaded archive's partitions, optionally filtered.
	 *
	 * Runs locally on the manifest you already loaded and makes no request. Filter by `dataset` (`blocks`, `transactions`, or `events`) and a block range.
	 */
	partitions(
		ref: LoadedArchive,
		filter?: {
			dataset?: ArchiveDataset;
			fromBlock?: number;
			toBlock?: number;
		},
	): ArchivePartition[];
	/**
	 * Price a fetch against your balance before you pay for it.
	 *
	 * Nothing is charged. `flow` is `bootstrap` or `repair`. The quote has the bundle count, the price in USD, the free repair allowance applied, your balance, and `sufficient`. Needs an account key (`sk-sl_*`), not an instance token.
	 */
	quote(input: { paths: string[]; flow: ArchiveFlow }): Promise<ArchiveQuote>;
	/**
	 * Get presigned download URLs for archive partitions.
	 *
	 * Draws credits per partition bundle; your first six repair bundles each month are free. Lists longer than 64 paths go out in batches of 64. Each URL is short-lived (`expiresAt`); pass it to {@link download}. An empty balance throws `InsufficientArchiveCreditsError` with the shortfall. Needs an account key (`sk-sl_*`).
	 */
	fetch(input: {
		paths: string[];
		flow: ArchiveFlow;
	}): Promise<ArchiveFetchResult>;
	/**
	 * Download a partition's bytes and verify them.
	 *
	 * The sha256 is checked against the manifest, and a mismatch throws `ArchiveSignatureError`. On the official archive host you must pass the presigned `url` from {@link fetch}, or it throws a `ValidationError`; any other host downloads straight from its archive tree.
	 */
	download(
		partition: ArchivePartition,
		opts?: { url?: string },
	): Promise<Uint8Array>;
	credits: {
		/**
		 * Get your archive credit balance.
		 *
		 * Returns `creditsUsdMicros` (millionths of a dollar, as a string) and your auto-refill setting. Needs an account key (`sk-sl_*`).
		 */
		balance(): Promise<ArchiveCreditsBalance>;
		/**
		 * Start a card checkout for a credit pack.
		 *
		 * `pack` is the dollar amount: 10, 25, 50, or 100. Resolves to the checkout `url`. Needs no account key.
		 */
		checkout(input: {
			email: string;
			pack: 10 | 25 | 50 | 100;
		}): Promise<{ url: string }>;
		/**
		 * Set or turn off automatic credit refill.
		 *
		 * Pass `belowUsd` and `packUsd` to buy a pack whenever the balance drops below the threshold, or `{ off: true }` to stop. Needs an account key (`sk-sl_*`).
		 */
		refill(
			input: { belowUsd: number; packUsd: 10 | 25 | 50 | 100 } | { off: true },
		): Promise<{ belowUsd: number | null; packUsd: number | null }>;
	};
};

/** Hosted archive client plus instance `verify`. `status()` is still the public archive tree. */
export type SecondLayerArchive = ArchiveClient & {
	/**
	 * Check your instance's data against a signed archive.
	 *
	 * Runs `POST /v1/archive/verify` on your instance: read-only, and it compares raw identity digests only (the deep semantic check is CLI-only). Resolves to `clean`, `diverged`, or `unanchored`; a failed signature is `unanchored`, never `clean`. Narrow the check with `fromBlock` and `toBlock`. Verification is free.
	 */
	verify(input: ArchiveVerifyInput): Promise<ArchiveVerifyResult>;
};
