import {
	type L2DecodersHealth,
	getL2DecodersHealth,
} from "@secondlayer/indexer/l2/health";
import { getDb } from "@secondlayer/shared/db";
import { getGapSummaryBySubgraph } from "@secondlayer/shared/db/queries/subgraph-gaps";
import { Hono } from "hono";
import { sql } from "kysely";
import { type StreamsTip, getStreamsTip } from "../streams/tip.ts";

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

app.get("/health", async (c) => {
	return c.json({ status: "ok" });
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
		fetch(`${process.env.INDEXER_URL || "http://localhost:3700"}/health`, {
			signal: AbortSignal.timeout(1000),
		}).then((r) =>
			r.ok
				? (r.json() as Promise<{ blocksReceivedOutOfOrder?: number }>)
				: null,
		),
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

	return c.json({
		status: dbStatus === "ok" ? "healthy" : "degraded",
		network: process.env.STACKS_NETWORK || "mainnet",
		database: { status: dbStatus },
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
		index: publicIndexStatusFromL2Health(l2DecodersHealth),
		activeSubgraphs: subgraphHealth.filter((v) => v.status === "active").length,
		subgraphs: subgraphHealth,
		timestamp: new Date().toISOString(),
	});
});

export default app;
