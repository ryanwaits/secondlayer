import { getDb } from "@secondlayer/shared/db";
import { getGapSummaryBySubgraph } from "@secondlayer/shared/db/queries/subgraph-gaps";
import { stats as queueStats } from "@secondlayer/shared/queue";
import { Hono } from "hono";
import { sql } from "kysely";

const app = new Hono();

// Simple health check
app.get("/health", async (c) => {
	return c.json({ status: "ok" });
});

// Detailed status
app.get("/status", async (c) => {
	const db = getDb();

	// Run all independent queries in parallel
	const [
		dbResult,
		queueResult,
		progressResult,
		streamResult,
		indexerResult,
		deliveriesResult,
		subgraphResult,
		gapSummaryResult,
	] = await Promise.allSettled([
		// 1. DB ping
		sql`SELECT 1`.execute(db),
		// 2. Queue stats
		queueStats(),
		// 3. Index progress
		db
			.selectFrom("index_progress")
			.selectAll()
			.execute(),
		// 4. Stream counts
		db
			.selectFrom("streams")
			.select(["status", sql<number>`count(*)`.as("count")])
			.groupBy("status")
			.execute(),
		// 5. Indexer health
		fetch(`${process.env.INDEXER_URL || "http://localhost:3700"}/health`, {
			signal: AbortSignal.timeout(1000),
		}).then((r) =>
			r.ok
				? (r.json() as Promise<{ blocksReceivedOutOfOrder?: number }>)
				: null,
		),
		// 6. Recent deliveries
		db
			.selectFrom("deliveries")
			.select(sql<number>`count(*)`.as("count"))
			.where("created_at", ">=", sql<Date>`now() - interval '24 hours'`)
			.executeTakeFirst(),
		// 7. Subgraphs
		db
			.selectFrom("subgraphs")
			.selectAll()
			.execute(),
		// 8. Subgraph gap summaries
		getGapSummaryBySubgraph(db),
	]);

	const dbStatus = dbResult.status === "fulfilled" ? "ok" : "error";

	const queue =
		queueResult.status === "fulfilled"
			? queueResult.value
			: { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };

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
		// Use highest_seen_block as chain tip instead of external API call
		if (progressResult.value.length > 0) {
			chainTip = Math.max(
				...progressResult.value.map((p) => p.highest_seen_block),
			);
		}
	}

	const streamCounts = {
		total: 0,
		inactive: 0,
		active: 0,
		paused: 0,
		failed: 0,
	};
	if (streamResult.status === "fulfilled") {
		streamCounts.total = streamResult.value.reduce(
			(sum, r) => sum + r.count,
			0,
		);
		for (const r of streamResult.value) {
			if (r.status === "inactive") streamCounts.inactive = r.count;
			if (r.status === "active") streamCounts.active = r.count;
			if (r.status === "paused") streamCounts.paused = r.count;
			if (r.status === "failed") streamCounts.failed = r.count;
		}
	}

	const blocksReceivedOutOfOrder =
		indexerResult.status === "fulfilled" && indexerResult.value
			? (indexerResult.value.blocksReceivedOutOfOrder ?? 0)
			: 0;

	const recentDeliveries =
		deliveriesResult.status === "fulfilled"
			? (deliveriesResult.value?.count ?? 0)
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

	// Integrity: use last_contiguous_block vs last_indexed_block from progress
	// Avoids expensive window function gap queries on 7M+ rows
	const integrity =
		progress.length > 0 &&
		progress.every((p) => p.lastContiguousBlock >= p.lastIndexedBlock)
			? "complete"
			: "gaps_detected";

	return c.json({
		status: dbStatus === "ok" ? "healthy" : "degraded",
		network: process.env.STACKS_NETWORK || "mainnet",
		database: { status: dbStatus },
		queue,
		indexProgress: progress,
		integrity,
		gaps: [],
		totalMissingBlocks: 0,
		blocksReceivedOutOfOrder,
		streams: streamCounts,
		activeStreams: streamCounts.active,
		chainTip,
		activeSubgraphs: subgraphHealth.filter((v) => v.status === "active").length,
		recentDeliveries: String(recentDeliveries),
		subgraphs: subgraphHealth,
		timestamp: new Date().toISOString(),
	});
});

export default app;
