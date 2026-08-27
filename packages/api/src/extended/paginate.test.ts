import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	EXTENDED_DEFAULT_LIMIT,
	EXTENDED_MAX_LIMIT,
	parseExtendedPageQuery,
} from "./paginate.ts";

describe("parseExtendedPageQuery", () => {
	test("defaults limit 20 offset 0", () => {
		expect(parseExtendedPageQuery({})).toEqual({
			limit: EXTENDED_DEFAULT_LIMIT,
			offset: 0,
		});
	});

	test("accepts valid limit and offset", () => {
		expect(parseExtendedPageQuery({ limit: "10", offset: "40" })).toEqual({
			limit: 10,
			offset: 40,
		});
	});

	test("accepts limit at max 30", () => {
		expect(
			parseExtendedPageQuery({ limit: String(EXTENDED_MAX_LIMIT) }),
		).toEqual({
			limit: 30,
			offset: 0,
		});
	});

	test("400 when limit > 30", () => {
		expect(() => parseExtendedPageQuery({ limit: "31" })).toThrow(
			ValidationError,
		);
		try {
			parseExtendedPageQuery({ limit: "31" });
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as ValidationError).code).toBe("VALIDATION_ERROR");
		}
	});

	test("400 when limit < 1", () => {
		expect(() => parseExtendedPageQuery({ limit: "0" })).toThrow(
			ValidationError,
		);
	});

	test("400 on non-integer limit", () => {
		expect(() => parseExtendedPageQuery({ limit: "1.5" })).toThrow(
			ValidationError,
		);
		expect(() => parseExtendedPageQuery({ limit: "abc" })).toThrow(
			ValidationError,
		);
	});

	test("400 on negative offset", () => {
		expect(() => parseExtendedPageQuery({ offset: "-1" })).toThrow(
			ValidationError,
		);
	});

	test("400 when cursor present", () => {
		expect(() =>
			parseExtendedPageQuery({ cursor: "1:0", limit: "10" }),
		).toThrow(ValidationError);
	});

	test("400 when from_cursor present", () => {
		expect(() => parseExtendedPageQuery({ from_cursor: "1:0" })).toThrow(
			ValidationError,
		);
	});

	test("maxLimit 50 accepts limit 50", () => {
		expect(parseExtendedPageQuery({ limit: "50" }, { maxLimit: 50 })).toEqual({
			limit: 50,
			offset: 0,
		});
	});

	test("maxLimit 50 rejects limit 51", () => {
		expect(() =>
			parseExtendedPageQuery({ limit: "51" }, { maxLimit: 50 }),
		).toThrow(ValidationError);
	});

	test("default maxLimit still 30 when opts omitted", () => {
		expect(() => parseExtendedPageQuery({ limit: "50" })).toThrow(
			ValidationError,
		);
	});
});
