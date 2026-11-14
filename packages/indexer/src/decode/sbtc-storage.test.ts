import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { SBTC_ASSET_IDENTIFIER_MAINNET } from "@secondlayer/stacks/sbtc";
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

const MINT_RECIPIENT = "SP34HBPH4EHPVW0NSXBCV5Z27FAGTC62RV5Y9Y9MR";

function mint(overrides: Record<string, unknown> = {}) {
	return {
		cursor: "100:6",
		block_height: 100,
		tx_id: "0xdep",
		tx_index: 3,
		event_index: 6,
		event_type: "ft_mint",
		canonical: true,
		contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
		sender: null,
		recipient: MINT_RECIPIENT,
		amount: "14025",
		asset_identifier: SBTC_ASSET_IDENTIFIER_MAINNET,
		value: null,
		memo: null,
		...overrides,
	};
}

describe.skipIf(!HAS_DB)("fillDepositRecipients (DB)", () => {
	const db = HAS_DB ? getDb() : null;

	async function seed(overrides: Record<string, unknown> = {}) {
		if (!db) throw new Error("missing db");
		await db.insertInto("decoded_events").values(mint(overrides)).execute();
	}

	beforeEach(async () => {
		if (!db) throw new Error("missing db");
		await sql`DELETE FROM decoded_events WHERE tx_id = '0xdep'`.execute(db);
	});

	test("fills a deposit's recipient from the decoded mint before it", async () => {
		await seed();
		const rows = [deposit({})];
		await fillDepositRecipients(rows, { db: db ?? undefined });
		expect(rows[0]?.recipient).toBe(MINT_RECIPIENT);
	});

	test("leaves the recipient null when no mint pairs with the deposit", async () => {
		await seed();
		const rows = [deposit({ amount: "99" })];
		await fillDepositRecipients(rows, { db: db ?? undefined });
		expect(rows[0]?.recipient).toBeNull();
	});

	test("ignores a mint of another asset at the same position", async () => {
		await seed({ asset_identifier: "SP1.other-token::other" });
		const rows = [deposit({})];
		await fillDepositRecipients(rows, { db: db ?? undefined });
		expect(rows[0]?.recipient).toBeNull();
	});
});
