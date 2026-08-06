import { describe, expect, test } from "bun:test";
import {
	parseBlockInput,
	parseOperationId,
	validateBackfillRange,
} from "./reindex-form";

describe("parseBlockInput", () => {
	test("rejects comma-separated numbers instead of silently NaN-ing", () => {
		// Number("12,000") is NaN, and JSON.stringify(NaN) is "null" — this is
		// the exact input that would have silently turned a bounded backfill
		// into something else if it reached the request body unchecked.
		expect(parseBlockInput("12,000")).toBeNull();
	});

	test("rejects negative numbers", () => {
		expect(parseBlockInput("-5")).toBeNull();
	});

	test("rejects non-integer input", () => {
		expect(parseBlockInput("185000.5")).toBeNull();
	});

	test("accepts plain digit strings", () => {
		expect(parseBlockInput("185000")).toBe(185000);
	});
});

describe("validateBackfillRange", () => {
	test("rejects a NaN-producing input before it would reach a request body", () => {
		const result = validateBackfillRange("12,000", "187421");
		expect(result.valid).toBe(false);
	});

	test("rejects from > to", () => {
		const result = validateBackfillRange("187421", "185000");
		expect(result.valid).toBe(false);
	});

	test("accepts a valid ascending range", () => {
		const result = validateBackfillRange("185000", "187421");
		expect(result).toEqual({ valid: true, fromBlock: 185000, toBlock: 187421 });
	});
});

describe("parseOperationId", () => {
	test("reads the queued operation id the start endpoints return", () => {
		expect(parseOperationId({ operationId: "op-123", status: "queued" })).toBe(
			"op-123",
		);
	});

	test("degrades to null rather than throwing on an unexpected body", () => {
		// The started event is still worth sending without a join key — losing
		// the whole submit over a missing id would be the worse failure.
		expect(parseOperationId(null)).toBeNull();
		expect(parseOperationId("queued")).toBeNull();
		expect(parseOperationId({})).toBeNull();
		expect(parseOperationId({ operationId: 123 })).toBeNull();
		expect(parseOperationId({ operationId: "" })).toBeNull();
	});
});
