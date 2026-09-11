import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { sql } from "kysely";
import {
	startPlayExpirySweepCron,
	sweepExpiredPlay,
} from "./play-expiry-sweep.ts";

describe("play expiry sweep cron", () => {
	let prev: string | undefined;

	beforeEach(() => {
		prev = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "oss";
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prev;
	});

	test("does not schedule in oss mode", () => {
		const stop = startPlayExpirySweepCron();
		stop();
		expect(typeof stop).toBe("function");
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];
const subgraphNames: string[] = [];

afterAll(async () => {
	if (!HAS_DB) return;
	if (subgraphNames.length > 0) {
		const rows = await db
			.selectFrom("subgraphs")
			.select("schema_name")
			.where("name", "in", subgraphNames)
			.execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "in", subgraphNames)
			.execute();
		for (const row of rows) {
			if (row.schema_name) {
				await sql`DROP SCHEMA IF EXISTS ${sql.id(row.schema_name)} CASCADE`.execute(
					db,
				);
			}
		}
	}
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe.skipIf(!HAS_DB)("sweepExpiredPlay", () => {
	test("deletes an expired play subgraph", async () => {
		const prev = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
		try {
			const ghost = await db
				.insertInto("accounts")
				.values({ email: null, ghost: true })
				.returning("id")
				.executeTakeFirstOrThrow();
			accountIds.push(ghost.id);
			const name = `play-exp-${crypto.randomUUID().slice(0, 8)}`;
			subgraphNames.push(name);
			const schemaName = `subgraph_play_exp_${crypto.randomUUID().slice(0, 8)}`;
			await db
				.insertInto("subgraphs")
				.values({
					name,
					status: "active",
					definition: {},
					schema_hash: "test",
					handler_path: "test",
					schema_name: schemaName,
					account_id: ghost.id,
					last_processed_block: 0,
					database_url_enc: null,
					expires_at: new Date(Date.now() - 1000),
				})
				.execute();

			const result = await sweepExpiredPlay(new Date());
			expect(result.deletedSubgraphs).toBeGreaterThanOrEqual(1);

			const leftover = await db
				.selectFrom("subgraphs")
				.select("id")
				.where("name", "=", name)
				.executeTakeFirst();
			expect(leftover).toBeUndefined();
		} finally {
			if (prev === undefined) delete process.env.INSTANCE_MODE;
			else process.env.INSTANCE_MODE = prev;
		}
	});
});
