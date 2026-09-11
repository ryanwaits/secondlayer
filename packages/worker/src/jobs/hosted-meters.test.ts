import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	creditCredits,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import { RUNNING_USD_MICROS_PER_DAY } from "@secondlayer/platform/hosted-meters";
import { getDb } from "@secondlayer/shared/db";
import { runHostedMeterDay, startHostedMetersCron } from "./hosted-meters.ts";

describe("hosted meters cron", () => {
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
		const stop = startHostedMetersCron();
		stop();
		expect(typeof stop).toBe("function");
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];
const subgraphNames: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({
			email: null,
			ghost: true,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

afterAll(async () => {
	if (!HAS_DB) return;
	if (subgraphNames.length > 0) {
		await db
			.deleteFrom("subgraphs")
			.where("name", "in", subgraphNames)
			.execute();
	}
	if (accountIds.length > 0) {
		await db
			.deleteFrom("hosted_meter_days")
			.where("account_id", "in", accountIds)
			.execute();
		await db
			.deleteFrom("account_credits")
			.where("account_id", "in", accountIds)
			.execute();
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe.skipIf(!HAS_DB)("runHostedMeterDay", () => {
	test("running fee is idempotent for the same day", async () => {
		const accountId = await makeAccount();
		const name = `hosted-meter-${crypto.randomUUID().slice(0, 8)}`;
		subgraphNames.push(name);
		await db
			.insertInto("subgraphs")
			.values({
				name,
				status: "active",
				definition: {},
				schema_hash: "test",
				handler_path: "test",
				schema_name: `subgraph_hosted_meter_${crypto.randomUUID().slice(0, 8)}`,
				account_id: accountId,
				last_processed_block: 0,
				database_url_enc: null,
			})
			.execute();
		await creditCredits(db, accountId, 1_000_000n);

		const now = new Date("2026-09-11T12:00:00Z");
		await runHostedMeterDay(now);
		const afterFirst = await getCredits(db, accountId);
		expect(afterFirst).toBe(1_000_000n - RUNNING_USD_MICROS_PER_DAY);

		await runHostedMeterDay(now);
		expect(await getCredits(db, accountId)).toBe(afterFirst);
	});
});
