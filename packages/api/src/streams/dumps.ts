export type StreamsBulkManifestFile = {
	path: string;
	from_block: number;
	to_block: number;
	min_cursor: string | null;
	max_cursor: string | null;
	row_count: number;
	byte_size: number;
	sha256: string;
	schema_version: number;
	created_at: string;
};

export type StreamsBulkManifest = {
	dataset: string;
	network: string;
	version: string;
	schema_version: number;
	generated_at: string;
	producer_version: string;
	finality_lag_blocks: number;
	latest_finalized_cursor: string | null;
	coverage: {
		from_block: number;
		to_block: number;
	};
	files: StreamsBulkManifestFile[];
};

export type StreamsDumpsManifestSnapshot = {
	manifest: StreamsBulkManifest | null;
	fetchedAt: number;
	status: "ok" | "unavailable";
};

export type StreamsDumpsFreshness = {
	status: "ok" | "unavailable";
	latest_finalized_cursor: string | null;
	generated_at: string | null;
	to_block: number | null;
	lag_blocks: number | null;
};

const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 2_000;

let cached: StreamsDumpsManifestSnapshot | null = null;

export function streamsDumpsPublicBaseUrl(): string | null {
	const raw = process.env.STREAMS_BULK_PUBLIC_BASE_URL;
	if (!raw) return null;
	return raw.replace(/\/+$/, "");
}

export function streamsDumpsManifestUrl(): string | null {
	const base = streamsDumpsPublicBaseUrl();
	if (!base) return null;
	return `${base}/manifest/latest.json`;
}

export function resetStreamsDumpsManifestCache(): void {
	cached = null;
}

export async function getStreamsBulkManifest(
	now: number = Date.now(),
): Promise<StreamsDumpsManifestSnapshot> {
	if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached;

	const url = streamsDumpsManifestUrl();
	if (!url) {
		cached = { manifest: null, fetchedAt: now, status: "unavailable" };
		return cached;
	}

	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) {
			cached = { manifest: null, fetchedAt: now, status: "unavailable" };
			return cached;
		}
		const manifest = (await res.json()) as StreamsBulkManifest;
		cached = { manifest, fetchedAt: now, status: "ok" };
		return cached;
	} catch {
		cached = { manifest: null, fetchedAt: now, status: "unavailable" };
		return cached;
	}
}

export function streamsDumpsFreshness(params: {
	manifest: StreamsBulkManifest | null;
	chainTip: number | null;
}): StreamsDumpsFreshness {
	if (!params.manifest) {
		return {
			status: "unavailable",
			latest_finalized_cursor: null,
			generated_at: null,
			to_block: null,
			lag_blocks: null,
		};
	}
	const lagBlocks =
		params.chainTip !== null
			? Math.max(0, params.chainTip - params.manifest.coverage.to_block)
			: null;
	return {
		status: "ok",
		latest_finalized_cursor: params.manifest.latest_finalized_cursor,
		generated_at: params.manifest.generated_at,
		to_block: params.manifest.coverage.to_block,
		lag_blocks: lagBlocks,
	};
}
