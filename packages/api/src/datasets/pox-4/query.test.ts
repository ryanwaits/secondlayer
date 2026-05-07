import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import { parsePox4CallsQuery } from "./query.ts";

const TIP = { block_height: 7_900_000 };

describe("parsePox4CallsQuery", () => {
	test("defaults to one-day window and limit 200", () => {
		const parsed = parsePox4CallsQuery(new URLSearchParams(), TIP);
		expect(parsed.fromBlock).toBe(7_900_000 - 17_280);
		expect(parsed.toBlock).toBe(7_900_000);
		expect(parsed.limit).toBe(200);
		expect(parsed.functionName).toBeUndefined();
	});

	test("parses stacker / delegate_to / signer_key / reward_cycle", () => {
		const parsed = parsePox4CallsQuery(
			new URLSearchParams({
				stacker: "SP1",
				delegate_to: "SP2",
				signer_key: "0xabcd",
				reward_cycle: "87",
			}),
			TIP,
		);
		expect(parsed.stacker).toBe("SP1");
		expect(parsed.delegateTo).toBe("SP2");
		expect(parsed.signerKey).toBe("0xabcd");
		expect(parsed.rewardCycle).toBe(87);
	});

	test("parses function_name filter", () => {
		const parsed = parsePox4CallsQuery(
			new URLSearchParams({ function_name: "stack-stx" }),
			TIP,
		);
		expect(parsed.functionName).toBe("stack-stx");
	});

	test("rejects invalid function_name", () => {
		expect(() =>
			parsePox4CallsQuery(new URLSearchParams({ function_name: "bogus" }), TIP),
		).toThrow(ValidationError);
	});

	test("parses cursor as <block_height>:<tx_index>", () => {
		const parsed = parsePox4CallsQuery(
			new URLSearchParams({ cursor: "7869999:4" }),
			TIP,
		);
		expect(parsed.cursor).toEqual({ block_height: 7_869_999, tx_index: 4 });
	});

	test("rejects cursor + from_block combo", () => {
		expect(() =>
			parsePox4CallsQuery(
				new URLSearchParams({ cursor: "7869999:0", from_block: "1" }),
				TIP,
			),
		).toThrow(ValidationError);
	});

	test("rejects malformed cursor", () => {
		expect(() =>
			parsePox4CallsQuery(new URLSearchParams({ cursor: "abc" }), TIP),
		).toThrow(ValidationError);
	});

	test("clamps to_block + limit", () => {
		const parsed = parsePox4CallsQuery(
			new URLSearchParams({ to_block: "999999999", limit: "9999" }),
			TIP,
		);
		expect(parsed.toBlock).toBe(7_900_000);
		expect(parsed.limit).toBe(1000);
	});
});
