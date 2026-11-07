import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registryClassifiedThrough } from "@secondlayer/shared/db/queries/contracts";

const HAS_DB = !!process.env.DATABASE_URL;
const DEPLOY_HEIGHT = 7;
const CONTRACT = "SP9.classified-through";
const TX = "0xclassified-through-tx";

describe.skipIf(!HAS_DB)("registryClassifiedThrough", () => {
	const db = HAS_DB ? getDb() : null;

	async function clean() {
		if (!db) return;
		await db
			.deleteFrom("contracts")
			.where("contract_id", "=", CONTRACT)
			.execute();
		await db.deleteFrom("transactions").where("tx_id", "=", TX).execute();
		await db.deleteFrom("blocks").where("height", "=", DEPLOY_HEIGHT).execute();
	}

	beforeEach(async () => {
		if (!db) return;
		await clean();
		await db
			.insertInto("blocks")
			.values({
				height: DEPLOY_HEIGHT,
				hash: "0xclassified-through-block",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values({
				tx_id: TX,
				block_height: DEPLOY_HEIGHT,
				tx_index: 0,
				type: "smart_contract",
				sender: "SP9",
				status: "success",
				contract_id: CONTRACT,
				raw_tx: "0x00",
			})
			.execute();
	});
	afterAll(clean);

	test("stops just below a deploy the registry has not discovered", async () => {
		if (!db) throw new Error("missing db");
		expect(await registryClassifiedThrough(db)).toBe(DEPLOY_HEIGHT - 1);
	});

	test("stops just below a deploy whose ABI is still pending", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values({
				contract_id: CONTRACT,
				deployer: "SP9",
				block_height: DEPLOY_HEIGHT,
				canonical: true,
				abi_status: "pending",
			})
			.execute();
		expect(await registryClassifiedThrough(db)).toBe(DEPLOY_HEIGHT - 1);
	});

	test("moves past a deploy once its ABI is fetched", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values({
				contract_id: CONTRACT,
				deployer: "SP9",
				block_height: DEPLOY_HEIGHT,
				canonical: true,
				abi_status: "fetched",
			})
			.execute();
		expect(await registryClassifiedThrough(db)).toBeGreaterThanOrEqual(
			DEPLOY_HEIGHT,
		);
	});
});
