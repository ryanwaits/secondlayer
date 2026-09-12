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
	latest(against?: string, opts?: ArchiveLoadOptions): Promise<LoadedArchive>;
	load(against: string, opts?: ArchiveLoadOptions): Promise<LoadedArchive>;
	status(): Promise<ArchiveStatus>;
	partitions(
		ref: LoadedArchive,
		filter?: {
			dataset?: ArchiveDataset;
			fromBlock?: number;
			toBlock?: number;
		},
	): ArchivePartition[];
	quote(input: { paths: string[]; flow: ArchiveFlow }): Promise<ArchiveQuote>;
	fetch(input: {
		paths: string[];
		flow: ArchiveFlow;
	}): Promise<ArchiveFetchResult>;
	download(
		partition: ArchivePartition,
		opts?: { url?: string },
	): Promise<Uint8Array>;
	credits: {
		balance(): Promise<ArchiveCreditsBalance>;
		checkout(input: {
			email: string;
			pack: 10 | 25 | 50 | 100;
		}): Promise<{ url: string }>;
		refill(
			input: { belowUsd: number; packUsd: 10 | 25 | 50 | 100 } | { off: true },
		): Promise<{ belowUsd: number | null; packUsd: number | null }>;
	};
};

/** Hosted archive client plus instance `verify`. `status()` is still the public archive tree. */
export type SecondLayerArchive = ArchiveClient & {
	verify(input: ArchiveVerifyInput): Promise<ArchiveVerifyResult>;
};
