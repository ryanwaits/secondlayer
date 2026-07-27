import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Pox4FunctionName } from "@secondlayer/shared/db/schema";
import { getPoxCyclesResponse, readPoxCycle } from "./pox-cycles.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

const ERA_NOTE =
	"PoX-4 ended at the epoch 4.0 activation; these cycles are final. PoX-5 era data is at /v1/index/pox5/events.";

function params(query = "") {
	return new URL(`http://localhost/v1/index/pox/cycles${query}`).searchParams;
}

function call(
	cursor: string,
	blockHeight: number,
	rewardCycle: number,
	functionName: Pox4FunctionName = "stack-stx",
) {
	return {
		cursor,
		block_height: blockHeight,
		block_time: new Date(1_700_000_000_000),
		burn_block_height: blockHeight + 10_000,
		tx_id: `0x${cursor}`,
		tx_index: 0,
		function_name: functionName,
		caller: "SP1",
		stacker: "SP1",
		delegate_to: null,
		amount_ustx: "1000000",
		lock_period: 6,
		pox_addr_version: 4,
		pox_addr_hashbytes: "0xabcd",
		pox_addr_btc: `bc1q${blockHeight}`,
		start_cycle: rewardCycle,
		end_cycle: rewardCycle + 6,
		signer_key: null,
		signer_signature: null,
		auth_id: null,
		max_amount: null,
		reward_cycle: rewardCycle,
		aggregated_amount_ustx: null,
		aggregated_signer_index: null,
		auth_period: null,
		auth_topic: null,
		auth_allowed: null,
		result_ok: true,
		result_raw: "0x07",
		canonical: true,
		source_cursor: cursor,
	};
}

describe.skipIf(!HAS_DB)("PoX cycles and the pox-4 era", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox4_calls`.execute(db);
		await db
			.insertInto("pox4_calls")
			.values([call("9000:0", 9000, 100), call("9100:0", 9100, 101)])
			.execute();
	});

	test("the last pox-4 cycle is current while the era is open", async () => {
		const response = await getPoxCyclesResponse({
			query: params(),
			tip: TIP,
			decoderEnabled: true,
			eraClosed: false,
		});
		const latest = response.cycles.find((c) => c.reward_cycle === 101);
		expect(latest?.is_current).toBe(true);
		expect("notes" in response).toBe(false);
	});

	test("no cycle is current once the era closed, and the list says why", async () => {
		const response = await getPoxCyclesResponse({
			query: params(),
			tip: TIP,
			decoderEnabled: true,
			eraClosed: true,
		});
		expect(response.cycles.length).toBeGreaterThan(0);
		expect(response.cycles.every((c) => c.is_current === false)).toBe(true);
		expect(response.notes).toBe(ERA_NOTE);
	});
});

// The single-cycle read used to select `m.val` and `f.function_breakdown`
// alongside aggregates with no GROUP BY, so Postgres rejected it at plan time
// (42803) on every call and the endpoint 500'd for every input. These cases run
// the real SQL so the grouping cannot silently regress.
describe.skipIf(!HAS_DB)("the single-cycle read against Postgres", () => {
	const db = HAS_DB ? getDb() : null;
	const CURSORS = ["999001:0", "999003:0"];

	async function removeFixtures() {
		if (!db) return;
		await db.deleteFrom("pox4_calls").where("cursor", "in", CURSORS).execute();
	}

	beforeAll(async () => {
		if (!db) return;
		await removeFixtures();
		await db
			.insertInto("pox4_calls")
			.values([
				call("999001:0", 999_001, 999_001),
				{ ...call("999003:0", 999_003, 999_003), canonical: false },
			])
			.execute();
	});

	afterAll(removeFixtures);

	test("a known cycle resolves instead of erroring on the ungrouped aggregate", async () => {
		if (!db) return;
		const cycle = await readPoxCycle(999_001, db);
		expect(cycle).not.toBeNull();
		expect(cycle?.reward_cycle).toBe(999_001);
		expect(cycle?.action_count).toBe(1);
		expect(cycle?.function_breakdown).toEqual([
			{ function_name: "stack-stx", count: 1 },
		]);
	});

	test("an unknown cycle returns null so the route can answer 404", async () => {
		if (!db) return;
		expect(await readPoxCycle(999_002, db)).toBeNull();
	});

	test("a cycle with only non-canonical rows returns null", async () => {
		if (!db) return;
		expect(await readPoxCycle(999_003, db)).toBeNull();
	});
});
