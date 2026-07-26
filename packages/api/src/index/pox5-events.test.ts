import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, jsonb, sql } from "@secondlayer/shared/db";
import type { Pox5EventTopic } from "@secondlayer/shared/db";
import {
	type Pox5EventsReader,
	type ReadPox5EventsParams,
	getPox5EventsResponse,
	readPox5Events,
} from "./pox5-events.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;

// finalized_height deliberately below block_height so `?confirmed=true` clamps.
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

function eventsParams(query: string) {
	return new URL(`http://localhost/v1/index/pox5/events${query}`).searchParams;
}

const EMPTY_EVENTS: Pox5EventsReader = async () => ({
	events: [],
	next_cursor: null,
});

describe("PoX-5 events helpers", () => {
	test("adds a notes hint naming the env var when the decoder is disabled", async () => {
		const response = await getPox5EventsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readPox5Events: EMPTY_EVENTS,
			decoderEnabled: false,
		});
		expect(response.events).toEqual([]);
		expect(response.notes).toContain("POX5_DECODER_ENABLED");
	});

	test("omits notes when the decoder is enabled", async () => {
		const response = await getPox5EventsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readPox5Events: EMPTY_EVENTS,
			decoderEnabled: true,
		});
		expect(response.notes).toBeUndefined();
	});

	test("rejects an unknown topic, naming it", async () => {
		await expect(
			getPox5EventsResponse({
				query: eventsParams("?from_height=0&topic=stack-stx"),
				tip: TIP,
				readPox5Events: EMPTY_EVENTS,
			}),
		).rejects.toThrow(/unknown topic: stack-stx/);
	});

	test("passes a valid topic through to the reader untouched", async () => {
		const seen: ReadPox5EventsParams[] = [];
		await getPox5EventsResponse({
			query: eventsParams("?from_height=0&topic=register-for-bond"),
			tip: TIP,
			readPox5Events: async (params) => {
				seen.push(params);
				return { events: [], next_cursor: null };
			},
		});
		expect(seen[0]?.topic).toBe("register-for-bond");
	});

	test("?confirmed=true clamps to_height to finalized_height", async () => {
		const seen: ReadPox5EventsParams[] = [];
		await getPox5EventsResponse({
			query: eventsParams("?from_height=0&confirmed=true"),
			tip: TIP,
			readPox5Events: async (params) => {
				seen.push(params);
				return { events: [], next_cursor: null };
			},
		});
		expect(seen[0]?.toHeight).toBe(TIP.finalized_height);
	});

	test("default to_height is the tip when not confirmed", async () => {
		const seen: ReadPox5EventsParams[] = [];
		await getPox5EventsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readPox5Events: async (params) => {
				seen.push(params);
				return { events: [], next_cursor: null };
			},
		});
		expect(seen[0]?.toHeight).toBe(TIP.block_height);
	});

	test("rejects a malformed confirmed value", async () => {
		await expect(
			getPox5EventsResponse({
				query: eventsParams("?from_height=0&confirmed=banana"),
				tip: TIP,
				readPox5Events: EMPTY_EVENTS,
			}),
		).rejects.toThrow(/confirmed must be/);
	});

	test("a cursor past the tip echoes the cursor and never calls the reader", async () => {
		let calls = 0;
		const response = await getPox5EventsResponse({
			query: eventsParams("?from_cursor=40000:0"),
			tip: TIP,
			readPox5Events: async () => {
				calls += 1;
				return { events: [], next_cursor: null };
			},
		});
		expect(response.events).toEqual([]);
		expect(response.next_cursor).toBe("40000:0");
		expect(calls).toBe(0);
	});

	test("rejects cursor combined with from_height", async () => {
		await expect(
			getPox5EventsResponse({
				query: eventsParams("?cursor=100:0&from_height=50"),
				tip: TIP,
				readPox5Events: EMPTY_EVENTS,
			}),
		).rejects.toThrow(/mutually exclusive/);
	});

	test("rejects a non-integer bond_index", async () => {
		await expect(
			getPox5EventsResponse({
				query: eventsParams("?from_height=0&bond_index=abc"),
				tip: TIP,
				readPox5Events: EMPTY_EVENTS,
			}),
		).rejects.toThrow(/bond_index must be a non-negative integer/);
	});

	test("forwards the numeric filters as numbers", async () => {
		const seen: ReadPox5EventsParams[] = [];
		await getPox5EventsResponse({
			query: eventsParams("?from_height=0&bond_index=3&reward_cycle=97"),
			tip: TIP,
			readPox5Events: async (params) => {
				seen.push(params);
				return { events: [], next_cursor: null };
			},
		});
		expect(seen[0]?.bondIndex).toBe(3);
		expect(seen[0]?.rewardCycle).toBe(97);
	});
});

