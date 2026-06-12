import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { Cl, serializeCV } from "@secondlayer/stacks/clarity";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createIndexRouter } from "../routes/index.ts";
import {
	PrintSchemaCache,
	type PrintSchemaReadResult,
	getPrintSchemaBody,
	parsePrintSchemaContractId,
	readPrintSchemaWindows,
} from "./print-schema.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};
const CONTRACT_ID = "SP000000000000000000002Q6VF78.sbtc-registry";

describe("print-schema contract_id validation", () => {
	test("accepts mainnet and short devnet contract principals", () => {
		expect(parsePrintSchemaContractId(CONTRACT_ID)).toBe(CONTRACT_ID);
		expect(parsePrintSchemaContractId("SP1.my-contract_v2")).toBe(
			"SP1.my-contract_v2",
		);
	});

	test("rejects principals without a contract name or with bad shape", () => {
		for (const bad of [
			"not-a-contract",
			"SP1",
			"SP1.",
			"sp1.lowercase-address",
			"SP1.9starts-with-digit",
		]) {
			expect(() => parsePrintSchemaContractId(bad)).toThrow(
				"contract_id must be a Stacks contract principal",
			);
		}
	});
});

describe("print-schema route", () => {
	function fakeResult(): PrintSchemaReadResult {
		return {
			rows: [
				{
					cursor: "100:0",
					// Stored payloads are double-encoded JSON strings — the fake hands
					// back the string form to exercise the defensive parse.
					block_height: 100,
					payload: JSON.stringify({
						topic: "print",
						value: { topic: "deposit", amount: "5" },
						raw_value: `0x${serializeCV(
							Cl.tuple({
								topic: Cl.stringAscii("deposit"),
								amount: Cl.uint(5),
							}),
						)}`,
					}),
				},
			],
			total_events: 1,
			total_events_capped: false,
		};
	}

	function createApp(read = async () => fakeResult()) {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				getTip: () => TIP,
				readPrintSchema: read,
				printSchemaCache: new PrintSchemaCache(),
			}),
		);
		return app;
	}

	test("serves the inferred schema with a 5-min public cache + ETag", async () => {
		const app = createApp();
		const res = await app.request(
			`/v1/index/contracts/${CONTRACT_ID}/print-schema`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
		expect(res.headers.get("ETag")).toStartWith('W/"');

		const body = (await res.json()) as {
			contract_id: string;
			topics: Array<{
				topic: string;
				count: number;
				non_tuple: boolean;
				fields: Array<Record<string, unknown>>;
			}>;
			sampled: boolean;
			total_events: number;
			total_events_capped: boolean;
			sample: { size: number };
			tip: IndexTip;
		};
		expect(body.contract_id).toBe(CONTRACT_ID);
		expect(body.tip).toEqual(TIP);
		expect(body.total_events).toBe(1);
		expect(body.sampled).toBe(false);
		expect(body.topics).toHaveLength(1);
		expect(body.topics[0]).toMatchObject({ topic: "deposit", count: 1 });
		expect(body.topics[0]?.fields).toEqual([
			{
				name: "amount",
				camel_name: "amount",
				clarity_type: "uint",
				ts_type: "bigint",
				column_type: "uint",
				always_present: true,
			},
		]);
	});

	test("matching If-None-Match short-circuits to 304", async () => {
		const app = createApp();
		const path = `/v1/index/contracts/${CONTRACT_ID}/print-schema`;
		const first = await app.request(path);
		const tag = first.headers.get("ETag");
		expect(tag).not.toBeNull();

		const second = await app.request(path, {
			headers: { "If-None-Match": tag as string },
		});
		expect(second.status).toBe(304);
	});

	test("memoizes the body per contract — the reader runs once", async () => {
		let reads = 0;
		const app = createApp(async () => {
			reads++;
			return fakeResult();
		});
		const path = `/v1/index/contracts/${CONTRACT_ID}/print-schema`;
		await app.request(path);
		await app.request(path);
		expect(reads).toBe(1);
	});

	test("sampled is based on rows examined, not rows that parse", async () => {
		// Both rows are EXAMINED; one has garbage payload that fails parsing.
		// total_events == rows fetched → not sampled, even though only one
		// row survived parsing.
		const app = createApp(async () => {
			const base = fakeResult();
			return {
				rows: [
					...base.rows,
					{ cursor: "101:0", block_height: 101, payload: "not-json{" },
				],
				total_events: 2,
				total_events_capped: false,
			};
		});
		const res = await app.request(
			`/v1/index/contracts/${CONTRACT_ID}/print-schema`,
		);
		const body = (await res.json()) as {
			sampled: boolean;
			sample: { size: number };
		};
		expect(body.sample.size).toBe(1);
		expect(body.sampled).toBe(false);
	});

	test("sampled flips true when total_events exceeds the examined windows", async () => {
		const app = createApp(async () => ({
			...fakeResult(),
			total_events: 2,
		}));
		const res = await app.request(
			`/v1/index/contracts/${CONTRACT_ID}/print-schema`,
		);
		const body = (await res.json()) as { sampled: boolean };
		expect(body.sampled).toBe(true);
	});

	test("unknown query params are rejected with 400 like sibling endpoints", async () => {
		const app = createApp(async () => {
			throw new Error("reader should not run for an invalid query param");
		});
		const res = await app.request(
			`/v1/index/contracts/${CONTRACT_ID}/print-schema?limit=5`,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("unknown query param: limit");
	});

	test("bad contract_id is rejected with 400 before any read", async () => {
		const app = createApp(async () => {
			throw new Error("reader should not run for an invalid contract_id");
		});
		const res = await app.request("/v1/index/contracts/nope/print-schema");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("contract_id must be a Stacks contract");
	});
});

