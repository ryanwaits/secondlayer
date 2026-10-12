import { describe, expect, it } from "bun:test";
import { parseQueryFilters } from "../src/lib/filter-params.ts";

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
});