type SeedRow = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: Pox5EventTopic;
	staker?: string | null;
	signer?: string | null;
	signer_manager?: string | null;
	bond_index?: number | null;
	amount_ustx?: string | null;
	amount_sats?: string | null;
	reward_cycle?: number | null;
	first_reward_cycle?: number | null;
	unlock_cycle?: number | null;
	unlock_burn_height?: number | null;
	is_l1_lock?: boolean | null;
	signer_key?: string | null;
	data?: unknown;
	canonical?: boolean;
};

function seed(row: SeedRow) {
	return {
		cursor: row.cursor,
		block_height: row.block_height,
		block_time: new Date("2026-07-30T00:00:00.000Z"),
		tx_id: row.tx_id,
		tx_index: row.tx_index,
		event_index: row.event_index,
		topic: row.topic,
		staker: row.staker ?? null,
		signer: row.signer ?? null,
		signer_manager: row.signer_manager ?? null,
		bond_index: row.bond_index ?? null,
		amount_ustx: row.amount_ustx ?? null,
		amount_sats: row.amount_sats ?? null,
		reward_cycle: row.reward_cycle ?? null,
		first_reward_cycle: row.first_reward_cycle ?? null,
		unlock_cycle: row.unlock_cycle ?? null,
		unlock_burn_height: row.unlock_burn_height ?? null,
		is_l1_lock: row.is_l1_lock ?? null,
		signer_key: row.signer_key ?? null,
		data: jsonb(row.data ?? { topic: row.topic }),
		canonical: row.canonical ?? true,
		source_cursor: row.cursor,
	};
}

