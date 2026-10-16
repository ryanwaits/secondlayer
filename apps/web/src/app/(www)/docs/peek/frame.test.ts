import { describe, expect, test } from "bun:test";
import { countsLabel } from "./frame";

describe("countsLabel", () => {
	test("says what the clamped body still holds, singular and plural", () => {
		expect(countsLabel({ examples: 1, tables: 2, lists: 1 })).toBe(
			"1 example, 2 tables, 1 list",
		);
		expect(countsLabel({ examples: 3, tables: 1, lists: 2 })).toBe(
			"3 examples, 1 table, 2 lists",
		);
	});

	test("leaves out what is not there", () => {
		expect(countsLabel({ examples: 0, tables: 2, lists: 0 })).toBe("2 tables");
		expect(countsLabel({ examples: 0, tables: 0, lists: 0 })).toBe("");
	});
});
