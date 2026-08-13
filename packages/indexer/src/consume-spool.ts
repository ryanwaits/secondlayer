import { getSourceDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { planBootstrapSeam } from "./bootstrap-seam.ts";
import { ingestNewBlock } from "./ingest.ts";
import {
	markObserverProcessed,
	parseObserverBody,
} from "./observer-journal.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const NETWORK = process.env.STACKS_NETWORK || "mainnet";

/** Hosted indexer leaves INSTANCE_MODE unset. Never infer oss from the default. */
export function isOssIndexer(): boolean {
	return process.env.INSTANCE_MODE === "oss";
}

export async function hasIndexProgress(): Promise<boolean> {
	const row = await getSourceDb()
		.selectFrom("index_progress")
		.select("network")
		.where("network", "=", NETWORK)
		.executeTakeFirst();
	return !!row;
}

/**
 * Journal-only until bootstrap writes index_progress. Hosted never spools.
 * INGEST_MODE=live/spool overrides the auto switch.
 */
export async function isBootstrapSpoolMode(): Promise<boolean> {
	if (process.env.INGEST_MODE === "live") return false;
	if (process.env.INGEST_MODE === "spool") return true;
	if (!isOssIndexer()) return false;
	return !(await hasIndexProgress());
}

export async function consumeBootstrapSpool(): Promise<void> {
	if (!isOssIndexer()) return;
	if (!(await hasIndexProgress())) {
		logger.info("Bootstrap spool: waiting for archive import");
		return;
	}

	const db = getSourceDb();
	const progress = await db
		.selectFrom("index_progress")
		.select(["last_indexed_block"])
		.where("network", "=", NETWORK)
		.executeTakeFirst();
	if (!progress) return;

	const archiveTip = Number(progress.last_indexed_block);
	const tipRow = await db
		.selectFrom("blocks")
		.select("hash")
		.where("height", "=", archiveTip)
		.where("canonical", "=", true)
		.executeTakeFirst();

	const rows = await db
		.selectFrom("observer_journal")
		.select(["sequence", "raw_body", "path"])
		.where("network", "=", NETWORK)
		.where("path", "=", "/new_block")
		.where("status", "=", "received")
		.orderBy("sequence", "asc")
		.execute();

	const events = rows.map((row) => {
		const payload = parseObserverBody<NewBlockPayload>(row.raw_body);
		return {
			sequence: String(row.sequence),
			height: payload.block_height,
			hash: payload.block_hash,
			parentHash: payload.parent_block_hash,
			payload,
		};
	});

	const plan = planBootstrapSeam({
		archiveTip,
		archiveTipHash: tipRow?.hash ?? null,
		nodeTip: null,
		events,
	});

	if (plan.status !== "ready") {
		logger.error("Bootstrap spool consume refused", plan);
		return;
	}

	for (const event of plan.skip) {
		const full = events.find((e) => e.sequence === event.sequence);
		if (!full) continue;
		await markObserverProcessed(
			db,
			{
				sequence: event.sequence,
				path: "/new_block",
				body: Buffer.from([]),
				rawBodySha256: "",
			},
			{
				path: "/new_block",
				payload: full.payload,
				result: { status: "duplicate", skipped: "archive" },
			},
		);
	}

	for (const event of plan.consume) {
		const full = events.find((e) => e.sequence === event.sequence);
		if (!full) continue;
		const result = await ingestNewBlock(full.payload);
		await markObserverProcessed(
			db,
			{
				sequence: event.sequence,
				path: "/new_block",
				body: Buffer.from([]),
				rawBodySha256: "",
			},
			{ path: "/new_block", payload: full.payload, result },
		);
	}

	logger.info("Bootstrap spool consumed", {
		skipped: plan.skip.length,
		ingested: plan.consume.length,
		archiveTip,
	});
}
