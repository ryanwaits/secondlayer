import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import {
	appendObserverReceipt,
	bodyFromText,
	canonicalJson,
	markObserverFailed,
	markObserverProcessed,
	parseObserverBody,
	semanticObserverSha256,
	sha256Hex,
} from "./observer-journal.ts";

describe("observer journal encoding", () => {
	test("canonical JSON sorts object keys but preserves array order", () => {
		expect(
			canonicalJson({ z: 1, nested: { b: true, a: null }, a: [2, 1] }),
		).toBe('{"a":[2,1],"nested":{"a":null,"b":true},"z":1}');
	});

	test("semantic digest includes the observer path", () => {
		const payload = { block_height: 42, block_hash: "0xabc" };
		expect(semanticObserverSha256("/new_block", payload)).not.toBe(
			semanticObserverSha256("/new_burn_block", payload),
		);
	});

	test("raw digest hashes exact request bytes", () => {
		const body = bodyFromText('{"b":1,"a":2}');
		expect(parseObserverBody<Record<string, number>>(body)).toEqual({
			b: 1,
			a: 2,
		});
		expect(sha256Hex(body)).toBe(
			"a1d46c3cdb4e5795c8d637f80daeb578ebb1a9a65dc1ed5f11f51794c3c89f3a",
		);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const NETWORK = "observer-journal-test";

describe.skipIf(!HAS_DB)("observer journal retried failures", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function clean() {
		await db
			?.deleteFrom("observer_journal")
			.where("network", "=", NETWORK)
			.execute();
	}

	async function receive(body: string) {
		if (!db) throw new Error("no db");
		return appendObserverReceipt(db, {
			network: NETWORK,
			path: "/new_block",
			source: null,
			body: bodyFromText(body),
		});
	}

	async function statuses() {
		const rows = await db
			?.selectFrom("observer_journal")
			.select(["sequence", "status"])
			.where("network", "=", NETWORK)
			.orderBy("sequence")
			.execute();
		return (rows ?? []).map((r) => r.status);
	}

	const processed = {
		path: "/new_block" as const,
		payload: { block_height: 1, block_hash: "0x01" },
		result: {},
	};

	beforeEach(clean);
	afterAll(clean);

	test("a failed body later processed with identical bytes becomes retried", async () => {
		if (!db) return;
		const first = await receive('{"block_height":1}');
		await markObserverFailed(db, first, new Error("fk violation"));
		const second = await receive('{"block_height":1}');
		await markObserverProcessed(db, second, processed);
		expect(await statuses()).toEqual(["retried", "processed"]);
	});

	test("a failure stays failed when a different body is processed", async () => {
		if (!db) return;
		const failed = await receive('{"block_height":1}');
		await markObserverFailed(db, failed, new Error("fk violation"));
		const other = await receive('{"block_height":2}');
		await markObserverProcessed(db, other, processed);
		expect(await statuses()).toEqual(["failed", "processed"]);
	});

	test("received rows with the same body are never touched", async () => {
		if (!db) return;
		await receive('{"block_height":1}');
		const done = await receive('{"block_height":1}');
		await markObserverProcessed(db, done, processed);
		expect(await statuses()).toEqual(["received", "processed"]);
	});
});
