import { getDb } from "@secondlayer/shared/db";
import { getGapSummaryBySubgraph } from "@secondlayer/shared/db/queries/subgraph-gaps";
import { Hono } from "hono";
import { sql } from "kysely";

const app = new Hono();

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

	return c.json({
		status: dbStatus === "ok" ? "healthy" : "degraded",
		network: process.env.STACKS_NETWORK || "mainnet",
		database: { status: dbStatus },
		indexProgress: progress,
		integrity,
		gaps: [],
		totalMissingBlocks: 0,
		blocksReceivedOutOfOrder,
		chainTip,
		activeSubgraphs: subgraphHealth.filter((v) => v.status === "active").length,
		subgraphs: subgraphHealth,
		timestamp: new Date().toISOString(),
	});
});

export default app;
