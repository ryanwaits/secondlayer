import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { OBSERVER_APPLY_LOCK_KEY } from "@secondlayer/shared/leader";
import { ingestNewBlock } from "./ingest.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_851;
const NETWORK = "apply-lock-ingest-test";

async function cleanupHeight(): Promise<void> {
	const db = getSourceDb();
	await db.deleteFrom("events").where("block_height", "=", H).execute();
	await db.deleteFrom("transactions").where("block_height", "=", H).execute();
	await db.deleteFrom("blocks").where("height", "=", H).execute();
	await db
		.deleteFrom("index_progress")
		.where("network", "=", NETWORK)
		.execute();
}

function payload(): NewBlockPayload {
	return {
		block_hash: "0xapplylock",
		block_height: H,
		index_block_hash: "0xapplylock-ibh",
		parent_block_hash: "0xparent",
		parent_index_block_hash: "0xparent-ibh",
		burn_block_hash: "0xburn",
		burn_block_height: 1,
		timestamp: 1_700_000_000,
		miner_txid: "0xminer",
		transactions: [],
		events: [],
	};
}

describe.skipIf(!HAS_DB)("ingestNewBlock apply lock", () => {
	beforeEach(async () => {
		if (!HAS_DB) return;
		await cleanupHeight();
	});
	afterAll(async () => {
		if (!HAS_DB) return;
		await cleanupHeight();
	});

	test("waits for the cluster apply lock instead of writing under another writer", async () => {
		const db = getSourceDb();
		let settled = false;
		let ingest: Promise<unknown> | null = null;

		await db.connection().execute(async (holder) => {
			await sql`SELECT pg_advisory_lock(${OBSERVER_APPLY_LOCK_KEY})`.execute(
				holder,
			);
			try {
				ingest = ingestNewBlock(payload(), { network: NETWORK }).finally(() => {
					settled = true;
				});
				await new Promise((resolve) => setTimeout(resolve, 300));
				expect(settled).toBe(false);
			} finally {
				await sql`SELECT pg_advisory_unlock(${OBSERVER_APPLY_LOCK_KEY})`.execute(
					holder,
				);
			}
		});

		await ingest;
		expect(settled).toBe(true);
	});

	test("does not wait on a lock its caller already holds", async () => {
		const result = await ingestNewBlock(payload(), {
			network: NETWORK,
			applyLockHeld: true,
		});
		expect(result.status).toBe("ok");
	});
});
