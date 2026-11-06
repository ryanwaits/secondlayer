import { describe, expect, test } from "bun:test";
import { detailsAfter, frozenOrder } from "./tables-section";

describe("TablesSection", () => {
	const table = (rowCount: number) => ({
		endpoint: "/v1/subgraphs/x/t",
		rowCount,
		columns: {},
	});

	test("a table that appears after the order was set goes last, a removed one drops out", () => {
		expect(
			frozenOrder(["a", "b"], { b: table(1), c: table(99), d: table(5) }),
		).toEqual(["b", "c", "d"]);
	});

	test("details open after the last card of the open card's grid row", () => {
		expect(detailsAfter(0, 3, 5)).toBe(2);
		expect(detailsAfter(4, 3, 5)).toBe(4);
		expect(detailsAfter(1, 2, 5)).toBe(1);
		expect(detailsAfter(0, 1, 5)).toBe(0);
	});
});