describe.skipIf(!HAS_DB)("PoX-5 events DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_events`.execute(db);
	});

	test("round-trips a stake row with every promoted column typed", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_events")
			.values([
				seed({
					cursor: "500:2",
					block_height: 500,
					tx_id: "0xstake",
					tx_index: 1,
					event_index: 2,
					topic: "stake",
					staker: "SP_STAKER",
					signer: "SP_SIGNER",
					signer_manager: "SP_MANAGER",
					bond_index: 4,
					// Beyond Number.MAX_SAFE_INTEGER — must survive as a string.
					amount_ustx: "9007199254740993",
					amount_sats: "12345678901234567890",
					reward_cycle: 97,
					first_reward_cycle: 98,
					unlock_cycle: 104,
					unlock_burn_height: 980_000,
					is_l1_lock: true,
					signer_key: "0xabcd",
					data: {
						topic: "stake",
						"btc-lockup": { "unlock-height": "980000", sats: "500000" },
					},
				}),
			])
			.execute();

		const result = await readPox5Events({
			db,
			fromHeight: 0,
			toHeight: 1000,
			limit: 50,
		});
		const event = result.events[0];
		expect(event).toBeDefined();
		if (!event) throw new Error("no event");
		expect(event.cursor).toBe("500:2");
		expect(event.block_height).toBe(500);
		expect(event.tx_index).toBe(1);
		expect(event.event_index).toBe(2);
		expect(event.topic).toBe("stake");
		expect(event.staker).toBe("SP_STAKER");
		expect(event.signer_manager).toBe("SP_MANAGER");
		// bigint-safe: strings, not lossy numbers.
		expect(event.amount_ustx).toBe("9007199254740993");
		expect(event.amount_sats).toBe("12345678901234567890");
		// BIGINT columns come back as strings from the driver; normalize coerces.
		expect(event.bond_index).toBe(4);
		expect(event.unlock_burn_height).toBe(980_000);
		expect(event.reward_cycle).toBe(97);
		expect(event.first_reward_cycle).toBe(98);
		expect(event.unlock_cycle).toBe(104);
		expect(event.is_l1_lock).toBe(true);
		expect(event.signer_key).toBe("0xabcd");
		expect(event.block_time).toBe("2026-07-30T00:00:00.000Z");
		// JSONB arrives parsed, not a string, and keeps its nested shape.
		expect(typeof event.data).toBe("object");
		expect(
			(event.data as { "btc-lockup": { sats: string } })["btc-lockup"].sats,
		).toBe("500000");
		expect(result.next_cursor).toBe("500:2");
	});

	test("keyset pagination is stable across a page boundary within one block", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_events")
			.values([
				seed({
					cursor: "600:0",
					block_height: 600,
					tx_id: "0xa",
					tx_index: 0,
					event_index: 0,
					topic: "register-for-bond",
				}),
				seed({
					cursor: "600:1",
					block_height: 600,
					tx_id: "0xa",
					tx_index: 0,
					event_index: 1,
					topic: "register-signer",
				}),
				seed({
					cursor: "600:2",
					block_height: 600,
					tx_id: "0xa",
					tx_index: 0,
					event_index: 2,
					topic: "stake",
				}),
			])
			.execute();

		const first = await readPox5Events({
			db,
			fromHeight: 0,
			toHeight: 1000,
			limit: 2,
		});
		expect(first.events.map((e) => e.cursor)).toEqual(["600:0", "600:1"]);
		expect(first.next_cursor).toBe("600:1");

		const second = await readPox5Events({
			db,
			fromHeight: 0,
			toHeight: 1000,
			limit: 2,
			after: { block_height: 600, event_index: 1 },
		});
		// Third row only — the boundary row is not repeated.
		expect(second.events.map((e) => e.cursor)).toEqual(["600:2"]);
	});

	test("excludes non-canonical rows", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_events")
			.values([
				seed({
					cursor: "700:0",
					block_height: 700,
					tx_id: "0xok",
					tx_index: 0,
					event_index: 0,
					topic: "unstake",
				}),
				seed({
					cursor: "701:0",
					block_height: 701,
					tx_id: "0xorphan",
					tx_index: 0,
					event_index: 0,
					topic: "unstake",
					canonical: false,
				}),
			])
			.execute();

		const result = await readPox5Events({
			db,
			fromHeight: 0,
			toHeight: 1000,
			limit: 50,
		});
		expect(result.events.map((e) => e.cursor)).toEqual(["700:0"]);
	});

	test("filters by staker", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_events")
			.values([
				seed({
					cursor: "800:0",
					block_height: 800,
					tx_id: "0x1",
					tx_index: 0,
					event_index: 0,
					topic: "stake",
					staker: "SP_ALICE",
				}),
				seed({
					cursor: "801:0",
					block_height: 801,
					tx_id: "0x2",
					tx_index: 0,
					event_index: 0,
					topic: "stake",
					staker: "SP_BOB",
				}),
				seed({
					cursor: "802:0",
					block_height: 802,
					tx_id: "0x3",
					tx_index: 0,
					event_index: 0,
					topic: "stake-update",
					staker: "SP_ALICE",
				}),
			])
			.execute();

		const result = await readPox5Events({
			db,
			fromHeight: 0,
			toHeight: 1000,
			limit: 50,
			staker: "SP_ALICE",
		});
		expect(result.events.map((e) => e.cursor)).toEqual(["800:0", "802:0"]);
	});

	test("a fold-emitted bond-distribution row (staker NULL) survives a topic filter", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_events")
			.values([
				seed({
					cursor: "900:0",
					block_height: 900,
					tx_id: "0xfold",
					tx_index: 0,
					event_index: 0,
					topic: "bond-distribution",
					bond_index: 7,
					reward_cycle: 100,
					data: {
						topic: "bond-distribution",
						"bond-rewards": [{ "bond-index": "7", amount: "1000" }],
					},
				}),
				seed({
					cursor: "900:1",
					block_height: 900,
					tx_id: "0xfold",
					tx_index: 0,
					event_index: 1,
					topic: "claim-rewards",
					staker: "SP_ALICE",
				}),
			])
			.execute();

		const result = await readPox5Events({
			db,
			fromHeight: 0,
			toHeight: 1000,
			limit: 50,
			topic: "bond-distribution",
		});
		expect(result.events).toHaveLength(1);
		const event = result.events[0];
		if (!event) throw new Error("no event");
		expect(event.cursor).toBe("900:0");
		// Nulls survive normalization as nulls, never 0 / NaN.
		expect(event.staker).toBeNull();
		expect(event.amount_ustx).toBeNull();
		expect(event.unlock_burn_height).toBeNull();
		expect(event.is_l1_lock).toBeNull();
		expect(event.bond_index).toBe(7);
	});

	test("an inverted height window short-circuits without a query", async () => {
		if (!db) throw new Error("missing db");
		const result = await readPox5Events({
			db,
			fromHeight: 900,
			toHeight: 100,
			limit: 50,
		});
		expect(result).toEqual({ events: [], next_cursor: null });
	});
});
