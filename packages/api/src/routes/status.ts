import {
	type L2DecodersHealth,
	getL2DecodersHealth,
} from "@secondlayer/indexer/l2/health";
import { getDb } from "@secondlayer/shared/db";
import { getGapSummaryBySubgraph } from "@secondlayer/shared/db/queries/subgraph-gaps";
import { Hono } from "hono";
import { sql } from "kysely";
import {
	getDatasetsFreshness,
	type DatasetFreshness,
} from "../datasets/manifests.ts";
import {
	getStreamsBulkManifest,
	streamsDumpsFreshness,
	type StreamsDumpsFreshness,
} from "../streams/dumps.ts";
import { type StreamsTip, getStreamsTip } from "../streams/tip.ts";
import { getApiTelemetrySnapshot } from "../telemetry/api.ts";

const app = new Hono();

type PublicIndexDecoderStatus = "ok" | "degraded" | "unavailable";

type PublicIndexDecoder = {
	decoder: string;
	eventType: "ft_transfer" | "nft_transfer";
	status: PublicIndexDecoderStatus;
	lagSeconds: number | null;
	checkpointBlockHeight: number | null;
	tipBlockHeight: number | null;
	lastDecodedAt: string | null;
};

type PublicIndexStatus = {
	status: PublicIndexDecoderStatus;
	decoders: PublicIndexDecoder[];
};

type SemanticHealthStatus = "ok" | "degraded" | "unavailable";

type PublicServiceHealth = {
	name: "api" | "database" | "indexer" | "l2_decoder";
	status: SemanticHealthStatus;
};

const INDEX_DECODERS: Array<{
	decoder: string;
	eventType: "ft_transfer" | "nft_transfer";
}> = [
	{ decoder: "l2.ft_transfer.v1", eventType: "ft_transfer" },
	{ decoder: "l2.nft_transfer.v1", eventType: "nft_transfer" },
];

export function publicIndexStatusFromL2Health(
	health: L2DecodersHealth | null,
): PublicIndexStatus {
	if (!health) {
		return {
			status: "unavailable",
			decoders: INDEX_DECODERS.map((decoder) => ({
				...decoder,
				status: "unavailable",
				lagSeconds: null,
				checkpointBlockHeight: null,
				tipBlockHeight: null,
				lastDecodedAt: null,
			})),
		};
	}

	const byName = new Map(
		health.decoders.map((decoder) => [decoder.decoder, decoder]),
	);
	const decoders: PublicIndexDecoder[] = INDEX_DECODERS.map((decoder) => {
		const source = byName.get(decoder.decoder);
		if (!source) {
			return {
				...decoder,
				status: "unavailable" as const,
				lagSeconds: null,
				checkpointBlockHeight: null,
				tipBlockHeight: null,
				lastDecodedAt: null,
			};
		}

		return {
			...decoder,
			status: source.status === "healthy" ? "ok" : "degraded",
			lagSeconds: source.lag_seconds,
			checkpointBlockHeight: source.checkpoint_block_height,
			tipBlockHeight: source.tip_block_height,
			lastDecodedAt: source.last_decoded_at,
		};
	});

	const status = decoders.every((decoder) => decoder.status === "ok")
		? "ok"
		: decoders.every((decoder) => decoder.status === "unavailable")
			? "unavailable"
			: "degraded";

	return { status, decoders };
}

function serviceStatusFromPublicIndex(
	index: PublicIndexStatus,
): SemanticHealthStatus {
	if (index.status === "ok") return "ok";
	if (index.status === "degraded") return "degraded";
	return "unavailable";
}

function nodeStatusFromStreamsTip(
	streamsTip: StreamsTip | null,
): SemanticHealthStatus {
	if (!streamsTip) return "unavailable";
	if (streamsTip.lag_seconds >= 60) return "degraded";
	return "ok";
}

function overallPublicStatus(services: PublicServiceHealth[]): "healthy" | "degraded" {
	return services.every((service) => service.status === "ok")
		? "healthy"
		: "degraded";
}

