import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { ingestNewBlock } from "./ingest.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_801;
const NETWORK = "state-writes-ingest-test";

/** Leave no canonical block behind: other suites assert the DB tip. */
async function cleanupHeight(): Promise<void> {
	const db = getSourceDb();
	await db.deleteFrom("state_writes").where("block_height", "=", H).execute();
	await db
		.deleteFrom("state_writes_archive")
		.where("block_height", "=", H)
		.execute();
	await db.deleteFrom("events").where("block_height", "=", H).execute();
	await db.deleteFrom("transactions").where("block_height", "=", H).execute();
	await db.deleteFrom("blocks").where("height", "=", H).execute();
	await db
		.deleteFrom("index_progress")
		.where("network", "=", NETWORK)
		.execute();
}

async function loadFixture(file: string): Promise<NewBlockPayload> {
	const url = new URL(`../test/fixtures/observer/${file}`, import.meta.url);
	const payload = (await Bun.file(url).json()) as NewBlockPayload;
	return { ...payload, block_height: H, block_hash: `0x${file}` };
}

async function stateWritesAtH() {
	return getSourceDb()
		.selectFrom("state_writes")
		.select(["ordinal", "tx_index", "key", "value_hex"])
		.where("block_height", "=", H)
		.orderBy("ordinal", "asc")
		.execute();
}

describe.skipIf(!HAS_DB)("ingest state_writes", () => {
	beforeEach(async () => {
		if (!HAS_DB) return;
		await cleanupHeight();
	});

	afterAll(async () => {
		if (!HAS_DB) return;
		await cleanupHeight();
	});

	test("opt-in /new_block persists every write on the node's ordinal, block-level writes with null tx_index", async () => {
		const payload = await loadFixture("new_block.state_writes.json");
		const result = await ingestNewBlock(payload, { network: NETWORK });
		expect(result.status).toBe("ok");

		expect(await stateWritesAtH()).toEqual(
			(payload.state_writes ?? []).map((w) => ({
				ordinal: w.ordinal,
				tx_index: w.tx_index,
				key: w.key,
				value_hex: w.value_hex,
			})),
		);
	});

	test("`*` /new_block with no state_writes field ingests and persists none", async () => {
		const payload = await loadFixture("new_block.star.json");
		expect("state_writes" in payload).toBe(false);

		const result = await ingestNewBlock(payload, { network: NETWORK });
		expect(result.status).toBe("ok");
		expect(result.transactions).toBe(1);
		expect(await stateWritesAtH()).toHaveLength(0);
	});

	test("opt-in empty state_writes array persists none", async () => {
		const payload = await loadFixture("new_block.state_writes.empty.json");
		const result = await ingestNewBlock(payload, { network: NETWORK });
		expect(result.status).toBe("ok");
		expect(await stateWritesAtH()).toHaveLength(0);
	});

	test("state_writes are owned by the height: a transaction sweep keeps them, a block sweep cascades them", async () => {
		// Child-range repair deletes `transactions` by height and restores them
		// from the archive; state_writes carry no tx FK, so they survive it.
		// bootstrap / repair-fork-block delete `blocks`; the FK cascades.
		const db = getSourceDb();
		const payload = await loadFixture("new_block.state_writes.json");
		await ingestNewBlock(payload, { network: NETWORK });
		expect(await stateWritesAtH()).toHaveLength(3);

		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		expect(await stateWritesAtH()).toHaveLength(3);

		await db.deleteFrom("blocks").where("height", "=", H).execute();
		expect(await stateWritesAtH()).toHaveLength(0);
	});
});
