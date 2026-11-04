import { describe, expect, test } from "bun:test";
import { parseIndexViews, serializeIndexViews } from "./index-view";

describe("index view cookie", () => {
	test("round-trips both pages", () => {
		const views = { webhooks: "ribbon", subgraphs: "rows" } as const;
		expect(parseIndexViews(serializeIndexViews(views))).toEqual(views);
	});

	test("reads the plain and the URL-encoded form", () => {
		expect(parseIndexViews("webhooks:ribbon~subgraphs:rows")).toEqual({
			webhooks: "ribbon",
			subgraphs: "rows",
		});
		expect(parseIndexViews("webhooks%3Aribbon")).toEqual({
			webhooks: "ribbon",
		});
	});

	test("drops anything malformed, so the default applies", () => {
		expect(parseIndexViews(undefined)).toEqual({});
		expect(parseIndexViews("")).toEqual({});
		expect(parseIndexViews("webhooks:grid~streams:rows~junk")).toEqual({});
		expect(parseIndexViews("%E0%A4%A")).toEqual({});
	});

	test("keeps the good part of a half-bad value", () => {
		expect(parseIndexViews("webhooks:grid~subgraphs:ribbon")).toEqual({
			subgraphs: "ribbon",
		});
	});

	test("an empty choice serializes to an empty value", () => {
		expect(serializeIndexViews({})).toBe("");
	});
});