async function getIndexerHealth(): Promise<{
	blocksReceivedOutOfOrder?: number;
} | null> {
	return fetch(`${process.env.INDEXER_URL || "http://localhost:3700"}/health`, {
		signal: AbortSignal.timeout(1000),
	}).then((r) =>
		r.ok ? (r.json() as Promise<{ blocksReceivedOutOfOrder?: number }>) : null,
	);
}

app.get("/health", async (c) => {
	return c.json({ status: "ok" });
});

app.get("/public/status", async (c) => {
	const db = getDb();
	const [
		dbResult,
		indexerResult,
		streamsTipResult,
		l2DecodersResult,
		dumpsManifestResult,
	] = await Promise.allSettled([
		sql`SELECT 1`.execute(db),
		getIndexerHealth(),
		getStreamsTip(),
		getL2DecodersHealth({ db }),
		getStreamsBulkManifest(),
	]);
	const streamsTip: StreamsTip | null =
		streamsTipResult.status === "fulfilled" ? streamsTipResult.value : null;
	const chainTip = streamsTip?.block_height ?? null;
	const l2DecodersHealth: L2DecodersHealth | null =
		l2DecodersResult.status === "fulfilled" ? l2DecodersResult.value : null;
	const index = publicIndexStatusFromL2Health(l2DecodersHealth);
	const dumps: StreamsDumpsFreshness = streamsDumpsFreshness({
		manifest:
			dumpsManifestResult.status === "fulfilled"
				? dumpsManifestResult.value.manifest
				: null,
		chainTip,
	});
	const datasetsResult = await Promise.allSettled([
		getDatasetsFreshness({ chainTip }),
	]);
	const datasets: DatasetFreshness[] =
		datasetsResult[0].status === "fulfilled" ? datasetsResult[0].value : [];
	const services: PublicServiceHealth[] = [
		{ name: "api", status: "ok" },
		{
			name: "database",
			status: dbResult.status === "fulfilled" ? "ok" : "unavailable",
		},
		{
			name: "indexer",
			status:
				indexerResult.status === "fulfilled" && indexerResult.value
					? "ok"
					: "unavailable",
		},
		{ name: "l2_decoder", status: serviceStatusFromPublicIndex(index) },
	];

	return c.json({
		status: overallPublicStatus(services),
		chainTip,
		streams: {
			status: streamsTip ? "ok" : "unavailable",
			tip: streamsTip,
			dumps,
		},
		index,
		datasets,
		api: getApiTelemetrySnapshot(),
		node: {
			status: nodeStatusFromStreamsTip(streamsTip),
		},
		services,
		reorgs: {
			last_24h: null,
		},
		timestamp: new Date().toISOString(),
	});
});

app.get("/public/streams/dumps/manifest", async (c) => {
	const snapshot = await getStreamsBulkManifest();
	if (!snapshot.manifest) {
		return c.json(
			{ status: "unavailable", message: "manifest not available" },
			503,
		);
	}
	c.header("Cache-Control", "public, max-age=30, s-maxage=30");
	c.header("Content-Type", "application/json; charset=utf-8");
	return c.json(snapshot.manifest);
});

