import { describe, expect, test } from "bun:test";
import {
	resolveOrderByColumn,
	serializeWhere,
} from "../subgraphs/serialize.ts";

describe("serializeWhere", () => {
	test("scalar equality", () => {
		expect(serializeWhere({ sender: "SP123" })).toEqual({ sender: "SP123" });
	});

	test("numeric scalar", () => {
		expect(serializeWhere({ amount: 100 })).toEqual({ amount: "100" });
	});

	test("comparison operators", () => {
		expect(serializeWhere({ amount: { gte: 100, lt: 200 } })).toEqual({
			"amount.gte": "100",
			"amount.lt": "200",
		});
	});

	test("eq in comparison object", () => {
		expect(serializeWhere({ status: { eq: "active" } })).toEqual({
			status: "active",
		});
	});

	test("neq operator", () => {
		expect(serializeWhere({ status: { neq: "deleted" } })).toEqual({
			"status.neq": "deleted",
		});
	});

	test("mixed scalar and comparison", () => {
		expect(serializeWhere({ sender: "SP123", amount: { gte: 100 } })).toEqual({
			sender: "SP123",
			"amount.gte": "100",
		});
	});

	test("null values are skipped", () => {
		expect(serializeWhere({ sender: null, amount: 50 })).toEqual({
			amount: "50",
		});
	});

	test("undefined values are skipped", () => {
		expect(serializeWhere({ sender: undefined, amount: 50 })).toEqual({
			amount: "50",
		});
	});

	describe("system column aliases", () => {
		test("_blockHeight → _block_height", () => {
			expect(serializeWhere({ _blockHeight: 100 })).toEqual({
				_block_height: "100",
			});
		});

		test("blockHeight → _block_height", () => {
			expect(serializeWhere({ blockHeight: 100 })).toEqual({
				_block_height: "100",
			});
		});

		test("_txId → _tx_id", () => {
			expect(serializeWhere({ _txId: "0xabc" })).toEqual({ _tx_id: "0xabc" });
		});

		test("txId → _tx_id", () => {
			expect(serializeWhere({ txId: "0xabc" })).toEqual({ _tx_id: "0xabc" });
		});

		test("_createdAt → _created_at", () => {
			expect(serializeWhere({ _createdAt: "2024-01-01" })).toEqual({
				_created_at: "2024-01-01",
			});
		});

		test("createdAt → _created_at", () => {
			expect(serializeWhere({ createdAt: "2024-01-01" })).toEqual({
				_created_at: "2024-01-01",
			});
		});

		test("blockHeight comparison → _block_height.gte", () => {
			expect(serializeWhere({ blockHeight: { gte: 1000 } })).toEqual({
				"_block_height.gte": "1000",
			});
		});
	});

	describe("resolveOrderByColumn", () => {
		test("_blockHeight → _block_height", () => {
			expect(resolveOrderByColumn("_blockHeight")).toBe("_block_height");
		});

		test("blockHeight → _block_height", () => {
			expect(resolveOrderByColumn("blockHeight")).toBe("_block_height");
		});

		test("user columns pass through unchanged", () => {
			expect(resolveOrderByColumn("amount")).toBe("amount");
			expect(resolveOrderByColumn("sender")).toBe("sender");
		});
	});
});
