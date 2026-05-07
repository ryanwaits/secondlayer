export type DatasetManifestFile = {
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

export type DatasetManifest = {
	dataset: string;
	network: string;
	version: string;
	schema_version: number;
	generated_at: string;
	producer_version: string;
	finality_lag_blocks: number;
	latest_finalized_cursor: string | null;
	coverage: { from_block: number; to_block: number };
	files: DatasetManifestFile[];
};

export type DatasetManifestSnapshot = {
	manifest: DatasetManifest | null;
	fetchedAt: number;
	status: "ok" | "unavailable";
};

export type DatasetFreshness = {
	slug: string;
	status: "ok" | "unavailable";
	latest_finalized_cursor: string | null;
	generated_at: string | null;
	to_block: number | null;
	lag_blocks: number | null;
};

const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 2_000;

const cache = new Map<string, DatasetManifestSnapshot>();

export function resetDatasetManifestCache(): void {
	cache.clear();
}

export async function fetchDatasetManifest(
	url: string,
	now: number = Date.now(),
): Promise<DatasetManifestSnapshot> {
	const cached = cache.get(url);
	if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached;

	let snapshot: DatasetManifestSnapshot;
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) {
			snapshot = { manifest: null, fetchedAt: now, status: "unavailable" };
		} else {
			const manifest = (await res.json()) as DatasetManifest;
			snapshot = { manifest, fetchedAt: now, status: "ok" };
		}
	} catch {
		snapshot = { manifest: null, fetchedAt: now, status: "unavailable" };
	}
	cache.set(url, snapshot);
	return snapshot;
}

export function datasetFreshness(params: {
	slug: string;
	manifest: DatasetManifest | null;
	chainTip: number | null;
}): DatasetFreshness {
	if (!params.manifest) {
		return {
			slug: params.slug,
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
		slug: params.slug,
		status: "ok",
		latest_finalized_cursor: params.manifest.latest_finalized_cursor,
		generated_at: params.manifest.generated_at,
		to_block: params.manifest.coverage.to_block,
		lag_blocks: lagBlocks,
	};
}

export type DatasetSource = {
	slug: string;
	manifestUrl: string | null;
};

function datasetsBaseUrl(): string | null {
	const raw = process.env.DATASETS_PUBLIC_BASE_URL;
	if (!raw) return null;
	return raw.replace(/\/+$/, "");
}

export function datasetSources(): DatasetSource[] {
	const base = datasetsBaseUrl();
	const slugs = ["stx-transfers", "sbtc-events"];
	return slugs.map((slug) => ({
		slug,
		manifestUrl: base ? `${base}/${slug}/manifest/latest.json` : null,
	}));
}

export async function getDatasetsFreshness(params: {
	chainTip: number | null;
}): Promise<DatasetFreshness[]> {
	const sources = datasetSources();
	const results = await Promise.all(
		sources.map(async (source) => {
			if (!source.manifestUrl) {
				return datasetFreshness({
					slug: source.slug,
					manifest: null,
					chainTip: params.chainTip,
				});
			}
			const snapshot = await fetchDatasetManifest(source.manifestUrl);
			return datasetFreshness({
				slug: source.slug,
				manifest: snapshot.manifest,
				chainTip: params.chainTip,
			});
		}),
	);
	return results;
}
