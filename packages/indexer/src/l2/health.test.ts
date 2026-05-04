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

	test("recent checkpoint movement is healthy even before decoded writes", async () => {
		if (!db) throw new Error("missing db");

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: 1000,
					canonical: true,
				},
				{
					height: 10,
					hash: "0x10",
					parent_hash: "0x09",
					burn_block_height: 110,
					timestamp: 2000,
					canonical: true,
				},
			])
			.execute();
		await writeDecoderCheckpoint({
			cursor: "1:4",
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
		});

		const health = await getL2DecoderHealth({
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
			now: new Date(),
		});

		expect(health).toMatchObject({
			status: "healthy",
			checkpoint: "1:4",
			checkpoint_recent: true,
			writes_recent: false,
			lag_seconds: 1000,
		});
	});
});
