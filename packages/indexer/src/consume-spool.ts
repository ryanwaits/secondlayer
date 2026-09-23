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

export type SpoolOutcome = "not_oss" | "waiting" | "consumed" | "refused";

/**
 * Ingest what the observer journaled while the archive import ran. It must run
 * before the first live block is ingested: live ingest moves
 * `last_indexed_block`, and this reads that value as the archive tip, so a late
 * run would skip every spooled block as an archive duplicate.
 */
export async function consumeBootstrapSpool(): Promise<SpoolOutcome> {
	if (!isOssIndexer()) return "not_oss";
	if (!(await hasIndexProgress())) {
		logger.info("Bootstrap spool: waiting for archive import");
		return "waiting";
	}

	const db = getSourceDb();
	const progress = await db
		.selectFrom("index_progress")
		.select(["last_indexed_block"])
		.where("network", "=", NETWORK)
		.executeTakeFirst();
	if (!progress) return "waiting";

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
		return "refused";
	}

	for (const gap of plan.gaps) {
		// Neither the archive nor the journal holds these blocks, and the indexer
		// never fetches history on its own. Only a repair from a later archive
		// publish fills them.
		logger.warn("Bootstrap spool: gap not in the archive or the journal", {
			...gap,
			hint: `after the next archive publish covers it: secondlayer repair --against <manifest> --from-block ${gap.from} --to-block ${gap.to} --apply`,
		});
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
		gaps: plan.gaps.length,
		archiveTip,
	});
	return "consumed";
}

let settled: Promise<SpoolOutcome> | null = null;

/**
 * `consumeBootstrapSpool`, once per process after the import has landed.
 * Concurrent callers share one run; "waiting" is not remembered, so the next
 * call checks again. Called ahead of every live ingest so the spool is always
 * drained before the first live block moves the tip.
 */
export function ensureBootstrapSpoolConsumed(): Promise<SpoolOutcome> {
	if (settled) return settled;
	const run = consumeBootstrapSpool().then(
		(outcome) => {
			if (outcome === "waiting") settled = null;
			return outcome;
		},
		(error) => {
			settled = null;
			throw error;
		},
	);
	settled = run;
	return run;
}
