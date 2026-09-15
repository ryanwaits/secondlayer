import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { ingestNewBlock } from "./ingest.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_201;
const NETWORK = "vm-ingest-test";

/** Leave no canonical block behind: other suites assert the DB tip. */
async function cleanupHeight(): Promise<void> {
	const db = getSourceDb();
	await db.deleteFrom("vm_events").where("block_height", "=", H).execute();
	await db
		.deleteFrom("vm_events_archive")
		.where("block_height", "=", H)
		.execute();
	await db.deleteFrom("events").where("block_height", "=", H).execute();
	await db.deleteFrom("events_archive").where("block_height", "=", H).execute();
	await db.deleteFrom("transactions").where("block_height", "=", H).execute();
	await db
		.deleteFrom("transactions_archive")
		.where("block_height", "=", H)
		.execute();
	await db.deleteFrom("blocks").where("height", "=", H).execute();
	await db
		.deleteFrom("index_progress")
		.where("network", "=", NETWORK)
		.execute();
}

async function loadFixture(file: string): Promise<NewBlockPayload> {
	const url = new URL(`../test/fixtures/observer/${file}`, import.meta.url);
	const payload = (await Bun.file(url).json()) as NewBlockPayload;
	return {
		...payload,
		block_height: H,
		block_hash: `0x${file}`,
	};
}

describe.skipIf(!HAS_DB)("ingest vm_events", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await cleanupHeight();
	});

	afterAll(async () => {
		if (!db) return;
		await cleanupHeight();
	});

	test("`*` /new_block persists classic events and does not write vm_events", async () => {
		if (!db) throw new Error("missing db");
		const payload = await loadFixture("new_block.star.json");
		expect("vm_events" in payload).toBe(false);

		const result = await ingestNewBlock(payload, { network: NETWORK });
		expect(result.status).toBe("ok");
		expect(result.events).toBe(1);

		const classic = await db
			.selectFrom("events")
			.select(["event_index", "type"])
			.where("block_height", "=", H)
			.execute();
		const vm = await db
			.selectFrom("vm_events")
			.selectAll()
			.where("block_height", "=", H)
			.execute();

		expect(classic).toEqual([{ event_index: 0, type: "smart_contract_event" }]);
		expect(vm).toHaveLength(0);
	});

	test("opt-in /new_block persists remapped vm_events on the second clock", async () => {
		if (!db) throw new Error("missing db");
		const payload = await loadFixture("new_block.vm_events.json");

		const result = await ingestNewBlock(payload, { network: NETWORK });
		expect(result.status).toBe("ok");
		expect(result.events).toBe(1);

		const classic = await db
			.selectFrom("events")
			.select(["event_index", "type"])
			.where("block_height", "=", H)
			.execute();
		const vm = await db
			.selectFrom("vm_events")
			.select(["vm_event_index", "type"])
			.where("block_height", "=", H)
			.orderBy("vm_event_index", "asc")
			.execute();

		expect(classic).toEqual([{ event_index: 0, type: "smart_contract_event" }]);
		expect(vm).toEqual([
			{ vm_event_index: 0, type: "nested_contract_call" },
			{ vm_event_index: 1, type: "map_set" },
		]);
	});

	test("opt-in empty vm_events array writes nothing", async () => {
		if (!db) throw new Error("missing db");
		const payload = await loadFixture("new_block.vm_events.empty.json");
		expect(payload.vm_events).toEqual([]);
		await ingestNewBlock(payload, { network: NETWORK });
		const vm = await db
			.selectFrom("vm_events")
			.selectAll()
			.where("block_height", "=", H)
			.execute();
		expect(vm).toHaveLength(0);
	});

	test("deleting a height's transactions cascades its vm_events (sweeps never trip the FK)", async () => {
		// bootstrap / repair / repair-fork-block / cleanup-reorg-dupes delete
		// `events` then `transactions` by height and never name `vm_events`.
		// The vm FK cascades so those sweeps keep working once vm rows exist.
		if (!db) throw new Error("missing db");
		const payload = await loadFixture("new_block.vm_events.json");
		await ingestNewBlock(payload, { network: NETWORK });
		expect(
			await db
				.selectFrom("vm_events")
				.selectAll()
				.where("block_height", "=", H)
				.execute(),
		).toHaveLength(2);

		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		expect(
			await db
				.selectFrom("vm_events")
				.selectAll()
				.where("block_height", "=", H)
				.execute(),
		).toHaveLength(0);

		// bootstrap's `blocks` dataset truncation deletes the block outright
		// (transactions already cascade from blocks); vm rows must go with it.
		await ingestNewBlock(payload, { network: NETWORK });
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		expect(
			await db
				.selectFrom("transactions")
				.selectAll()
				.where("block_height", "=", H)
				.execute(),
		).toHaveLength(0);
		expect(
			await db
				.selectFrom("vm_events")
				.selectAll()
				.where("block_height", "=", H)
				.execute(),
		).toHaveLength(0);
	});

	test("all five types persist; index gap kept; sender null", async () => {
		if (!db) throw new Error("missing db");
		const payload = await loadFixture("new_block.vm_events.all_types.json");
		await ingestNewBlock(payload, { network: NETWORK });
		const vm = await db
			.selectFrom("vm_events")
			.select(["vm_event_index", "type", "data"])
			.where("block_height", "=", H)
			.orderBy("vm_event_index", "asc")
			.execute();
		expect(vm.map((r) => [Number(r.vm_event_index), r.type])).toEqual([
			[0, "nested_contract_call"],
			[2, "var_set"],
			[3, "map_insert"],
			[4, "map_set"],
			[5, "map_delete"],
		]);
		expect((vm[0]?.data as { sender: string | null }).sender).toBeNull();
	});
});
