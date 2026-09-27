import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { rederiveRegistry } from "./rederive-registry.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_601;
const CONTRACT_ID = "SP9REDERIVE.repaired-contract";
const TX_ID = "0xrederive-registry-tx";

describe.skipIf(!HAS_DB)("rederiveRegistry", () => {
	const db = HAS_DB ? getDb() : null;

	async function cleanup() {
		if (!db) return;
		await db
			.deleteFrom("contracts")
			.where("contract_id", "=", CONTRACT_ID)
			.execute();
		await db.deleteFrom("transactions").where("tx_id", "=", TX_ID).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
	}

	beforeEach(cleanup);
	afterAll(cleanup);

	test("a re-derive after a source repair registers the restored deploy transaction", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xrederiveregistryblock",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		// Simulates repair-from-journal.ts --apply having just restored this
		// smart_contract deploy transaction — it exists in `transactions` but
		// has never been through discovery.
		await db
			.insertInto("transactions")
			.values({
				tx_id: TX_ID,
				block_height: H,
				tx_index: 0,
				type: "smart_contract",
				sender: "SP9REDERIVE",
				status: "success",
				contract_id: CONTRACT_ID,
				raw_tx: "0x00",
			})
			.execute();

		const before = await db
			.selectFrom("contracts")
			.select("contract_id")
			.where("contract_id", "=", CONTRACT_ID)
			.execute();
		expect(before).toHaveLength(0);

		const result = await rederiveRegistry(db, { limit: 500 });
		expect(result.discovered).toBeGreaterThanOrEqual(1);
		expect(result.limitReached).toBe(false);

		const after = await db
			.selectFrom("contracts")
			.select(["contract_id", "deployer", "canonical"])
			.where("contract_id", "=", CONTRACT_ID)
			.execute();
		expect(after).toEqual([
			{ contract_id: CONTRACT_ID, deployer: "SP9REDERIVE", canonical: true },
		]);
	});
});
