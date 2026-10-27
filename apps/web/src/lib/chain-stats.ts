import { PLATFORM_API_URL } from "@/lib/api";
import {
	type ArchiveFreshnessData,
	type PartitionNames,
	lastPartitions,
	readArchiveFreshness,
} from "@/lib/archive-freshness";
import { readEventsTotal } from "@/lib/status-fields";

/**
 * Chain figures for the marketing pages, server side.
 *
 * `signed` comes from the signed archive manifest (changes once per publish,
 * cached an hour). `liveEvents` is the hosted index's running event total from
 * `/public/status` (cached 30s); the client keeps it ticking with
 * `LiveEventsOdometer`. Either fetch failing falls back to the last signed publish
 * we shipped, so a slow upstream never blocks or breaks a render.
 */

export const ARCHIVE_MANIFEST_URL =
	"https://archive.secondlayer.tools/latest.json";

export interface SignedCounts {
	blocks: number;
	transactions: number;
	events: number;
	/** Highest block in the signed set (coverage.to_block). */
	toBlock: number;
	/** When the manifest was promoted (ISO); null if the manifest has no date. */
	promotedAt: string | null;
	/** Snapshot manifest path (`snapshots/<digest>.json`); null if unknown. */
	snapshotPath: string | null;
}

/** 2026-10-07 publish. Used only when the manifest can't be read. */
const FALLBACK: SignedCounts = {
	blocks: 9_137_865,
	transactions: 29_861_044,
	events: 294_300_251,
	toBlock: 9_137_864,
	promotedAt: "2026-10-07T10:17:49.516Z",
	snapshotPath: null,
};

const TIMEOUT_MS = 1500;

export async function getSignedCounts(): Promise<SignedCounts> {
	try {
		const res = await fetch(ARCHIVE_MANIFEST_URL, {
			next: { revalidate: 3600 },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) return FALLBACK;
		const m = (await res.json()) as {
			counts?: Partial<Record<"blocks" | "transactions" | "events", number>>;
			coverage?: { to_block?: number };
			promoted_at?: string;
			snapshot_path?: string;
		};
		const { blocks, transactions, events } = m.counts ?? {};
		const toBlock = m.coverage?.to_block;
		if (
			typeof blocks !== "number" ||
			typeof transactions !== "number" ||
			typeof events !== "number" ||
			typeof toBlock !== "number"
		)
			return FALLBACK;
		return {
			blocks,
			transactions,
			events,
			toBlock,
			promotedAt: typeof m.promoted_at === "string" ? m.promoted_at : null,
			snapshotPath:
				typeof m.snapshot_path === "string" ? m.snapshot_path : null,
		};
	} catch {
		return FALLBACK;
	}
}

export const ARCHIVE_STATUS_URL =
	"https://archive.secondlayer.tools/status.json";

/** The archive's published status, or null on any failure. */
export async function getArchiveFreshness(): Promise<ArchiveFreshnessData | null> {
	try {
		const res = await fetch(ARCHIVE_STATUS_URL, {
			next: { revalidate: 60 },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		return res.ok ? readArchiveFreshness(await res.json()) : null;
	} catch {
		return null;
	}
}

/** Newest partition names per dataset from the signed snapshot manifest; null on any failure. */
export async function getLatestPartitions(
	snapshotPath: string | null,
): Promise<PartitionNames | null> {
	if (!snapshotPath) return null;
	try {
		const res = await fetch(
			`https://archive.secondlayer.tools/${snapshotPath}`,
			{
				next: { revalidate: 3600 },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			},
		);
		return res.ok ? lastPartitions(await res.json()) : null;
	} catch {
		return null;
	}
}

export const STATUS_URL = `${PLATFORM_API_URL}/public/status`;

/** Running event total, or the signed count when the status read fails. */
export async function getLiveEvents(signed: SignedCounts): Promise<number> {
	try {
		const res = await fetch(STATUS_URL, {
			next: { revalidate: 30 },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) return signed.events;
		return Math.max(readEventsTotal(await res.json()) ?? 0, signed.events);
	} catch {
		return signed.events;
	}
}

const fmt = new Intl.NumberFormat("en-US");
export const formatCount = (n: number) => fmt.format(n);

/** Manifest table rows: count, share of the set, coverage, for each dataset. */
export function manifestRows(c: SignedCounts) {
	const total = c.blocks + c.transactions + c.events;
	const share = (n: number) => Math.round((n / total) * 10_000) / 100;
	const coverage = `0 → ${formatCount(c.toBlock)}`;
	return [
		{
			dataset: "events",
			rows: formatCount(c.events),
			share: share(c.events),
			coverage,
		},
		{
			dataset: "transactions",
			rows: formatCount(c.transactions),
			share: share(c.transactions),
			coverage,
		},
		{
			dataset: "blocks",
			rows: formatCount(c.blocks),
			share: share(c.blocks),
			coverage,
		},
	] as const;
}
