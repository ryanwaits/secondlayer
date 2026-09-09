import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	upsertBnsName,
	upsertBnsNamespace,
	writeBnsMarketplaceEvents,
	writeBnsNameEvents,
	writeBnsNamespaceEvents,
} from "./bns-storage.ts";
import {
	applyBnsBlockTimeRepair,
	parseArgs,
	reportBnsBlockTimeRepair,
} from "./repair-bns-block-time.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 99_100_001;
const H_HUSK = 99_100_002;
const WALL = new Date("2026-05-09T20:25:52.081Z");
const CHAIN_TS = 1_700_000_000;
const FQN = "repair-test.btc";
const NS = "repair-test-ns";

describe("parseArgs", () => {
	test("dry-run is the default", () => {
		expect(parseArgs([])).toEqual({ apply: false });
	});

	test("--apply flips the write", () => {
		expect(parseArgs(["--apply"])).toEqual({ apply: true });
	});

	test("unknown args throw", () => {
		expect(() => parseArgs(["--force"])).toThrow("unknown arg: --force");
	});
});

describe.skipIf(!HAS_DB)("repairBnsBlockTime", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("bns_names").where("fqn", "=", FQN).execute();
		await db.deleteFrom("bns_namespaces").where("namespace", "=", NS).execute();
		await db
			.deleteFrom("bns_name_events")
			.where("block_height", "in", [H, H_HUSK])
			.execute();
		await db
			.deleteFrom("bns_namespace_events")
			.where("block_height", "in", [H, H_HUSK])
			.execute();
		await db
			.deleteFrom("bns_marketplace_events")
			.where("block_height", "in", [H, H_HUSK])
			.execute();
		await db.deleteFrom("blocks").where("height", "in", [H, H_HUSK]).execute();
	});

	afterEach(async () => {
		if (!db) return;
		await db.deleteFrom("bns_names").where("fqn", "=", FQN).execute();
		await db.deleteFrom("bns_namespaces").where("namespace", "=", NS).execute();
		await db
			.deleteFrom("bns_name_events")
			.where("block_height", "in", [H, H_HUSK])
			.execute();
		await db
			.deleteFrom("bns_namespace_events")
			.where("block_height", "in", [H, H_HUSK])
			.execute();
		await db
			.deleteFrom("bns_marketplace_events")
			.where("block_height", "in", [H, H_HUSK])
			.execute();
		await db.deleteFrom("blocks").where("height", "in", [H, H_HUSK]).execute();
	});

	test("rewrites wall-clock from blocks.timestamp and skips timestamp=0 husks", async () => {
		if (!db) throw new Error("missing test db");

		await db
			.insertInto("blocks")
			.values([
				{
					height: H,
					hash: "0xrepair-ok",
					parent_hash: "0xparent",
					burn_block_height: 1,
					timestamp: CHAIN_TS,
					canonical: true,
				},
				{
					height: H_HUSK,
					hash: "0xrepair-husk",
					parent_hash: "0xparent",
					burn_block_height: 1,
					timestamp: 0,
					canonical: true,
				},
			])
			.execute();

		await writeBnsNameEvents(
			[
				nameEvent({
					cursor: `${H}:0`,
					block_height: H,
					event_index: 0,
					fqn: FQN,
					name: "repair-test",
				}),
				nameEvent({
					cursor: `${H_HUSK}:0`,
					block_height: H_HUSK,
					event_index: 0,
					fqn: "husk.btc",
					name: "husk",
				}),
			],
			{ db },
		);
		await writeBnsNamespaceEvents(
			[namespaceEvent({ cursor: `${H}:1`, block_height: H, event_index: 1 })],
			{ db },
		);
		await writeBnsMarketplaceEvents(
			[marketplaceEvent({ cursor: `${H}:2`, block_height: H, event_index: 2 })],
			{ db },
		);
		await upsertBnsName(
			{
				fqn: FQN,
				namespace: "btc",
				name: "repair-test",
				owner: "SP1",
				bns_id: "1",
				registered_at: H,
				renewal_height: null,
				last_event_cursor: `${H}:0`,
				last_event_at: WALL,
			},
			{ db },
		);
		await upsertBnsNamespace(
			{
				namespace: NS,
				manager: null,
				manager_frozen: false,
				price_frozen: false,
				lifetime: null,
				launched_at: H,
				last_event_cursor: `${H}:1`,
				last_event_at: WALL,
			},
			{ db },
		);

		const before = await reportBnsBlockTimeRepair(db);
		expect(before.nameEvents.wouldUpdate).toBeGreaterThanOrEqual(1);
		expect(before.nameEvents.husks).toBeGreaterThanOrEqual(1);
		expect(before.names.wouldUpdate).toBeGreaterThanOrEqual(1);
		expect(before.namespaces.wouldUpdate).toBeGreaterThanOrEqual(1);

		const applied = await applyBnsBlockTimeRepair(db);
		expect(applied.nameEvents).toBeGreaterThanOrEqual(1);
		expect(applied.namespaceEvents).toBeGreaterThanOrEqual(1);
		expect(applied.marketplaceEvents).toBeGreaterThanOrEqual(1);
		expect(applied.names).toBeGreaterThanOrEqual(1);
		expect(applied.namespaces).toBeGreaterThanOrEqual(1);

		const chainTime = new Date(CHAIN_TS * 1000);
		const ok = await db
			.selectFrom("bns_name_events")
			.select("block_time")
			.where("cursor", "=", `${H}:0`)
			.executeTakeFirst();
		expect(ok?.block_time).toEqual(chainTime);

		const husk = await db
			.selectFrom("bns_name_events")
			.select("block_time")
			.where("cursor", "=", `${H_HUSK}:0`)
			.executeTakeFirst();
		expect(husk?.block_time).toEqual(WALL);

		const name = await db
			.selectFrom("bns_names")
			.select("last_event_at")
			.where("fqn", "=", FQN)
			.executeTakeFirst();
		expect(name?.last_event_at).toEqual(chainTime);

		const after = await reportBnsBlockTimeRepair(db);
		expect(after.nameEvents.husks).toBe(before.nameEvents.husks);
		expect(after.nameEvents.wouldUpdate).toBeLessThan(
			before.nameEvents.wouldUpdate,
		);
	});
});

