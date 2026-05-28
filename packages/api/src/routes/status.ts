import {
	type L2DecodersHealth,
	L2_DECODER_EVENT_TYPES,
	getEnabledL2DecoderNames,
	getL2DecodersHealth,
} from "@secondlayer/indexer/l2/health";
import { getDb } from "@secondlayer/shared/db";
import { getGapSummaryBySubgraph } from "@secondlayer/shared/db/queries/subgraph-gaps";
import { Hono } from "hono";
import { sql } from "kysely";
import {
	type DatasetFreshness,
	getDatasetsFreshness,
} from "../datasets/manifests.ts";
import {
	type StreamsDumpsFreshness,
	getStreamsBulkManifest,
	streamsDumpsFreshness,
} from "../streams/dumps.ts";
import { type StreamsTip, getStreamsTip } from "../streams/tip.ts";
import { getApiTelemetrySnapshot } from "../telemetry/api.ts";

const app = new Hono();

type PublicIndexDecoderStatus = "ok" | "degraded" | "unavailable";

type PublicIndexDecoder = {
	decoder: string;
	eventType: string;
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
	name: "api" | "database" | "indexer" | "l2_decoder" | "subgraph_processor";
	status: SemanticHealthStatus;
};

const SUBGRAPH_PROCESSOR_STALE_MS = 90_000;

// Built per-request from env flags so the public status response surfaces
// every enabled L2 decoder, not just the always-on ft + nft pair. The base
// decoders reuse the indexer's canonical event-type map (so they never drift);
// the env-gated sbtc/pox4/bns decoders live in separate storage modules and
// carry their public labels here.
const DECODER_EVENT_TYPE: Record<string, string> = {
	...L2_DECODER_EVENT_TYPES,
	"l2.sbtc.v1": "sbtc",
	"l2.sbtc_token.v1": "sbtc_token",
	"l2.pox4.v1": "pox4_call",
	"l2.bns.v1": "bns_print",
};

function indexDecoders(): Array<{ decoder: string; eventType: string }> {
	return getEnabledL2DecoderNames().map((decoder) => ({
		decoder,
		eventType: DECODER_EVENT_TYPE[decoder] ?? decoder,
	}));
}

export function publicIndexStatusFromL2Health(
	health: L2DecodersHealth | null,
): PublicIndexStatus {
	if (!health) {
		return {
			status: "unavailable",
			decoders: indexDecoders().map((decoder) => ({
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
	const decoders: PublicIndexDecoder[] = indexDecoders().map((decoder) => {
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

function overallPublicStatus(
	services: PublicServiceHealth[],
): "healthy" | "degraded" {
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
	// `image_sha` lets operators detect deploy drift without shelling in —
	// `curl /health` shows which commit the running API was built from.
	// Sourced from `DEPLOY_IMAGE_TAG` env (the git SHA the Deploy workflow
	// pinned when starting this container).
	return c.json({
		status: "ok",
		image_sha: process.env.DEPLOY_IMAGE_TAG ?? null,
	});
});

app.get("/public/status", async (c) => {
	const db = getDb();
	const [
		dbResult,
		indexerResult,
		streamsTipResult,
		l2DecodersResult,
		dumpsManifestResult,
		subgraphProcessorHeartbeat,
	] = await Promise.allSettled([
		sql`SELECT 1`.execute(db),
		getIndexerHealth(),
		getStreamsTip(),
		getL2DecodersHealth({ db }),
		getStreamsBulkManifest(),
		db
			.selectFrom("service_heartbeats")
			.select("updated_at")
			.where("name", "=", "subgraph-processor")
			.executeTakeFirst(),
	]);
	const subgraphProcessorDetail: {
		status: SemanticHealthStatus;
		lastSeen: string | null;
		ageSeconds: number | null;
		reason: string;
	} = (() => {
		if (subgraphProcessorHeartbeat.status !== "fulfilled") {
			const reason =
				subgraphProcessorHeartbeat.reason instanceof Error
					? subgraphProcessorHeartbeat.reason.message
					: String(subgraphProcessorHeartbeat.reason ?? "query_failed");
			return {
				status: "unavailable",
				lastSeen: null,
				ageSeconds: null,
				reason: `query_error: ${reason.slice(0, 200)}`,
			};
		}
		const row = subgraphProcessorHeartbeat.value;
		if (!row) {
			return {
				status: "unavailable",
				lastSeen: null,
				ageSeconds: null,
				reason: "no_heartbeat_row",
			};
		}
		const lastSeen = new Date(row.updated_at);
		const ageSeconds = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
		const status: SemanticHealthStatus =
			ageSeconds * 1000 <= SUBGRAPH_PROCESSOR_STALE_MS ? "ok" : "degraded";
		return {
			status,
			lastSeen: lastSeen.toISOString(),
			ageSeconds,
			reason: status === "ok" ? "fresh" : "stale",
		};
	})();
	const subgraphProcessorStatus = subgraphProcessorDetail.status;
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
		{ name: "subgraph_processor", status: subgraphProcessorStatus },
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
		subgraphProcessor: subgraphProcessorDetail,
		services,
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
		subgraphProcessorHeartbeat,
	] = await Promise.allSettled([
		sql`SELECT 1`.execute(db),
		db.selectFrom("index_progress").selectAll().execute(),
		getIndexerHealth(),
		db.selectFrom("subgraphs").selectAll().execute(),
		getGapSummaryBySubgraph(db),
		getStreamsTip(),
		getL2DecodersHealth({ db }),
		db
			.selectFrom("service_heartbeats")
			.select("updated_at")
			.where("name", "=", "subgraph-processor")
			.executeTakeFirst(),
	]);

	const dbStatus = dbResult.status === "fulfilled" ? "ok" : "error";
	const subgraphProcessorStatus: SemanticHealthStatus = (() => {
		if (subgraphProcessorHeartbeat.status !== "fulfilled") return "unavailable";
		const row = subgraphProcessorHeartbeat.value;
		if (!row) return "unavailable";
		const ageMs = Date.now() - new Date(row.updated_at).getTime();
		return ageMs <= SUBGRAPH_PROCESSOR_STALE_MS ? "ok" : "degraded";
	})();

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
		{ name: "subgraph_processor", status: subgraphProcessorStatus },
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
		activeSubgraphs: subgraphHealth.filter((v) => v.status === "active").length,
		subgraphs: subgraphHealth,
		timestamp: new Date().toISOString(),
	});
});

export default app;
