import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	creditCredits,
	getCredits,
	usdToMicros,
} from "./db/queries/account-credits.ts";
import {
	PLAY_GRANT_USD_MICROS,
	RUNNING_USD_MICROS_PER_DAY,
	debitHostedMeter,
	deliveryCost,
	indexingCost,
	onBlocksProcessed,
	resumeHostedResources,
	storageDailyCost,
} from "./hosted-meters.ts";

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

async function insertSubgraph(
	accountId: string,
	status: string,
): Promise<string> {
	const name = `hosted-meter-${crypto.randomUUID().slice(0, 8)}`;
	subgraphNames.push(name);
	await db
		.insertInto("subgraphs")
		.values({
			name,
			status,
			definition: {},
			schema_hash: "test",
			handler_path: "test",
			schema_name: `subgraph_hosted_meter_${crypto.randomUUID().slice(0, 8)}`,
			account_id: accountId,
			last_processed_block: 0,
			database_url_enc: null,
		})
		.execute();
	return name;
}

let accountId: string;

beforeEach(async () => {
	if (!HAS_DB) return;
	accountId = await makeAccount();
});

afterEach(async () => {
	if (!HAS_DB) return;
	if (accountId) {
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
	}
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (subgraphNames.length > 0) {
		await db
			.deleteFrom("subgraphs")
			.where("name", "in", subgraphNames)
			.execute();
	}
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe("hosted meter prices", () => {
	test("indexingCost", () => {
		expect(indexingCost(0)).toBe(0n);
		expect(indexingCost(8_700_000)).toBe(8_700_000n);
	});

	test("deliveryCost", () => {
		expect(deliveryCost(1)).toBe(100n);
		expect(deliveryCost(10_000)).toBe(1_000_000n);
	});

	test("storageDailyCost", () => {
		expect(storageDailyCost(0n)).toBe(0n);
		expect(storageDailyCost(1_000_000_000n)).toBe(16_666n);
	});

	test("running fee is $3 per 30-day month", () => {
		expect(RUNNING_USD_MICROS_PER_DAY * 30n).toBe(3_000_000n);
	});

	test("PLAY_GRANT_USD_MICROS is $10", () => {
		expect(PLAY_GRANT_USD_MICROS).toBe(10_000_000n);
		expect(PLAY_GRANT_USD_MICROS).toBe(usdToMicros(10));
	});
});

describe.skipIf(!HAS_DB)("debitHostedMeter", () => {
	test("debits on success and refuses overdraw", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		expect(await debitHostedMeter(db, accountId, 100n)).toBe(true);
		expect(await getCredits(db, accountId)).toBe(999_900n);

		expect(await debitHostedMeter(db, accountId, 2_000_000n)).toBe(false);
		expect(await getCredits(db, accountId)).toBe(999_900n);
	});
});

describe.skipIf(!HAS_DB)("pause on empty balance", () => {
	test("onBlocksProcessed pauses subgraph when debit fails", async () => {
		const name = await insertSubgraph(accountId, "active");
		const ok = await onBlocksProcessed(accountId, 1, name);
		expect(ok).toBe(false);
		const sg = await db
			.selectFrom("subgraphs")
			.select("status")
			.where("name", "=", name)
			.where("account_id", "=", accountId)
			.executeTakeFirstOrThrow();
		expect(sg.status).toBe("paused");
	});

	test("onBlocksProcessed returns true when cost is 0", async () => {
		const name = await insertSubgraph(accountId, "active");
		expect(await onBlocksProcessed(accountId, 0, name)).toBe(true);
		const sg = await db
			.selectFrom("subgraphs")
			.select("status")
			.where("name", "=", name)
			.where("account_id", "=", accountId)
			.executeTakeFirstOrThrow();
		expect(sg.status).toBe("active");
	});

	test("resumeHostedResources reactivates paused subgraphs", async () => {
		const name = await insertSubgraph(accountId, "paused");
		await resumeHostedResources(db, accountId);
		const sg = await db
			.selectFrom("subgraphs")
			.select("status")
			.where("name", "=", name)
			.where("account_id", "=", accountId)
			.executeTakeFirstOrThrow();
		expect(sg.status).toBe("active");
	});
});
