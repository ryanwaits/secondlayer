import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import { parseNetworkHealthQuery } from "./query.ts";

describe("parseNetworkHealthQuery", () => {
	test("defaults to 30 days", () => {
		expect(parseNetworkHealthQuery(new URLSearchParams())).toEqual({
			days: 30,
		});
	});

	test("parses positive integers", () => {
		expect(
			parseNetworkHealthQuery(new URLSearchParams({ days: "7" })),
		).toEqual({ days: 7 });
	});

	test("rejects non-positive", () => {
		expect(() =>
			parseNetworkHealthQuery(new URLSearchParams({ days: "0" })),
		).toThrow(ValidationError);
		expect(() =>
			parseNetworkHealthQuery(new URLSearchParams({ days: "-1" })),
		).toThrow(ValidationError);
		expect(() =>
			parseNetworkHealthQuery(new URLSearchParams({ days: "abc" })),
		).toThrow(ValidationError);
	});

	test("rejects > 365", () => {
		expect(() =>
			parseNetworkHealthQuery(new URLSearchParams({ days: "366" })),
		).toThrow(ValidationError);
	});
});