app.get("/status", async (c) => {
	const db = getDb();

	const [
		dbResult,
		progressResult,
		indexerResult,
		subgraphResult,
		gapSummaryResult,
		streamsTipResult,
		l2DecodersResult,
	] = await Promise.allSettled([
		sql`SELECT 1`.execute(db),
		db.selectFrom("index_progress").selectAll().execute(),
		getIndexerHealth(),
		db.selectFrom("subgraphs").selectAll().execute(),
		getGapSummaryBySubgraph(db),
		getStreamsTip(),
		getL2DecodersHealth({ db }),
	]);

	const dbStatus = dbResult.status === "fulfilled" ? "ok" : "error";

	let progress: Array<{
		network: string;
		lastIndexedBlock: number;
		lastContiguousBlock: number;
		highestSeenBlock: number;
		updatedAt: string;
	}> = [];
	let chainTip: number | null = null;
	if (progressResult.status === "fulfilled") {
		progress = progressResult.value.map((p) => ({
			network: p.network,
			lastIndexedBlock: p.last_indexed_block,
			lastContiguousBlock: p.last_contiguous_block,
			highestSeenBlock: p.highest_seen_block,
			updatedAt: p.updated_at.toISOString(),
		}));
		if (progressResult.value.length > 0) {
			chainTip = Math.max(
				...progressResult.value.map((p) => p.highest_seen_block),
			);
		}
	}

	const blocksReceivedOutOfOrder =
		indexerResult.status === "fulfilled" && indexerResult.value
			? (indexerResult.value.blocksReceivedOutOfOrder ?? 0)
			: 0;

	const gapMap = new Map<
		string,
		{ gapCount: number; totalMissingBlocks: number }
	>();
	if (gapSummaryResult.status === "fulfilled") {
		for (const g of gapSummaryResult.value) {
			gapMap.set(g.subgraphName, g);
		}
	}

	let subgraphHealth: Array<{
		name: string;
		status: string;
		lastProcessedBlock: number;
		totalProcessed: number;
		totalErrors: number;
		errorRate: number;
		lastError: string | null;
		gapCount: number;
		totalMissingBlocks: number;
		integrity: string;
	}> = [];
	if (subgraphResult.status === "fulfilled") {
		subgraphHealth = subgraphResult.value.map((v) => {
			const gaps = gapMap.get(v.name);
			return {
				name: v.name,
				status: v.status,
				lastProcessedBlock: v.last_processed_block,
				totalProcessed: v.total_processed,
				totalErrors: v.total_errors,
				errorRate:
					v.total_processed > 0
						? Number.parseFloat((v.total_errors / v.total_processed).toFixed(4))
						: 0,
				lastError: v.last_error ?? null,
				gapCount: gaps?.gapCount ?? 0,
				totalMissingBlocks: gaps?.totalMissingBlocks ?? 0,
				integrity: (gaps?.gapCount ?? 0) > 0 ? "gaps_detected" : "complete",
			};
		});
	}

	const integrity =
		progress.length > 0 &&
		progress.every((p) => p.lastContiguousBlock >= p.lastIndexedBlock)
			? "complete"
			: "gaps_detected";
	const streamsTip: StreamsTip | null =
		streamsTipResult.status === "fulfilled" ? streamsTipResult.value : null;
	const l2DecodersHealth: L2DecodersHealth | null =
		l2DecodersResult.status === "fulfilled" ? l2DecodersResult.value : null;
	const index = publicIndexStatusFromL2Health(l2DecodersHealth);
	const services: PublicServiceHealth[] = [
		{ name: "api", status: "ok" },
		{
			name: "database",
			status: dbStatus === "ok" ? "ok" : "unavailable",
		},
		{
			name: "indexer",
			status:
				indexerResult.status === "fulfilled" && indexerResult.value
					? "ok"
					: "unavailable",
		},
		{ name: "l2_decoder", status: serviceStatusFromPublicIndex(index) },
	];

	return c.json({
		status: overallPublicStatus(services),
		network: process.env.STACKS_NETWORK || "mainnet",
		database: { status: dbStatus },
		api: getApiTelemetrySnapshot(),
		node: {
			status: nodeStatusFromStreamsTip(streamsTip),
		},
		services,
		indexProgress: progress,
		integrity,
		gaps: [],
		totalMissingBlocks: 0,
		blocksReceivedOutOfOrder,
		chainTip: streamsTip?.block_height ?? chainTip,
		streams: {
			status: streamsTip ? "ok" : "unavailable",
			tip: streamsTip,
		},
		index,
		reorgs: {
			last_24h: null,
		},
		activeSubgraphs: subgraphHealth.filter((v) => v.status === "active").length,
		subgraphs: subgraphHealth,
		timestamp: new Date().toISOString(),
	});
});

export default app;
