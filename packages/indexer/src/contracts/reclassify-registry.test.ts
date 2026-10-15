import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb, jsonb } from "@secondlayer/shared/db";
import { SIP010_ABI } from "@secondlayer/stacks/clarity";
import { reclassifyRegistry } from "./reclassify-registry.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TOKEN_ID = "SP9RECLASS.node-token";
const PLAIN_ID = "SP9RECLASS.not-a-token";
const IDS = [TOKEN_ID, PLAIN_ID];
const STALE = new Date("2020-01-01T00:00:00Z");

// Node contract-interface spells read-only access `read_only`.
const NODE_TOKEN_ABI = {
	...SIP010_ABI,
	functions: SIP010_ABI.functions.map((f) => ({
		...f,
		access: f.access === "read-only" ? "read_only" : f.access,
	})),
	fungible_tokens: [{ name: "token" }],
};
const PLAIN_ABI = {
	functions: [
		{ name: "do-thing", access: "public", args: [], outputs: "bool" },
	],
};

describe.skipIf(!HAS_DB)("reclassifyRegistry", () => {
	const db = HAS_DB ? getDb() : null;

	async function cleanup() {
		if (!db) return;
		await db.deleteFrom("contracts").where("contract_id", "in", IDS).execute();
	}

	async function seed() {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values(
				[
					[TOKEN_ID, NODE_TOKEN_ABI],
					[PLAIN_ID, PLAIN_ABI],
				].map(([contract_id, abi]) => ({
					contract_id: contract_id as string,
					deployer: "SP9RECLASS",
					block_height: 1,
					abi: jsonb(abi),
					abi_status: "fetched",
					abi_fetched_at: STALE,
				})),
			)
			.execute();
	}

	async function row(id: string) {
		if (!db) throw new Error("missing db");
		return db
			.selectFrom("contracts")
			.select(["inferred_standards", "abi_fetched_at"])
			.where("contract_id", "=", id)
			.executeTakeFirstOrThrow();
	}

	beforeEach(async () => {
		await cleanup();
		await seed();
	});
	afterAll(cleanup);

	test("re-classifies a stored node ABI as sip-010 and bumps abi_fetched_at", async () => {
		if (!db) throw new Error("missing db");
		const result = await reclassifyRegistry(db, { batch: 1 });
		expect(result.changed).toBeGreaterThanOrEqual(1);

		const token = await row(TOKEN_ID);
		expect(token.inferred_standards).toEqual(["sip-010"]);
		expect(token.abi_fetched_at?.getTime()).toBeGreaterThan(STALE.getTime());
	});

	test("a second run changes nothing for already-classified rows", async () => {
		if (!db) throw new Error("missing db");
		await reclassifyRegistry(db);
		const first = await row(TOKEN_ID);
		await reclassifyRegistry(db);
		const second = await row(TOKEN_ID);
		expect(second.inferred_standards).toEqual(["sip-010"]);
		expect(second.abi_fetched_at?.getTime()).toBe(
			first.abi_fetched_at?.getTime(),
		);
	});

	test("dry run writes nothing", async () => {
		if (!db) throw new Error("missing db");
		const result = await reclassifyRegistry(db, { dryRun: true });
		expect(result.byStandard["sip-010"]).toBeGreaterThanOrEqual(1);

		const token = await row(TOKEN_ID);
		expect(token.inferred_standards).toEqual([]);
		expect(token.abi_fetched_at?.getTime()).toBe(STALE.getTime());
	});

	test("a non-token ABI stays empty and untouched", async () => {
		if (!db) throw new Error("missing db");
		await reclassifyRegistry(db);
		const plain = await row(PLAIN_ID);
		expect(plain.inferred_standards).toEqual([]);
		expect(plain.abi_fetched_at?.getTime()).toBe(STALE.getTime());
	});
});
