import { describe, expect, test } from "bun:test";
import {
	dummyValueForColumnType,
	isEmptyMappingHealth,
	synthesizePrintData,
} from "./probeEmptyMapping.ts";

describe("isEmptyMappingHealth", () => {
	test("false when nothing processed yet", () => {
		expect(isEmptyMappingHealth({ totalProcessed: 0, totalRows: 0 })).toBe(
			false,
		);
	});

	test("true when processed with zero rows", () => {
		expect(isEmptyMappingHealth({ totalProcessed: 1, totalRows: 0 })).toBe(
			true,
		);
	});

	test("false when processed with rows", () => {
		expect(isEmptyMappingHealth({ totalProcessed: 10, totalRows: 3 })).toBe(
			false,
		);
	});
});

describe("synthesizePrintData", () => {
	test("fills always_present fields with typed dummies", () => {
		expect(
			synthesizePrintData([
				{
					camel_name: "amount",
					column_type: "uint",
					always_present: true,
				},
				{
					camel_name: "optionalNote",
					column_type: "text",
					always_present: false,
				},
				{
					camel_name: "owner",
					column_type: "principal",
					always_present: true,
				},
			]),
		).toEqual({
			amount: 1n,
			owner: "SP000000000000000000002Q6VF78",
		});
	});

	test("jsonb becomes an empty object", () => {
		expect(dummyValueForColumnType("jsonb")).toEqual({});
		expect(dummyValueForColumnType("boolean")).toBe(true);
		expect(dummyValueForColumnType("text")).toBe("x");
	});
});
