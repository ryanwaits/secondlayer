import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	parseSbtcEventsQuery,
	parseSbtcTokenEventsQuery,
} from "./query.ts";

const TIP = { block_height: 200_000 };

describe("parseSbtcEventsQuery", () => {
	test("defaults to one-day window and limit 200", () => {
		const parsed = parseSbtcEventsQuery(new URLSearchParams(), TIP);
		expect(parsed.fromBlock).toBe(200_000 - 17_280);
		expect(parsed.toBlock).toBe(200_000);
		expect(parsed.limit).toBe(200);
		expect(parsed.topic).toBeUndefined();
	});

	test("parses topic / request_id / bitcoin_txid / sender filters", () => {
		const parsed = parseSbtcEventsQuery(
			new URLSearchParams({
				topic: "completed-deposit",
				request_id: "42",
				bitcoin_txid: "0xabc",
				sender: "SP1",
			}),
			TIP,
		);
		expect(parsed.topic).toBe("completed-deposit");
		expect(parsed.requestId).toBe(42);
		expect(parsed.bitcoinTxid).toBe("0xabc");
		expect(parsed.sender).toBe("SP1");
	});

	test("rejects invalid topic", () => {
		expect(() =>
			parseSbtcEventsQuery(new URLSearchParams({ topic: "bogus" }), TIP),
		).toThrow(ValidationError);
	});

	test("rejects cursor + from_block combo", () => {
		expect(() =>
			parseSbtcEventsQuery(
				new URLSearchParams({ cursor: "1:0", from_block: "1" }),
				TIP,
			),
		).toThrow(ValidationError);
	});

	test("clamps to_block + limit", () => {
		const parsed = parseSbtcEventsQuery(
			new URLSearchParams({ to_block: "999999", limit: "9999" }),
			TIP,
		);
		expect(parsed.toBlock).toBe(200_000);
		expect(parsed.limit).toBe(1000);
	});
});

describe("parseSbtcTokenEventsQuery", () => {
	test("defaults to one-day window and limit 200", () => {
		const parsed = parseSbtcTokenEventsQuery(new URLSearchParams(), TIP);
		expect(parsed.fromBlock).toBe(200_000 - 17_280);
		expect(parsed.eventType).toBeUndefined();
	});

	test("parses event_type / sender / recipient", () => {
		const parsed = parseSbtcTokenEventsQuery(
			new URLSearchParams({
				event_type: "transfer",
				sender: "SP1",
				recipient: "SP2",
			}),
			TIP,
		);
		expect(parsed.eventType).toBe("transfer");
		expect(parsed.sender).toBe("SP1");
		expect(parsed.recipient).toBe("SP2");
	});

	test("rejects invalid event_type", () => {
		expect(() =>
			parseSbtcTokenEventsQuery(
				new URLSearchParams({ event_type: "bogus" }),
				TIP,
			),
		).toThrow(ValidationError);
	});
});
