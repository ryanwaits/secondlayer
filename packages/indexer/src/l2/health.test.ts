import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { getL2DecoderHealth } from "./health.ts";
import {
	NFT_TRANSFER_DECODER_NAME,
	writeDecoderCheckpoint,
} from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("L2 decoder health", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
		await sql`DELETE FROM l2_decoder_checkpoints`.execute(db);
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	test("checkpoint at tip with recent heartbeat is healthy", async () => {
		if (!db) throw new Error("missing db");
		const now = new Date();
		const nowSec = Math.floor(now.getTime() / 1000);

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: nowSec - 30,
					canonical: true,
				},
				{
					height: 10,
					hash: "0x10",
					parent_hash: "0x09",
					burn_block_height: 110,
					timestamp: nowSec,
					canonical: true,
				},
			])
			.execute();
		await writeDecoderCheckpoint({
			cursor: "10:0",
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
		});

		const health = await getL2DecoderHealth({
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
			now,
		});

		expect(health).toMatchObject({
			status: "healthy",
			checkpoint: "10:0",
			checkpoint_recent: true,
			writes_recent: false,
		});
	});

	test("stuck mid-history with heartbeat but no writes is UNHEALTHY (bug 1)", async () => {
		if (!db) throw new Error("missing db");
		const now = new Date();
		const nowSec = Math.floor(now.getTime() / 1000);

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: nowSec - 10_000_000,
					canonical: true,
				},
				{
					height: 10,
					hash: "0x10",
					parent_hash: "0x09",
					burn_block_height: 110,
					timestamp: nowSec,
					canonical: true,
				},
			])
			.execute();
		// Heartbeat fresh (writeDecoderCheckpoint stamps updated_at=now()),
		// checkpoint is far from tip, no decoded writes — classic stall.
		await writeDecoderCheckpoint({
			cursor: "1:0",
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
		});

		const health = await getL2DecoderHealth({
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
			now,
		});

		expect(health).toMatchObject({
			status: "unhealthy",
			checkpoint_recent: true,
			writes_recent: false,
		});
		expect(health.lag_seconds).toBeGreaterThan(60);
	});

	test("checkpoint block with timestamp=0 returns lag_seconds=null (bug 2)", async () => {
		if (!db) throw new Error("missing db");
		const now = new Date();
		const nowSec = Math.floor(now.getTime() / 1000);

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					// Bulk-import artifact: timestamp = 0. Without the guard, lag
					// would be ~now (≈1.78B seconds at 2026 wall clock).
					timestamp: 0,
					canonical: true,
				},
				{
					height: 10,
					hash: "0x10",
					parent_hash: "0x09",
					burn_block_height: 110,
					timestamp: nowSec,
					canonical: true,
				},
			])
			.execute();
		await writeDecoderCheckpoint({
			cursor: "1:0",
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
		});

		const health = await getL2DecoderHealth({
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
			now,
		});

		expect(health.lag_seconds).toBeNull();
	});

	test("missing checkpoint reports unhealthy with no heartbeat", async () => {
		if (!db) throw new Error("missing db");
		const now = new Date();
		const nowSec = Math.floor(now.getTime() / 1000);

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: nowSec,
					canonical: true,
				},
			])
			.execute();
		// No checkpoint row.
		const health = await getL2DecoderHealth({
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
			now,
		});

		expect(health).toMatchObject({
			status: "unhealthy",
			checkpoint: null,
			checkpoint_recent: false,
		});
	});
});
