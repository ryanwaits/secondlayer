import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { InsertEvent } from "@secondlayer/shared/db/schema";
import { recordDeadLetterEvents } from "./ingest.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("recordDeadLetterEvents (DB-gated)", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM dead_letter_events`.execute(db);
	});

	test("records only malformed payloads, leaving valid ones untouched", async () => {
		if (!db) throw new Error("missing db");

		const valid: InsertEvent = {
			tx_id: "0xvalid",
			block_height: 10,
			event_index: 0,
			type: "ft_transfer_event",
			data: {
				asset_identifier: "SP1.token::tok",
				sender: "SP1",
				recipient: "SP2",
				amount: "5",
			},
		};
		const malformed: InsertEvent = {
			tx_id: "0xbad",
			block_height: 10,
			event_index: 1,
			type: "ft_transfer_event",
			data: { asset_identifier: "SP1.token::tok", sender: "SP1" },
		};

		await recordDeadLetterEvents(db, [valid, malformed]);

		const rows = await db
			.selectFrom("dead_letter_events")
			.selectAll()
			.execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.tx_id).toBe("0xbad");
		expect(rows[0]?.event_type).toBe("ft_transfer_event");
		expect(rows[0]?.reason).toBe("missing or non-string field: recipient");
	});

	test("writes nothing when every payload is valid", async () => {
		if (!db) throw new Error("missing db");

		await recordDeadLetterEvents(db, [
			{
				tx_id: "0xok",
				block_height: 11,
				event_index: 0,
				type: "stx_mint_event",
				data: { recipient: "SP2", amount: "100" },
			},
		]);

		const count = await db
			.selectFrom("dead_letter_events")
			.select(db.fn.countAll().as("n"))
			.executeTakeFirst();
		expect(Number(count?.n)).toBe(0);
	});
});
