import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Pox4FunctionName } from "@secondlayer/shared/db/schema";
import { getPoxCyclesResponse } from "./pox-cycles.ts";
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

	// NOTE: the single-cycle read (`getPoxCycleResponse` / `readPoxCycle`) cannot
	// be covered here — its query selects `m.val` and `f.function_breakdown`
	// alongside aggregates with no GROUP BY, so Postgres rejects it outright
	// (42803) on every call. That is a pre-existing defect independent of the
	// era flag; the flag is threaded through the same `normalizeCycle` path the
	// list read exercises above.
});
