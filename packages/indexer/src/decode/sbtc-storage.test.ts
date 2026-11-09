import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { type SbtcEventRow, fillDepositRecipients } from "./sbtc-storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

function deposit(overrides: Partial<SbtcEventRow>): SbtcEventRow {
	return {
		cursor: "100:7",
		block_height: 100,
		block_time: new Date("2026-11-01T05:17:31Z"),
		tx_id: "0xdep",
		tx_index: 3,
		event_index: 7,
		topic: "completed-deposit",
		request_id: null,
		amount: "14025",
		sender: null,
		recipient: null,
		recipient_btc_version: null,
		recipient_btc_hashbytes: null,
		bitcoin_txid: "0x5a25",
		output_index: 0,
		sweep_txid: null,
		burn_hash: null,
		burn_height: null,
		signer_bitmap: null,
		max_fee: null,
		fee: null,
		block_height_at_request: null,
		governance_contract_type: null,
		governance_new_contract: null,
		signer_aggregate_pubkey: null,
		signer_threshold: null,
		signer_address: null,
		signer_keys_count: null,
		source_cursor: "100:7",
		...overrides,
	};
}

describe.skipIf(!HAS_DB)("fillDepositRecipients (DB)", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) throw new Error("missing db");
		await sql`TRUNCATE sbtc_token_events`.execute(db);
		await db
			.insertInto("sbtc_token_events")
			.values({
				cursor: "100:6",
				block_height: 100,
				block_time: new Date("2026-11-01T05:17:31Z"),
				tx_id: "0xdep",
				tx_index: 3,
				event_index: 6,
				event_type: "mint",
				sender: null,
				recipient: "SP34HBPH4EHPVW0NSXBCV5Z27FAGTC62RV5Y9Y9MR",
				amount: "14025",
				memo: null,
				source_cursor: "100:6",
			})
			.execute();
	});

	test("fills a deposit's recipient from the decoded mint before it", async () => {
		const rows = [deposit({})];
		await fillDepositRecipients(rows, { db: db ?? undefined });
		expect(rows[0]?.recipient).toBe(
			"SP34HBPH4EHPVW0NSXBCV5Z27FAGTC62RV5Y9Y9MR",
		);
	});

	test("leaves the recipient null when no mint pairs with the deposit", async () => {
		const rows = [deposit({ amount: "99" })];
		await fillDepositRecipients(rows, { db: db ?? undefined });
		expect(rows[0]?.recipient).toBeNull();
	});
});
