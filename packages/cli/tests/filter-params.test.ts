import { describe, expect, it } from "bun:test";
import {
	parseQueryFilters,
	parseWebhookFilter,
} from "../src/lib/filter-params.ts";

describe("CLI filter params", () => {
	describe("parseQueryFilters", () => {
		it("keeps query filters in API query-param shape", () => {
			expect(
				parseQueryFilters([
					"sender=SP123",
					"amount.gte=1000000",
					"recipient.neq=SP999",
					"memo.like=swap",
				]),
			).toEqual({
				sender: "SP123",
				"amount.gte": "1000000",
				"recipient.neq": "SP999",
				"memo.like": "swap",
			});
		});

		it("returns undefined when no filters are provided", () => {
			expect(parseQueryFilters()).toBeUndefined();
			expect(parseQueryFilters([])).toBeUndefined();
		});

		it("rejects malformed filters", () => {
			expect(() => parseQueryFilters(["amount.gte"])).toThrow("Use key=value");
			expect(() => parseQueryFilters(["amount.between=1,2"])).toThrow(
				"Invalid filter operator",
			);
		});
	});

	describe("parseWebhookFilter", () => {
		it("converts CLI filters to subscription filter JSON", () => {
			expect(
				parseWebhookFilter([
					"sender=SP123",
					"amount.gte=1000000",
					"recipient.neq=SP999",
					"block_height.lt=500",
				]),
			).toEqual({
				sender: "SP123",
				amount: { gte: "1000000" },
				recipient: { neq: "SP999" },
				block_height: { lt: "500" },
			});
		});

		it("treats explicit .eq the same as bare equality", () => {
			expect(parseWebhookFilter(["sender.eq=SP123"])).toEqual({
				sender: "SP123",
			});
		});

		it("returns undefined when no filters are provided", () => {
			expect(parseWebhookFilter()).toBeUndefined();
			expect(parseWebhookFilter([])).toBeUndefined();
		});

		it("rejects query-only and ambiguous subscription filters", () => {
			expect(() => parseWebhookFilter(["memo.like=swap"])).toThrow(
				"do not support",
			);
			expect(() =>
				parseWebhookFilter(["amount.gte=100", "amount.lt=200"]),
			).toThrow("one condition per field");
		});
	});
});