describe.skipIf(!HAS_DB)("print-schema DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
	});

	const DEPOSIT_WITH_MEMO = Cl.tuple({
		topic: Cl.stringAscii("completed-deposit"),
		"bitcoin-txid": Cl.buffer(new Uint8Array(32).fill(7)),
		amount: Cl.uint(100),
		memo: Cl.some(Cl.uint(1)),
	});
	const DEPOSIT_WITHOUT_MEMO = Cl.tuple({
		topic: Cl.stringAscii("completed-deposit"),
		"bitcoin-txid": Cl.buffer(new Uint8Array(32).fill(9)),
		amount: Cl.uint(200),
		memo: Cl.none(),
	});
	const WITHDRAWAL = Cl.tuple({
		topic: Cl.stringAscii("withdrawal"),
		recipient: Cl.standardPrincipal(
			"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
		),
	});
	const NON_TUPLE = Cl.uint(42);

	function printRow(opts: {
		cursor: string;
		blockHeight: number;
		topic: string | null;
		rawHex: string | null;
		decodedValue?: unknown;
	}) {
		return {
			cursor: opts.cursor,
			block_height: opts.blockHeight,
			tx_id: `tx-${opts.cursor}`,
			tx_index: 0,
			event_index: Number(opts.cursor.split(":")[1]),
			event_type: "print",
			contract_id: CONTRACT_ID,
			// Stored topic is always the node literal "print"; the real topic
			// lives in the decoded tuple (payload.value.topic).
			payload: JSON.stringify({
				topic: "print",
				value: opts.decodedValue ?? (opts.topic ? { topic: opts.topic } : "42"),
				raw_value: opts.rawHex,
			}),
			source_cursor: opts.cursor,
		};
	}

	async function seedFixture() {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				printRow({
					cursor: "9000:0",
					blockHeight: 9000,
					topic: "completed-deposit",
					rawHex: `0x${serializeCV(DEPOSIT_WITH_MEMO)}`,
				}),
				printRow({
					cursor: "9001:0",
					blockHeight: 9001,
					topic: "completed-deposit",
					rawHex: `0x${serializeCV(DEPOSIT_WITHOUT_MEMO)}`,
				}),
				// null raw_value: still counts toward the topic, contributes no typing
				printRow({
					cursor: "9002:0",
					blockHeight: 9002,
					topic: "completed-deposit",
					rawHex: null,
				}),
				printRow({
					cursor: "9003:0",
					blockHeight: 9003,
					topic: "withdrawal",
					rawHex: `0x${serializeCV(WITHDRAWAL)}`,
				}),
				// non-tuple print: no value.topic → "*" pseudo-topic
				printRow({
					cursor: "9004:0",
					blockHeight: 9004,
					topic: null,
					rawHex: `0x${serializeCV(NON_TUPLE)}`,
				}),
			])
			.execute();
	}

	test("windows + count cover only this contract's canonical prints", async () => {
		if (!db) throw new Error("missing db");
		await seedFixture();
		// Another contract's print and a non-canonical row must not leak in.
		await db
			.insertInto("decoded_events")
			.values([
				{
					...printRow({
						cursor: "9100:0",
						blockHeight: 9100,
						topic: "other",
						rawHex: null,
					}),
					contract_id: "SP1.other",
				},
				{
					...printRow({
						cursor: "9101:0",
						blockHeight: 9101,
						topic: "orphaned",
						rawHex: null,
					}),
					canonical: false,
				},
			])
			.execute();

		const result = await readPrintSchemaWindows({
			contractId: CONTRACT_ID,
			db,
		});
		expect(result.total_events).toBe(5);
		expect(result.total_events_capped).toBe(false);
		expect(result.rows.map((r) => r.cursor).sort()).toEqual([
			"9000:0",
			"9001:0",
			"9002:0",
			"9003:0",
			"9004:0",
		]);
	});

	test("infers per-topic schemas from real Clarity hex", async () => {
		if (!db) throw new Error("missing db");
		await seedFixture();

		const body = await getPrintSchemaBody({
			contractId: CONTRACT_ID,
			read: (params) => readPrintSchemaWindows({ ...params, db }),
			cache: new PrintSchemaCache(),
		});

		expect(body.contract_id).toBe(CONTRACT_ID);
		expect(body.sampled).toBe(false);
		expect(body.total_events).toBe(5);
		expect(body.total_events_capped).toBe(false);
		expect(body.sample).toEqual({
			size: 5,
			newest_height: 9004,
			oldest_height: 9000,
		});

		// Sorted by count desc: completed-deposit (3) first.
		expect(body.topics[0]?.topic).toBe("completed-deposit");
		expect(new Set(body.topics.map((t) => t.topic))).toEqual(
			new Set(["completed-deposit", "withdrawal", "*"]),
		);

		const deposit = body.topics.find((t) => t.topic === "completed-deposit");
		expect(deposit).toMatchObject({
			count: 3,
			first_height: 9000,
			last_height: 9002,
			non_tuple: false,
		});
		expect(deposit?.fields).toEqual([
			{
				name: "amount",
				camel_name: "amount",
				clarity_type: "uint",
				ts_type: "bigint",
				column_type: "uint",
				always_present: true,
			},
			{
				name: "bitcoin-txid",
				camel_name: "bitcoinTxid",
				clarity_type: "(buff 32)",
				ts_type: "string",
				column_type: "text",
				always_present: true,
			},
			{
				name: "memo",
				camel_name: "memo",
				clarity_type: "(optional uint)",
				ts_type: "bigint | null",
				column_type: "uint",
				always_present: true,
				optional_some_rate: 0.5,
			},
		]);

		const withdrawal = body.topics.find((t) => t.topic === "withdrawal");
		expect(withdrawal).toMatchObject({ count: 1, non_tuple: false });
		expect(withdrawal?.fields).toEqual([
			{
				name: "recipient",
				camel_name: "recipient",
				clarity_type: "principal",
				ts_type: "string",
				column_type: "principal",
				always_present: true,
			},
		]);

		const wildcard = body.topics.find((t) => t.topic === "*");
		expect(wildcard).toMatchObject({ count: 1, non_tuple: true, fields: [] });
	});

	test("a contract with no print events yields an empty 200 body", async () => {
		const body = await getPrintSchemaBody({
			contractId: "SP1.never-printed",
			read: (params) =>
				readPrintSchemaWindows({ ...params, db: db ?? getDb() }),
			cache: new PrintSchemaCache(),
		});
		expect(body.topics).toEqual([]);
		expect(body.total_events).toBe(0);
		expect(body.sampled).toBe(false);
		expect(body.sample).toEqual({
			size: 0,
			newest_height: null,
			oldest_height: null,
		});
	});
});