function nameEvent(overrides: {
	cursor: string;
	block_height: number;
	event_index: number;
	fqn: string;
	name: string;
}) {
	return {
		cursor: overrides.cursor,
		block_height: overrides.block_height,
		block_time: WALL,
		tx_id: "0xtx",
		tx_index: 0,
		event_index: overrides.event_index,
		topic: "new-name" as const,
		namespace: "btc",
		name: overrides.name,
		fqn: overrides.fqn,
		owner: "SP1",
		bns_id: "1",
		registered_at: overrides.block_height,
		imported_at: null,
		renewal_height: null,
		stx_burn: null,
		preordered_by: null,
		hashed_salted_fqn_preorder: null,
		source_cursor: overrides.cursor,
	};
}

function namespaceEvent(overrides: {
	cursor: string;
	block_height: number;
	event_index: number;
}) {
	return {
		cursor: overrides.cursor,
		block_height: overrides.block_height,
		block_time: WALL,
		tx_id: "0xtx",
		tx_index: 0,
		event_index: overrides.event_index,
		status: "launch" as const,
		namespace: NS,
		manager: null,
		manager_frozen: null,
		manager_transfers_disabled: null,
		price_function: null,
		price_frozen: null,
		lifetime: null,
		revealed_at: null,
		launched_at: overrides.block_height,
		source_cursor: overrides.cursor,
	};
}

function marketplaceEvent(overrides: {
	cursor: string;
	block_height: number;
	event_index: number;
}) {
	return {
		cursor: overrides.cursor,
		block_height: overrides.block_height,
		block_time: WALL,
		tx_id: "0xtx",
		tx_index: 0,
		event_index: overrides.event_index,
		action: "list-in-ustx" as const,
		bns_id: "1",
		price_ustx: "1000",
		commission: null,
		source_cursor: overrides.cursor,
	};
}
