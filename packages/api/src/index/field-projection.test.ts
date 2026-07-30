import { describe, expect, test } from "bun:test";
import {
	ALWAYS_PROJECTED,
	parseFields,
	projectRow,
} from "./field-projection.ts";

/**
 * The two rules this helper exists to keep identical across every resource
 * that projects: a typo is refused, and the keys pagination depends on cannot
 * be projected away.
 */
describe("parseFields", () => {
	test("omitting the param means no projection", () => {
		expect(parseFields(null, ["a", "b"])).toBeUndefined();
	});

	test("refuses an unknown field instead of dropping it", () => {
		// Silently ignoring a typo hands back a row missing exactly the column
		// the caller believes they asked for.
		expect(() => parseFields("amount,sendr", ["amount", "sender"])).toThrow(
			/unknown field: sendr/,
		);
	});

	test("refuses an empty list", () => {
		expect(() => parseFields("", ["a"])).toThrow(/at least one column/);
		expect(() => parseFields("  ,  ", ["a"])).toThrow(/at least one column/);
	});

	test("always-projected columns are accepted without being declared", () => {
		expect(parseFields("cursor,block_height", [])).toEqual([
			"cursor",
			"block_height",
		]);
	});

	test("extra names widen the allowlist", () => {
		expect(parseFields("request_id", [], ["request_id"])).toEqual([
			"request_id",
		]);
	});
});

describe("projectRow", () => {
	const row = () => ({
		cursor: "1:0",
		block_height: 1,
		amount: "10",
		sender: "SP1",
	});

	test("keeps the requested columns plus the always-kept ones", () => {
		const out = projectRow(row(), new Set(["amount"]));
		expect(Object.keys(out).sort()).toEqual([
			"amount",
			"block_height",
			"cursor",
		]);
	});

	test("drops rather than nulls — absence is what makes the type honest", () => {
		const out = projectRow(row(), new Set(["amount"])) as Record<
			string,
			unknown
		>;
		expect("sender" in out).toBe(false);
	});

	test("no projection returns the row untouched", () => {
		expect(projectRow(row(), undefined)).toEqual(row());
	});

	test("a resource can override what always survives", () => {
		// Withdrawals are keyed by request_id and carry no block_height.
		const out = projectRow(
			{ cursor: "1:0", request_id: 7, amount: "10", sender: "SP1" },
			new Set(["amount"]),
			["cursor", "request_id"],
		);
		expect(Object.keys(out).sort()).toEqual(["amount", "cursor", "request_id"]);
	});

	test("ALWAYS_PROJECTED is the default", () => {
		expect([...ALWAYS_PROJECTED]).toEqual(["cursor", "block_height"]);
	});
});
